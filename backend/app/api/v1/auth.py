"""Auth: login, refresh, perfil propio y cambio de contraseña."""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core import rate_limit
from ...core.config import settings
from ...core.operativas import OPERATIVA_SLUGS
from ...core.database import get_db
from ...core.perfiles import perfil_name
from ...core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from ...models.seguridad import SecuritySettings
from ...models.user import User
from ...services import seguridad as seg
from ...services import sesiones
from ...schemas.auth import LoginRequest, TokenPair, TokenRefresh
from ...services.audit_service import record_action
from ..deps import CurrentUser, client_ip, get_current_user


router = APIRouter(prefix="/auth", tags=["auth"])

SUPERADMIN_SELF_MSG = (
    "El superadmin gestiona sus credenciales y perfil desde la configuración del "
    "servidor (.env). No se editan desde la aplicación."
)

ALLOWED_PHOTO_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=1, max_length=128)  # las reglas las valida la política vigente


class ProfileUpdate(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)


def _user_payload(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "full_name": u.full_name,
        "role": u.role,
        "photo_url": u.photo_url,
        "operativas": list(u.operativas or []),
    }


async def _current_db_user(user: CurrentUser, db: AsyncSession) -> User:
    """Devuelve el User (DB) del usuario autenticado, o 400 si es superadmin."""
    if user.is_superadmin:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, SUPERADMIN_SELF_MSG)
    target = await db.get(User, user.id)
    if not target or not target.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario inválido o inactivo")
    return target


def _superadmin_password_ok(password: str) -> bool:
    if settings.superadmin_password:
        return secrets.compare_digest(password.encode(), settings.superadmin_password.encode())
    if settings.superadmin_password_hash:
        return verify_password(password, settings.superadmin_password_hash)
    return False


# ============================================================== login, sesiones y segundo factor
def _ahora() -> datetime:
    return datetime.now(timezone.utc)


def _utc(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=timezone.utc) if d is not None and d.tzinfo is None else d


def _crear_desafio(email: str) -> str:
    """Token corto (5 min) que prueba que la contraseña ya fue validada; falta el código del segundo factor."""
    from jose import jwt
    return jwt.encode({"sub": email, "type": "mfa", "exp": _ahora() + timedelta(minutes=5)}, settings.secret_key, algorithm=settings.jwt_algorithm)


async def _emitir(db: AsyncSession, cfg: dict, request: Request, *, user_id: str, email: str, role: str, name: str,
                  photo: str | None, operativas: list[str], mfa: bool, cambio: bool) -> dict:
    ip, ua = client_ip(request), request.headers.get("user-agent")
    ses = await sesiones.abrir(db, cfg, user_id=user_id, email=email, role=role, ip=ip, user_agent=ua, mfa=mfa)
    await db.commit()
    await record_action(db, user_id=user_id, action="login", resource_type="auth", ip=ip, user_agent=ua,
                        extra={"role": role, "sesion": ses.id, "segundo_factor": mfa})
    return TokenPair(
        access_token=create_access_token(email, role, cfg["sesion"]["access_minutos"], sid=ses.id),
        refresh_token=create_refresh_token(email, sid=ses.id, expires_at=_utc(ses.expires_at)),
        user_email=email, user_role=role, user_name=name, user_photo_url=photo, user_operativas=operativas,
        requiere_cambio_contrasena=cambio, recomendar_2fa=not mfa and cfg["dos_factores"]["recomendado"],
    ).model_dump()


def _bloqueo_msg(cfg: dict, hasta: datetime | None) -> str:
    if not hasta or hasta.year >= 2100:
        return "Tu usuario está bloqueado por intentos fallidos. Pedile al administrador que lo desbloquee."
    from zoneinfo import ZoneInfo
    local = hasta.astimezone(ZoneInfo(cfg["horarios"]["zona"]))
    return f"Tu usuario está bloqueado por intentos fallidos hasta las {local:%H:%M}. Si no fuiste vos, avisale al administrador."


