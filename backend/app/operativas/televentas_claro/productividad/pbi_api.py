"""Tablero Power BI de Productividad — Televentas Claro.

* `televentas_claro.productividad_pbi` (gerente, sub gerente y coordinador; y el superadmin): **Cargar PBI** — pegar el
  código del iframe de Power BI («Archivo → Insertar informe → Publicar en la web») para un día, guardarlo o publicarlo,
  publicar uno guardado y eliminar. Uno publicado por día: el nuevo reemplaza al anterior del mismo día.
* Lo ven publicado los supervisores en su portal («Tablero») y quienes ven Productividad: el del día más nuevo, con los
  días anteriores a mano.

Seguridad: del código pegado se toma solo el `src`, que tiene que ser `https://app.powerbi.com` o
`https://app.fabric.microsoft.com` (`/view` o `/reportEmbed`); se guarda el link reconstruido y la proporción, nunca el
HTML. Cargar, publicar y eliminar quedan en la auditoría.
"""
from __future__ import annotations

import html
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, client_ip, get_current_user, require_perm
from ....core.database import get_db
from ....models.user import User
from ....services.audit_service import record_action
from .models import ESTADO_BORRADOR, ESTADO_PUBLICADO, ESTADO_REEMPLAZADO, ProdPbi
from .parser import ZONA

PERM_PBI = "televentas_claro.productividad_pbi"
PERMS_VER = ("televentas_claro.productividad", "televentas_claro.portal_supervisor", PERM_PBI)
HOSTS = {"app.powerbi.com", "app.fabric.microsoft.com"}
RUTAS = ("/view", "/reportembed")
DIAS_ATRAS = 14        # días publicados que se ofrecen para mirar hacia atrás
MAX_CODIGO = 5000

router = APIRouter(prefix="/televentas-claro/productividad", tags=["televentas-claro · tablero power bi"])
require_pbi = require_perm(PERM_PBI)


async def require_ver_pbi(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not any(user.has_perm(p) for p in PERMS_VER):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenés acceso al tablero")
    return user


class CodigoInvalido(ValueError):
    pass


_ATTR = re.compile(r"""\b(src|title|width|height)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))""", re.IGNORECASE)


def _num(v: str | None, defecto: float) -> float:
    try:
        x = float((v or "").strip().rstrip("px"))
    except ValueError:
        return defecto
    return x if 50 <= x <= 10000 else defecto


def interpretar(codigo: str) -> dict[str, Any]:
    """El código del iframe (o el link solo) → {url, titulo, ancho, alto}. Rechaza todo lo que no sea Power BI / Fabric."""
    codigo = (codigo or "").strip()
    if not codigo:
        raise CodigoInvalido("Pegá el código del iframe de Power BI")
    if len(codigo) > MAX_CODIGO:
        raise CodigoInvalido("El código es demasiado largo: pegá solo el iframe")
    attrs: dict[str, str] = {}
    if "<" in codigo:
        if not re.match(r"^\s*<iframe\b", codigo, re.IGNORECASE):
            raise CodigoInvalido("Tiene que ser el código <iframe …> que da Power BI al «Publicar en la web»")
        for m in _ATTR.finditer(codigo):
            attrs.setdefault(m.group(1).lower(), html.unescape(next(g for g in m.groups()[2:] if g is not None)))
        src = attrs.get("src", "")
    else:
        src = codigo
    p = urlsplit(src.strip())
    if p.scheme != "https" or (p.hostname or "").lower() not in HOSTS or p.username or p.password or p.port not in (None, 443):
        raise CodigoInvalido("El link tiene que ser de Power BI (https://app.powerbi.com o https://app.fabric.microsoft.com)")
    ruta = p.path.lower().rstrip("/") or "/"
    if not any(ruta == r or ruta.startswith(r + "/") for r in RUTAS):
        raise CodigoInvalido("El link tiene que ser de un informe publicado (…/view?r=… o …/reportEmbed?…)")
    params = parse_qsl(p.query, keep_blank_values=False)
    if ruta.startswith("/view") and not any(k == "r" and v for k, v in params):
        raise CodigoInvalido("Falta el código del informe en el link (?r=…)")
    url = urlunsplit(("https", p.hostname.lower(), p.path, urlencode(params), ""))
    titulo = " ".join((attrs.get("title") or "").split())[:120] or "Tablero de Power BI"
    return {"url": url, "titulo": titulo, "ancho": _num(attrs.get("width"), 600.0), "alto": _num(attrs.get("height"), 373.5)}


def _hoy() -> date:
    return datetime.now(timezone.utc).astimezone(ZONA).date()


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


async def _nombres(db: AsyncSession, ids: set[str | None]) -> dict[str, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {i: n for i, n in (await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))).all()}


