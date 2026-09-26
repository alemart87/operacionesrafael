"""Reglas de seguridad de acceso que configura el superadmin.

Todo se decide en el servidor: sesiones (inactividad, vencimiento, cierre a
distancia), horarios por perfil con feriados y excepciones, bloqueo por
intentos fallidos, política de contraseñas y segundo factor (TOTP, opcional).
"""
from __future__ import annotations

import base64
import copy
import hashlib
import hmac
import io
import re
import secrets
import struct
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.security import verify_password
from ..models.seguridad import SecuritySettings

DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
PERFILES_CON_HORARIO = ["coordinador", "supervisor", "analista", "cliente"]
MODOS_HORARIO = ["desactivado", "registrar", "bloquear"]


def _franjas_laborales() -> dict[str, list[list[str]]]:
    return {str(d): ([["07:00", "19:00"]] if d < 5 else [["08:00", "12:00"]] if d == 5 else []) for d in range(7)}


DEFAULTS: dict[str, Any] = {
    "sesion": {"access_minutos": 15, "inactividad_minutos": 60, "duracion_max_horas": 12},
    "bloqueo": {"max_intentos": 5, "ventana_minutos": 15, "bloqueo_minutos": 30},
    "contrasenas": {"min_largo": 10, "mayus_minus": True, "numero": True, "simbolo": False,
                    "vencimiento_dias": 90, "historial": 5, "cambio_primer_ingreso": True},
    "dos_factores": {"recomendado": True},
    "horarios": {
        "modo": "desactivado", "zona": "America/Asuncion", "aviso_minutos": 10, "feriados": [],
        "perfiles": {p: {"activo": True, "dias": _franjas_laborales()} for p in PERFILES_CON_HORARIO},
    },
}


def _defaults() -> dict[str, Any]:
    """DEFAULTS con lo que fije SECURITY_DEFAULTS (JSON parcial) en el entorno."""
    import json
    extra = {}
    if settings.security_defaults:
        try:
            extra = json.loads(settings.security_defaults)
        except ValueError:
            extra = {}
    return _merge(DEFAULTS, extra)


def _merge(base: dict, extra: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) and k != "dias" else v
    return out


async def cargar_fila(db: AsyncSession) -> SecuritySettings:
    row = await db.get(SecuritySettings, 1)
    if row is None:
        row = SecuritySettings(id=1, data={})
        db.add(row)
        await db.flush()
    return row


async def config(db: AsyncSession) -> dict[str, Any]:
    row = await db.get(SecuritySettings, 1)
    return _merge(_defaults(), row.data if row else {})


# ------------------------------------------------------------------ validación de la configuración
_HORA = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$|^24:00$")


def validar_config(c: dict[str, Any]) -> dict[str, Any]:
    """Valida y normaliza lo que manda la pantalla. Lanza ValueError con un mensaje claro."""
    c = _merge(_defaults(), c)
    s, b, p, h = c["sesion"], c["bloqueo"], c["contrasenas"], c["horarios"]
    def rango(v, lo, hi, nombre):
        if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
            raise ValueError(f"{nombre}: debe ser un número entre {lo} y {hi}")
    rango(s["access_minutos"], 5, 120, "Duración del token")
    rango(s["inactividad_minutos"], 5, 480, "Cierre por inactividad")
    rango(s["duracion_max_horas"], 1, 168, "Duración máxima de la sesión")
    rango(b["max_intentos"], 3, 20, "Intentos fallidos")
    rango(b["ventana_minutos"], 1, 1440, "Ventana de intentos")
    rango(b["bloqueo_minutos"], 0, 10080, "Duración del bloqueo")
    rango(p["min_largo"], 8, 64, "Largo mínimo")
    rango(p["vencimiento_dias"], 0, 730, "Vencimiento de contraseña")
    rango(p["historial"], 0, 24, "Contraseñas anteriores")
    rango(h["aviso_minutos"], 0, 60, "Aviso antes del cierre")
    if h["modo"] not in MODOS_HORARIO:
        raise ValueError("Modo de horario inválido")
    try:
        ZoneInfo(h["zona"])
    except Exception as exc:
        raise ValueError("Zona horaria inválida") from exc
    feriados = []
    for f in h.get("feriados") or []:
        try:
            feriados.append(date.fromisoformat(str(f)[:10]).isoformat())
        except ValueError as exc:
            raise ValueError(f"Feriado inválido: {f}") from exc
    h["feriados"] = sorted(set(feriados))
    for perfil, cfg in h["perfiles"].items():
        if perfil not in PERFILES_CON_HORARIO:
            raise ValueError(f"Perfil desconocido: {perfil}")
        for d in range(7):
            franjas = cfg.get("dias", {}).get(str(d), [])
            for fr in franjas:
                if len(fr) != 2 or not _HORA.match(fr[0]) or not _HORA.match(fr[1]) or fr[0] >= fr[1]:
                    raise ValueError(f"Franja inválida para {perfil} ({DIAS[d]}): {fr}")
            cfg.setdefault("dias", {})[str(d)] = sorted(franjas)
    return c