@router.post("/login")
async def login(payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    email = payload.email.lower().strip()
    ip = client_ip(request)
    ua = request.headers.get("user-agent")
    cfg = await seg.config(db)

    if rate_limit.is_blocked(ip, email):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Demasiados intentos fallidos. Probá de nuevo en {settings.login_window_minutes} minutos.",
        )

    # Caso 1: superadmin desde .env (sin horario ni bloqueo de cuenta: nunca queda afuera)
    if email == settings.superadmin_email.lower().strip():
        if not _superadmin_password_ok(payload.password):
            rate_limit.register_failure(ip, email)
            await record_action(db, user_id=None, action="login_failed", resource_type="auth",
                                ip=ip, user_agent=ua, extra={"email": email})
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciales inválidas")
        rate_limit.reset(ip, email)
        fila = await seg.cargar_fila(db)
        await db.commit()
        if fila.superadmin_totp_enabled:
            return {"requiere_2fa": True, "desafio": _crear_desafio(email)}
        return await _emitir(db, cfg, request, user_id="superadmin", email=email, role="superadmin", name=settings.superadmin_name,
                             photo=None, operativas=sorted(OPERATIVA_SLUGS), mfa=False, cambio=False)

    # Caso 2: usuario en DB (coordinador, supervisor, analista o cliente)
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    ahora = _ahora()
    if user and user.locked_until and _utc(user.locked_until) > ahora:
        await record_action(db, user_id=user.id, action="login_bloqueado", resource_type="auth", ip=ip, user_agent=ua)
        raise HTTPException(status.HTTP_423_LOCKED, _bloqueo_msg(cfg, _utc(user.locked_until)))
    if not user or not user.is_active or not verify_password(payload.password, user.hashed_password):
        rate_limit.register_failure(ip, email)
        extra = {"email": email}
        if user:
            b = cfg["bloqueo"]
            if not user.last_failed_at or ahora - _utc(user.last_failed_at) > timedelta(minutes=b["ventana_minutos"]):
                user.failed_attempts = 0
            user.failed_attempts = (user.failed_attempts or 0) + 1
            user.last_failed_at = ahora
            extra["intentos"] = user.failed_attempts
            if user.failed_attempts >= b["max_intentos"]:
                user.locked_until = ahora + timedelta(minutes=b["bloqueo_minutos"]) if b["bloqueo_minutos"] else datetime(2999, 1, 1, tzinfo=timezone.utc)
                await db.commit()
                await record_action(db, user_id=user.id, action="usuario_bloqueado", resource_type="auth", ip=ip, user_agent=ua,
                                    extra={"intentos": user.failed_attempts})
                raise HTTPException(status.HTTP_423_LOCKED, _bloqueo_msg(cfg, _utc(user.locked_until)))
            await db.commit()
        await record_action(db, user_id=None, action="login_failed", resource_type="auth", ip=ip, user_agent=ua, extra=extra)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciales inválidas")

    rate_limit.reset(ip, email)
    user.failed_attempts, user.locked_until = 0, None
    h = seg.evaluar_horario(cfg, user.role, ahora, _utc(user.access_exception_until))
    if not h["permitido"] and cfg["horarios"]["modo"] == "bloquear":
        await db.commit()
        await record_action(db, user_id=user.id, action="acceso_fuera_de_horario", resource_type="auth", ip=ip, user_agent=ua,
                            extra={"bloqueado": True, "motivo": h["motivo"], "ruta": "login"})
        raise HTTPException(status.HTTP_403_FORBIDDEN, {
            "code": "fuera_de_horario",
            "message": ("Hoy es feriado: el acceso está cerrado." if h["motivo"] == "feriado" else "Estás fuera del horario de acceso de tu perfil.")
            + f" Horario: {seg.texto_horario(cfg, user.role)}.",
        })
    user.last_login_at = ahora
    if user.password_changed_at is None:
        user.password_changed_at = ahora  # usuarios anteriores a la política: el vencimiento corre desde hoy
    await db.commit()
    if user.totp_enabled:
        return {"requiere_2fa": True, "desafio": _crear_desafio(email)}
    cambio = bool(user.must_change_password) or seg.contrasena_vencida(cfg, user.password_changed_at, ahora)
    return await _emitir(db, cfg, request, user_id=user.id, email=user.email, role=user.role, name=user.full_name,
                         photo=user.photo_url, operativas=list(user.operativas or []), mfa=False, cambio=cambio)


class Login2FA(BaseModel):
    desafio: str
    codigo: str = Field(min_length=6, max_length=20)