def a_dict(x: ProdPbi, nombres: dict[str, str]) -> dict[str, Any]:
    return {"id": x.id, "fecha": x.fecha.isoformat(), "titulo": x.titulo, "url": x.url, "ancho": x.ancho, "alto": x.alto,
            "estado": {ESTADO_PUBLICADO: "publicado", ESTADO_BORRADOR: "guardado", ESTADO_REEMPLAZADO: "reemplazado"}.get(x.status, x.status),
            "cargado_por": nombres.get(x.created_by), "cargado_at": x.created_at.isoformat() if x.created_at else None,
            "publicado_por": nombres.get(x.published_by or ""), "publicado_at": x.published_at.isoformat() if x.published_at else None}


async def _publicar(db: AsyncSession, x: ProdPbi, user: CurrentUser) -> None:
    for otro in (await db.execute(select(ProdPbi).where(ProdPbi.fecha == x.fecha, ProdPbi.status == ESTADO_PUBLICADO,
                                                        ProdPbi.id != x.id))).scalars().all():
        otro.status = ESTADO_REEMPLAZADO
    x.status, x.published_at, x.published_by = ESTADO_PUBLICADO, _ahora(), user.id


# ------------------------------------------------------------------ ver (supervisores y Productividad)
@router.get("/pbi/publicado")
async def publicado(fecha: Optional[date] = Query(None), user: CurrentUser = Depends(require_ver_pbi),
                    db: AsyncSession = Depends(get_db)) -> dict:
    """El tablero publicado del día más nuevo (o del día pedido) y los días publicados para mirar hacia atrás."""
    pub = list((await db.execute(select(ProdPbi).where(ProdPbi.status == ESTADO_PUBLICADO)
                                 .order_by(ProdPbi.fecha.desc()).limit(DIAS_ATRAS))).scalars().all())
    x = next((p for p in pub if p.fecha == fecha), None) if fecha else (pub[0] if pub else None)
    if fecha and x is None:
        x = (await db.execute(select(ProdPbi).where(ProdPbi.status == ESTADO_PUBLICADO, ProdPbi.fecha == fecha))).scalars().first()
    nombres = await _nombres(db, {x.published_by} if x else set())
    return {"hoy": _hoy().isoformat(), "tablero": a_dict(x, nombres) if x else None,
            "dias": [p.fecha.isoformat() for p in pub], "puede_cargar": user.has_perm(PERM_PBI)}


# ------------------------------------------------------------------ cargar (publicadores)
@router.get("/pbi")
async def historial(user: CurrentUser = Depends(require_pbi), db: AsyncSession = Depends(get_db)) -> dict:
    """Lo cargado de los últimos 60 días: publicados, guardados y reemplazados."""
    filas = list((await db.execute(select(ProdPbi).where(ProdPbi.fecha >= _hoy() - timedelta(days=60))
                                   .order_by(ProdPbi.fecha.desc(), ProdPbi.created_at.desc()))).scalars().all())
    nombres = await _nombres(db, {f.created_by for f in filas} | {f.published_by for f in filas})
    return {"hoy": _hoy().isoformat(), "tableros": [a_dict(f, nombres) for f in filas]}