# ------------------------------------------------------------------ horarios
def _minutos(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def evaluar_horario(cfg: dict[str, Any], role: str, ahora: datetime, excepcion_hasta: datetime | None = None) -> dict[str, Any]:
    """¿Puede usar la plataforma ahora? Devuelve {permitido, hasta (UTC o None), motivo}.

    El superadmin nunca tiene restricción. Una excepción vigente habilita fuera de horario.
    """
    h = cfg["horarios"]
    if role == "superadmin" or h["modo"] == "desactivado":
        return {"permitido": True, "hasta": None, "motivo": None}
    perfil = h["perfiles"].get(role)
    if not perfil or not perfil.get("activo", True):
        return {"permitido": True, "hasta": None, "motivo": None}
    if excepcion_hasta and ahora < excepcion_hasta:
        return {"permitido": True, "hasta": excepcion_hasta, "motivo": "excepcion"}
    tz = ZoneInfo(h["zona"])
    local = ahora.astimezone(tz)
    if local.date().isoformat() in h["feriados"]:
        return {"permitido": False, "hasta": None, "motivo": "feriado"}
    ahora_min = local.hour * 60 + local.minute
    for desde, hasta in perfil["dias"].get(str(local.weekday()), []):
        if _minutos(desde) <= ahora_min < _minutos(hasta):
            fin = local.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(minutes=_minutos(hasta))
            return {"permitido": True, "hasta": fin.astimezone(timezone.utc), "motivo": None}
    return {"permitido": False, "hasta": None, "motivo": "fuera_de_horario"}


def texto_horario(cfg: dict[str, Any], role: str) -> str:
    perfil = cfg["horarios"]["perfiles"].get(role) or {}
    partes = []
    for d in range(7):
        fr = perfil.get("dias", {}).get(str(d), [])
        if fr:
            partes.append(f"{DIAS[d]} " + ", ".join(f"{a} a {b}" for a, b in fr))
    return "; ".join(partes) or "sin franjas habilitadas"


# ------------------------------------------------------------------ contraseñas
def validar_contrasena(cfg: dict[str, Any], nueva: str, historial: list[str] | None = None, actual_hash: str | None = None) -> None:
    p = cfg["contrasenas"]
    errores = []
    if len(nueva) < p["min_largo"]:
        errores.append(f"al menos {p['min_largo']} caracteres")
    if p["mayus_minus"] and not (re.search(r"[a-záéíóúñ]", nueva) and re.search(r"[A-ZÁÉÍÓÚÑ]", nueva)):
        errores.append("mayúsculas y minúsculas")
    if p["numero"] and not re.search(r"\d", nueva):
        errores.append("al menos un número")
    if p["simbolo"] and not re.search(r"[^\w\s]", nueva):
        errores.append("al menos un símbolo")
    if errores:
        raise ValueError("La contraseña debe tener " + ", ".join(errores) + ".")
    previas = ([actual_hash] if actual_hash else []) + list(historial or [])[: p["historial"]]
    if any(verify_password(nueva, h) for h in previas if h):
        raise ValueError(f"No podés repetir la contraseña actual ni las últimas {p['historial']}.")


def nuevo_historial(cfg: dict[str, Any], historial: list[str] | None, hash_anterior: str | None) -> list[str]:
    n = cfg["contrasenas"]["historial"]
    return ([hash_anterior] if hash_anterior else []) + list(historial or [])[: max(n - 1, 0)] if n else []


def contrasena_vencida(cfg: dict[str, Any], cambiada: datetime | None, ahora: datetime) -> bool:
    dias = cfg["contrasenas"]["vencimiento_dias"]
    if not dias or not cambiada:
        return False
    if cambiada.tzinfo is None:
        cambiada = cambiada.replace(tzinfo=timezone.utc)
    return ahora - cambiada > timedelta(days=dias)


# ------------------------------------------------------------------ segundo factor (TOTP, RFC 6238)
def _fernet() -> Fernet:
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("totp|" + settings.secret_key).encode()).digest()))


def cifrar(secreto: str) -> str:
    return _fernet().encrypt(secreto.encode()).decode()


def descifrar(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return None


def nuevo_secreto() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _totp(secreto: str, contador: int) -> str:
    key = base64.b32decode(secreto + "=" * (-len(secreto) % 8))
    h = hmac.new(key, struct.pack(">Q", contador), hashlib.sha1).digest()
    o = h[-1] & 0x0F
    return f"{(struct.unpack('>I', h[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}"


def verificar_totp(secreto: str | None, codigo: str, ahora: float | None = None) -> bool:
    codigo = re.sub(r"\s", "", codigo or "")
    if not secreto or not re.fullmatch(r"\d{6}", codigo):
        return False
    t = int((ahora if ahora is not None else time.time()) // 30)
    return any(hmac.compare_digest(_totp(secreto, t + d), codigo) for d in (-1, 0, 1))


def uri_totp(secreto: str, email: str) -> str:
    emisor = "Operaciones Voicenter"
    return f"otpauth://totp/{quote(emisor)}:{quote(email)}?secret={secreto}&issuer={quote(emisor)}&digits=6&period=30"


def qr_svg(uri: str) -> str:
    import segno
    buf = io.BytesIO()
    segno.make(uri, error="m").save(buf, kind="svg", scale=5, border=2, dark="#0F1116", xmldecl=False)
    svg = buf.getvalue().decode()
    # Con viewBox el QR se escala al contenedor en vez de desbordarlo.
    return re.sub(r'width="(\d+)" height="(\d+)"', r'viewBox="0 0 \1 \2" width="100%"', svg, count=1)


def codigos_recuperacion() -> tuple[list[str], list[str]]:
    """8 códigos de un solo uso: se muestran una vez y se guardan hasheados."""
    planos = [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}".upper() for _ in range(8)]
    return planos, [hashlib.sha256(c.encode()).hexdigest() for c in planos]


def usar_codigo_recuperacion(guardados: list[str] | None, codigo: str) -> list[str] | None:
    """Si el código es válido devuelve la lista sin él; si no, None."""
    h = hashlib.sha256(re.sub(r"\s", "", codigo or "").upper().encode()).hexdigest()
    if guardados and h in guardados:
        return [x for x in guardados if x != h]
    return None
