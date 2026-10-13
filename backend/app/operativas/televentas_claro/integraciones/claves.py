"""Claves de API: generar, reconocer, validar, limitar y registrar cada uso."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import ACTIVA, BLOQUEADA, PREFIJO, ApiClave, ApiUso

ZONA = ZoneInfo("America/Asuncion")
LARGO_SECRETO = 40          # caracteres hexadecimales después del prefijo (160 bits)
VISIBLES = 8                # cuántos se muestran para reconocer la clave
MAX_LIMITE_MINUTO, MAX_LIMITE_DIA = 600, 100_000
MAX_VIGENCIA_DIAS = 730


class ClaveRechazada(Exception):
    """Por qué no se atiende la llamada: el `resultado` queda en el registro de uso."""

    def __init__(self, codigo: int, resultado: str, mensaje: str, retry: Optional[int] = None):
        super().__init__(mensaje)
        self.codigo, self.resultado, self.mensaje, self.retry = codigo, resultado, mensaje, retry


def ahora() -> datetime:
    return datetime.now(timezone.utc)


def generar() -> tuple[str, str, str]:
    """(secreto completo, prefijo visible, hash). El secreto se muestra una sola vez."""
    secreto = PREFIJO + secrets.token_hex(LARGO_SECRETO // 2)
    return secreto, secreto[: len(PREFIJO) + VISIBLES], hash_de(secreto)


def hash_de(secreto: str) -> str:
    return hashlib.sha256(secreto.encode()).hexdigest()


def es_clave(valor: Optional[str]) -> bool:
    return bool(valor) and valor.startswith(PREFIJO)


def secreto_del_pedido(request: Request) -> Optional[str]:
    """La clave viene como `Authorization: Bearer vcop_…` (lo que manda el nodo GET Request de KNIME) o `X-API-Key`."""
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        v = auth[7:].strip()
        if es_clave(v):
            return v
    v = request.headers.get("x-api-key")
    return v.strip() if es_clave(v) else None


def vigente(c: ApiClave, en: Optional[datetime] = None) -> bool:
    en = en or ahora()
    return c.estado == ACTIVA and (c.expira_at is None or _utc(c.expira_at) > en)


def _utc(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def inicio_del_dia(en: Optional[datetime] = None) -> datetime:
    """Medianoche de Asunción (el límite diario es del día de la operación, no del UTC)."""
    local = (en or ahora()).astimezone(ZONA)
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)


async def buscar(db: AsyncSession, secreto: str) -> Optional[ApiClave]:
    """La clave del secreto, si existe (comparación del hash en tiempo constante)."""
    h = hash_de(secreto)
    rows = (await db.execute(select(ApiClave).where(ApiClave.prefijo == secreto[: len(PREFIJO) + VISIBLES]))).scalars().all()
    for c in rows:
        if hmac.compare_digest(c.hash, h):
            return c
    return None


async def contar_usos(db: AsyncSession, clave_id: str, desde: datetime) -> int:
    q = select(func.count()).select_from(ApiUso).where(ApiUso.clave_id == clave_id, ApiUso.resultado == "ok", ApiUso.at >= desde)
    return int((await db.execute(q)).scalar() or 0)


async def validar(db: AsyncSession, secreto: str, dataset: Optional[str]) -> ApiClave:
    """La clave que puede atender el pedido; si no, `ClaveRechazada` con el motivo (queda registrado igual)."""
    c = await buscar(db, secreto)
    if c is None:
        raise ClaveRechazada(status.HTTP_401_UNAUTHORIZED, "denegada", "Clave de API desconocida")
    en = ahora()
    if c.estado == BLOQUEADA:
        raise _rechazo(c, 403, "La clave está bloqueada")
    if c.expira_at is not None and _utc(c.expira_at) <= en:
        raise _rechazo(c, 403, f"La clave venció el {_utc(c.expira_at).astimezone(ZONA):%d/%m/%Y}")
    if dataset and c.datasets and dataset not in c.datasets:
        raise _rechazo(c, 403, f"La clave no tiene acceso al dataset «{dataset}»")
    minuto = await contar_usos(db, c.id, en - timedelta(seconds=60))
    if minuto >= c.limite_minuto:
        raise _rechazo(c, 429, f"Límite de {c.limite_minuto} llamadas por minuto superado", "limite", 60)
    dia = await contar_usos(db, c.id, inicio_del_dia(en))
    if dia >= c.limite_dia:
        fin = inicio_del_dia(en) + timedelta(days=1)
        raise _rechazo(c, 429, f"Límite de {c.limite_dia} llamadas por día superado", "limite",
                       max(60, int((fin - en).total_seconds())))
    return c


def _rechazo(c: ApiClave, codigo: int, mensaje: str, resultado: str = "denegada", retry: Optional[int] = None) -> ClaveRechazada:
    r = ClaveRechazada(codigo, resultado, mensaje, retry)
    r.clave = c  # type: ignore[attr-defined]
    return r


async def registrar(db: AsyncSession, clave: Optional[ApiClave], request: Request, *, dataset: Optional[str], status_code: int,
                    resultado: str, filas: int = 0, ms: int = 0, detalle: Optional[str] = None, prefijo: Optional[str] = None) -> None:
    """Deja el registro del uso (también de los rechazados, para que el superadmin vea intentos y abusos)."""
    ip = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip() or (request.client.host if request.client else None)
    uso = ApiUso(
        clave_id=clave.id if clave else "desconocida", clave_prefijo=(clave.prefijo if clave else (prefijo or "?"))[:16],
        clave_nombre=clave.nombre if clave else "(clave desconocida)", dataset=(dataset or None),
        ruta=str(request.url.path)[:300], ip=(ip or None), user_agent=(request.headers.get("user-agent") or "")[:200] or None,
        status=status_code, resultado=resultado, filas=filas, ms=ms, detalle=(detalle or None),
    )
    db.add(uso)
    if clave is not None and resultado == "ok":
        clave.usos = (clave.usos or 0) + 1
        clave.ultimo_uso_at, clave.ultimo_ip = ahora(), (ip or None)[:64] if ip else None
    await db.commit()


def clave_dict(c: ApiClave, usos_hoy: int = 0, rechazos_hoy: int = 0) -> dict[str, Any]:
    en = ahora()
    return {
        "id": c.id, "nombre": c.nombre, "prefijo": c.prefijo, "owner_id": c.owner_id, "owner": c.owner_nombre,
        "created_at": _iso(c.created_at), "expira_at": _iso(c.expira_at),
        "vencida": c.expira_at is not None and _utc(c.expira_at) <= en,
        "estado": c.estado, "bloqueada_at": _iso(c.bloqueada_at), "motivo_bloqueo": c.motivo_bloqueo,
        "limite_minuto": c.limite_minuto, "limite_dia": c.limite_dia, "datasets": list(c.datasets or []),
        "ultimo_uso_at": _iso(c.ultimo_uso_at), "ultimo_ip": c.ultimo_ip, "usos": c.usos or 0,
        "usos_hoy": usos_hoy, "rechazos_hoy": rechazos_hoy,
    }


def uso_dict(u: ApiUso) -> dict[str, Any]:
    return {"id": u.id, "clave_id": u.clave_id, "clave": u.clave_nombre, "prefijo": u.clave_prefijo, "at": _iso(u.at),
            "dataset": u.dataset, "ruta": u.ruta, "ip": u.ip, "user_agent": u.user_agent, "status": u.status,
            "resultado": u.resultado, "filas": u.filas, "ms": u.ms, "detalle": u.detalle}


def _iso(d: Optional[datetime]) -> Optional[str]:
    return _utc(d).isoformat() if d else None


def http_error(r: ClaveRechazada) -> HTTPException:
    return HTTPException(r.codigo, r.mensaje, headers={"Retry-After": str(r.retry)} if r.retry else None)