class CargarPayload(BaseModel):
    codigo: str = Field(..., max_length=MAX_CODIGO)
    fecha: Optional[date] = None
    titulo: Optional[str] = Field(None, max_length=120)
    publicar: bool = True


@router.post("/pbi/validar")
async def validar(payload: CargarPayload, user: CurrentUser = Depends(require_pbi)) -> dict:
    """Interpreta el código sin guardar nada (para la vista previa)."""
    try:
        return interpretar(payload.codigo)
    except CodigoInvalido as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.post("/pbi", status_code=status.HTTP_201_CREATED)
async def cargar(payload: CargarPayload, request: Request, user: CurrentUser = Depends(require_pbi),
                 db: AsyncSession = Depends(get_db)) -> dict:
    try:
        d = interpretar(payload.codigo)
    except CodigoInvalido as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    fecha = payload.fecha or _hoy()
    if fecha > _hoy() or fecha < _hoy() - timedelta(days=60):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Elegí hoy o un día de los últimos 60")
    titulo = " ".join((payload.titulo or "").split())[:120] or d["titulo"]
    x = ProdPbi(fecha=fecha, titulo=titulo, url=d["url"], ancho=d["ancho"], alto=d["alto"], created_by=user.id)
    db.add(x)
    await db.flush()
    if payload.publicar:
        await _publicar(db, x, user)
    await db.commit()
    await record_action(db, user_id=user.id, action="pbi_publicado" if payload.publicar else "pbi_cargado", resource_type="prod_pbi",
                        resource_id=x.id, ip=client_ip(request), extra={"fecha": fecha.isoformat(), "titulo": titulo, "host": urlsplit(x.url).hostname})
    return a_dict(x, await _nombres(db, {x.created_by, x.published_by}))


async def _uno(db: AsyncSession, pbi_id: str) -> ProdPbi:
    x = await db.get(ProdPbi, pbi_id)
    if not x:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tablero no encontrado")
    return x


@router.post("/pbi/{pbi_id}/publicar")
async def publicar(pbi_id: str, request: Request, user: CurrentUser = Depends(require_pbi), db: AsyncSession = Depends(get_db)) -> dict:
    x = await _uno(db, pbi_id)
    if x.status == ESTADO_PUBLICADO:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ya está publicado")
    await _publicar(db, x, user)
    await db.commit()
    await record_action(db, user_id=user.id, action="pbi_publicado", resource_type="prod_pbi", resource_id=x.id, ip=client_ip(request),
                        extra={"fecha": x.fecha.isoformat(), "titulo": x.titulo})
    return a_dict(x, await _nombres(db, {x.created_by, x.published_by}))


@router.delete("/pbi/{pbi_id}")
async def eliminar(pbi_id: str, request: Request, user: CurrentUser = Depends(require_pbi), db: AsyncSession = Depends(get_db)) -> dict:
    """Elimina un tablero. Si era el publicado de su día, ese día vuelve al anterior publicado (si había uno reemplazado)."""
    x = await _uno(db, pbi_id)
    era_publicado = x.status == ESTADO_PUBLICADO
    fecha, titulo = x.fecha, x.titulo
    await db.delete(x)
    if era_publicado:
        previo = (await db.execute(select(ProdPbi).where(ProdPbi.fecha == fecha, ProdPbi.status == ESTADO_REEMPLAZADO, ProdPbi.id != pbi_id)
                                   .order_by(ProdPbi.published_at.desc()).limit(1))).scalars().first()
        if previo:
            previo.status = ESTADO_PUBLICADO
    await db.commit()
    await record_action(db, user_id=user.id, action="pbi_eliminado", resource_type="prod_pbi", resource_id=pbi_id, ip=client_ip(request),
                        extra={"fecha": fecha.isoformat(), "titulo": titulo, "era_publicado": era_publicado})
    return {"ok": True}