@router.post("/login/2fa")
async def login_segundo_factor(payload: Login2FA, request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Segundo paso del login: código de la app autenticadora (o un código de recuperación)."""
    try:
        data = decode_token(payload.desafio)
    except ValueError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "El paso de verificación venció: ingresá de nuevo.") from exc
    if data.get("type") != "mfa":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Verificación inválida")
    email, ip = data["sub"], client_ip(request)
    if rate_limit.is_blocked(ip, f"2fa|{email}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Demasiados códigos incorrectos. Esperá unos minutos.")
    cfg = await seg.config(db)
    if email == settings.superadmin_email.lower().strip():
        fila = await seg.cargar_fila(db)
        ok = seg.verificar_totp(seg.descifrar(fila.superadmin_totp_enc), payload.codigo)
        if not ok and (resto := seg.usar_codigo_recuperacion(fila.superadmin_recovery, payload.codigo)) is not None:
            fila.superadmin_recovery, ok = resto, True
        if not ok:
            rate_limit.register_failure(ip, f"2fa|{email}")
            await record_action(db, user_id="superadmin", action="login_2fa_fallido", resource_type="auth", ip=ip)
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Código incorrecto")
        await db.commit()
        return await _emitir(db, cfg, request, user_id="superadmin", email=email, role="superadmin", name=settings.superadmin_name,
                             photo=None, operativas=sorted(OPERATIVA_SLUGS), mfa=True, cambio=False)
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not user or not user.is_active or not user.totp_enabled:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Verificación inválida")
    ok = seg.verificar_totp(seg.descifrar(user.totp_secret_enc), payload.codigo)
    if not ok and (resto := seg.usar_codigo_recuperacion(user.totp_recovery, payload.codigo)) is not None:
        user.totp_recovery, ok = resto, True
    if not ok:
        rate_limit.register_failure(ip, f"2fa|{email}")
        await record_action(db, user_id=user.id, action="login_2fa_fallido", resource_type="auth", ip=ip)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Código incorrecto")
    await db.commit()
    cambio = bool(user.must_change_password) or seg.contrasena_vencida(cfg, user.password_changed_at, _ahora())
    return await _emitir(db, cfg, request, user_id=user.id, email=user.email, role=user.role, name=user.full_name,
                         photo=user.photo_url, operativas=list(user.operativas or []), mfa=True, cambio=cambio)


@router.post("/refresh", response_model=TokenPair)
async def refresh_token(payload: TokenRefresh, request: Request, db: AsyncSession = Depends(get_db)) -> TokenPair:
    """Renueva el token de acceso dentro de la MISMA sesión (si sigue vigente: no revive una sesión cerrada)."""
    try:
        data = decode_token(payload.refresh_token)
    except ValueError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token inválido o expirado") from exc
    if data.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token no es refresh")
    cfg = await seg.config(db)
    try:
        ses = await sesiones.validar(db, cfg, data.get("sid"))
    except sesiones.SesionInvalida as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, exc.detail()) from exc
    email = data.get("sub")
    if ses.email != email:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, sesiones.SesionInvalida("invalida").detail())

    if email == settings.superadmin_email:
        await sesiones.marcar_actividad(db, ses)
        return TokenPair(
            access_token=create_access_token(email, "superadmin", cfg["sesion"]["access_minutos"], sid=ses.id),
            refresh_token=create_refresh_token(email, sid=ses.id, expires_at=_utc(ses.expires_at)),
            user_email=email, user_role="superadmin", user_name=settings.superadmin_name, user_operativas=sorted(OPERATIVA_SLUGS),
        )

    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not user or not user.is_active:
        sesiones.cerrar(ses, "usuario_inactivo")
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, sesiones.SesionInvalida("usuario_inactivo").detail())
    await sesiones.marcar_actividad(db, ses)
    return TokenPair(
        access_token=create_access_token(user.email, user.role, cfg["sesion"]["access_minutos"], sid=ses.id),
        refresh_token=create_refresh_token(user.email, sid=ses.id, expires_at=_utc(ses.expires_at)),
        user_email=user.email, user_role=user.role, user_name=user.full_name,
        user_photo_url=user.photo_url, user_operativas=list(user.operativas or []),
    )


@router.post("/logout")
async def logout(request: Request, user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    from ...models.seguridad import UserSession
    ses = await db.get(UserSession, user.session_id)
    if ses:
        sesiones.cerrar(ses, "logout", user.id)
        await db.commit()
    await record_action(db, user_id=user.id, action="logout", resource_type="auth", ip=client_ip(request))
    return {"status": "ok"}


@router.get("/politica")
async def politica_contrasena(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    """Reglas de contraseña vigentes (para mostrarlas al cambiarla)."""
    return (await seg.config(db))["contrasenas"]


@router.get("/me")
async def me(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "photo_url": user.photo_url,
        "role_name": perfil_name(user.role),
        # Operativas asignadas (superadmin: todas) y las que efectivamente puede abrir.
        "operativas": user.operativas,
        "visible_operativas": user.visible_operativas,
        # Permisos efectivos "<operativa>.<utilidad>". El front los usa para
        # mostrar u ocultar utilidades; el backend los valida igual en cada endpoint.
        "permissions": sorted(user.permissions),
        # El superadmin no puede autoeditar perfil/contraseña (vive en .env).
        "can_edit_profile": not user.is_superadmin,
        "seguridad": await _estado_seguridad(user, db),
    }


async def _estado_seguridad(user: CurrentUser, db: AsyncSession) -> dict:
    """Lo que el front necesita para cerrar por inactividad, avisar el fin del horario y recomendar el 2FA."""
    from ...models.seguridad import UserSession
    cfg = await seg.config(db)
    ses = await db.get(UserSession, user.session_id) if user.session_id else None
    if user.is_superadmin:
        fila = await db.get(SecuritySettings, 1)
        activo, cambio, motivo = bool(fila and fila.superadmin_totp_enabled), False, None
    else:
        u = await db.get(User, user.id)
        activo = bool(u and u.totp_enabled)
        vencida = bool(u) and seg.contrasena_vencida(cfg, u.password_changed_at, _ahora())
        cambio = bool(u and (u.must_change_password or vencida))
        motivo = ("primer_ingreso" if u and u.must_change_password else "vencida") if cambio else None
    return {
        "inactividad_minutos": cfg["sesion"]["inactividad_minutos"],
        "aviso_minutos": cfg["horarios"]["aviso_minutos"],
        "acceso_hasta": user.acceso_hasta.isoformat() if user.acceso_hasta else None,
        "sesion_expira": _utc(ses.expires_at).isoformat() if ses else None,
        "dos_factores_activo": activo,
        "recomendar_2fa": cfg["dos_factores"]["recomendado"] and not activo,
        "cambio_contrasena": cambio,
        "motivo_cambio": motivo,
    }


@router.patch("/me")
async def update_my_profile(
    payload: ProfileUpdate,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    target = await _current_db_user(user, db)
    target.full_name = payload.full_name.strip()
    await db.commit()
    await db.refresh(target)
    await record_action(db, user_id=user.id, action="update_own_profile", resource_type="user",
                        resource_id=target.id, ip=client_ip(request))
    return _user_payload(target)


@router.post("/change-password")
async def change_my_password(
    payload: ChangePasswordRequest,
    request: Request,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    target = await _current_db_user(user, db)
    if not verify_password(payload.current_password, target.hashed_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La contraseña actual es incorrecta")
    cfg = await seg.config(db)
    try:
        seg.validar_contrasena(cfg, payload.new_password, target.password_history, target.hashed_password)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    target.password_history = seg.nuevo_historial(cfg, target.password_history, target.hashed_password)
    target.hashed_password = hash_password(payload.new_password)
    target.password_changed_at = _ahora()
    target.must_change_password = False
    # Las otras sesiones del usuario se cierran: solo queda la actual.
    otras = await sesiones.cerrar_de_usuario(db, target.id, "cerrada", target.id, excepto=user.session_id)
    await db.commit()
    await record_action(db, user_id=user.id, action="change_own_password", resource_type="user",
                        resource_id=target.id, ip=client_ip(request), extra={"sesiones_cerradas": otras})
    return {"status": "ok"}


# ------------------------------------------------------------------ segundo factor (opcional, recomendado)
class CodigoRequest(BaseModel):
    codigo: str = Field(min_length=6, max_length=20)


class Desactivar2FA(BaseModel):
    password: str
    codigo: str = Field(min_length=6, max_length=20)


async def _mfa_store(user: CurrentUser, db: AsyncSession):
    """(objeto, campo_secreto, campo_activo, campo_recuperacion) del usuario o del superadmin de .env."""
    if user.is_superadmin:
        return await seg.cargar_fila(db), "superadmin_totp_enc", "superadmin_totp_enabled", "superadmin_recovery"
    return await _current_db_user(user, db), "totp_secret_enc", "totp_enabled", "totp_recovery"


@router.get("/2fa")
async def estado_2fa(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    obj, _, act, rec = await _mfa_store(user, db)
    cfg = await seg.config(db)
    return {"activo": bool(getattr(obj, act)), "codigos_restantes": len(getattr(obj, rec) or []), "recomendado": cfg["dos_factores"]["recomendado"]}


@router.post("/2fa/iniciar")
async def iniciar_2fa(request: Request, user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    obj, sec, act, _ = await _mfa_store(user, db)
    if getattr(obj, act):
        raise HTTPException(status.HTTP_409_CONFLICT, "El segundo factor ya está activo.")
    secreto = seg.nuevo_secreto()
    setattr(obj, sec, seg.cifrar(secreto))
    await db.commit()
    uri = seg.uri_totp(secreto, user.email)
    return {"secreto": " ".join(secreto[i:i + 4] for i in range(0, len(secreto), 4)), "uri": uri, "qr_svg": seg.qr_svg(uri)}


@router.post("/2fa/activar")
async def activar_2fa(payload: CodigoRequest, request: Request, user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    obj, sec, act, rec = await _mfa_store(user, db)
    if getattr(obj, act):
        raise HTTPException(status.HTTP_409_CONFLICT, "El segundo factor ya está activo.")
    if not seg.verificar_totp(seg.descifrar(getattr(obj, sec)), payload.codigo):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Código incorrecto. Revisá la hora del teléfono y probá con el código nuevo.")
    planos, hashes = seg.codigos_recuperacion()
    setattr(obj, act, True)
    setattr(obj, rec, hashes)
    await db.commit()
    await record_action(db, user_id=user.id, action="2fa_activado", resource_type="auth", ip=client_ip(request))
    return {"activo": True, "codigos_recuperacion": planos}


@router.post("/2fa/desactivar")
async def desactivar_2fa(payload: Desactivar2FA, request: Request, user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    obj, sec, act, rec = await _mfa_store(user, db)
    if not getattr(obj, act):
        return {"activo": False}
    pw_ok = _superadmin_password_ok(payload.password) if user.is_superadmin else verify_password(payload.password, obj.hashed_password)
    cod_ok = seg.verificar_totp(seg.descifrar(getattr(obj, sec)), payload.codigo) or seg.usar_codigo_recuperacion(getattr(obj, rec), payload.codigo) is not None
    if not (pw_ok and cod_ok):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Contraseña o código incorrectos")
    setattr(obj, act, False)
    setattr(obj, sec, None)
    setattr(obj, rec, None)
    await db.commit()
    await record_action(db, user_id=user.id, action="2fa_desactivado", resource_type="auth", ip=client_ip(request))
    return {"activo": False}


async def save_user_photo(target: User, file: UploadFile) -> None:
    """Valida y guarda la foto en el disco persistente; setea `photo_url`."""
    ext = ALLOWED_PHOTO_TYPES.get(file.content_type or "")
    if not ext:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Solo PNG, JPEG o WEBP")
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Máximo 5 MB")
    photos_dir = settings.upload_path / "photos"
    photos_dir.mkdir(parents=True, exist_ok=True)
    sha = hashlib.sha256(content).hexdigest()[:16]
    fname = f"{target.id}_{sha}.{ext}"
    (photos_dir / fname).write_bytes(content)
    target.photo_url = f"/api/v1/users/{target.id}/photo/{fname}"


@router.post("/me/photo")
async def upload_my_photo(
    request: Request,
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    target = await _current_db_user(user, db)
    await save_user_photo(target, file)
    await db.commit()
    await db.refresh(target)
    await record_action(db, user_id=user.id, action="upload_own_photo", resource_type="user",
                        resource_id=target.id, ip=client_ip(request))
    return _user_payload(target)
