"""API del SPH estimado — Televentas Claro.

Permisos:
* `televentas_claro.sph`          → ver los informes SPH PUBLICADOS.
* `televentas_claro.sph_gestion`  → calcular, ver borradores, publicar, reemplazar, recalcular,
                                    eliminar y vincular agentes con vendedores a mano.

Períodos: un día, una semana (lunes a domingo), un mes o un rango de hasta 62 días. El período
suma día por día: cuenta cada día que tiene informe de Productividad (horas) y que el corte de
ventas de su mes ya alcanza; los demás se informan.

Fuentes (no se sube nada nuevo): por día, el informe de Productividad publicado (si no hay, el
borrador más reciente); por mes, el informe de Ventas Netas publicado (si no hay, el borrador con
el corte más nuevo). Queda avisado si se usó un borrador. El SPH queda congelado con esos datos.

Circuito (el mismo de Productividad): "Calcular" crea o rehace el borrador del período; como
máximo hay un SPH publicado por período. Publicar sobre un período que ya tiene uno exige
`confirm_replace=True` (si no, 409 con los datos del publicado). Un publicado no cambia:
recalcular genera otro borrador.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from ....api.deps import CurrentUser, client_ip, require_perm
from ....core.config import settings
from ....core.database import get_db
from ....models.user import User
from ....services.audit_service import record_action
from ..productividad.models import ESTADO_BORRADOR as PROD_BORRADOR
from ..productividad.models import ESTADO_PUBLICADO as PROD_PUBLICADO
from ..productividad.models import ProdInforme
from ..ventas_netas.models import ESTADO_BORRADOR as VN_BORRADOR
from ..ventas_netas.models import ESTADO_PUBLICADO as VN_PUBLICADO
from ..ventas_netas.models import VentasNetasReport
from .analyzer import (
    DIAS_MAX_PERIODO, SIN_VENDEDOR, VERSION_SPH, DatosIncompletos, calcular_periodo, nombre_mes, resumen_lista, tipo_periodo,
)
from .models import ESTADO_BORRADOR, ESTADO_PUBLICADO, ESTADO_REEMPLAZADO, SphInforme, SphVinculo

PERM_VER = "televentas_claro.sph"
PERM_GESTION = "televentas_claro.sph_gestion"
require_ver = require_perm(PERM_VER)
require_gestion = require_perm(PERM_GESTION)

router = APIRouter(prefix="/televentas-claro/sph", tags=["televentas-claro · sph"])

DIAS_DISPONIBLES = 62
# Un solo proceso atiende la API: este lock evita dos borradores del mismo período por cálculos simultáneos.
_lock = asyncio.Lock()


# ------------------------------------------------------------------ utilidades
def _utc(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=timezone.utc) if d is not None and d.tzinfo is None else d


def _iso(d: datetime | None) -> str | None:
    d = _utc(d)
    return d.isoformat() if d else None


def _mes(d: date) -> str:
    return d.strftime("%Y-%m")


def _dias(desde: date, hasta: date) -> list[date]:
    return [desde + timedelta(days=i) for i in range((hasta - desde).days + 1)]


def _lista(x: Any) -> list[dict[str, Any]]:
    """Las fuentes de la v1 venían como un solo dict; desde la v2, en listas."""
    return x if isinstance(x, list) else [x] if x else []


async def _nombres(db: AsyncSession, ids: set[str | None]) -> dict[str, str]:
    ids = {i for i in ids if i}
    out = {"superadmin": settings.superadmin_name}
    if ids:
        rows = await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))
        out.update({i: n for i, n in rows.all()})
    return out


def _hasta(r: SphInforme) -> date:
    return r.hasta or r.fecha


def _resumen(r: SphInforme) -> dict[str, Any]:
    return {
        "id": r.id, "fecha": r.fecha.isoformat(), "desde": r.fecha.isoformat(), "hasta": _hasta(r).isoformat(),
        "tipo": r.tipo or "dia", "dias": r.dias or 1, "status": r.status,
        "generated_at": _iso(r.generated_at), "generated_by": r.generated_by,
        "published_at": _iso(r.published_at), "published_by": r.published_by,
        "replaced_at": _iso(r.replaced_at), "replaced_by_report_id": r.replaced_by_report_id,
        "sph": r.sph, "netas": r.netas, "horas": r.horas, "agentes": r.agentes, "vinculados": r.vinculados,
        "pct_cobertura": r.pct_cobertura, "pct_activadas": r.pct_activadas,
        "ventas_corte": r.ventas_corte.isoformat() if r.ventas_corte else None,
    }


def _del_periodo(desde: date, hasta: date):
    """Condición SQL: el informe es exactamente de ese período (los de la v1 no tienen `hasta`)."""
    return (SphInforme.fecha == desde) & (func.coalesce(SphInforme.hasta, SphInforme.fecha) == hasta)


def _etiqueta(desde: date, hasta: date) -> str:
    tipo = tipo_periodo(desde, hasta)
    if tipo == "dia":
        return f"el {desde:%d/%m/%Y}"
    if tipo == "mes":
        return nombre_mes(_mes(desde))
    return f"el período del {desde:%d/%m} al {hasta:%d/%m/%Y}"


# ------------------------------------------------------------------ fuentes del período
async def _informes_productividad(db: AsyncSession, desde: date, hasta: date) -> dict[date, ProdInforme]:
    """Por día: el publicado; si no hay, el borrador más reciente."""
    rows = (await db.execute(select(ProdInforme).where(
        ProdInforme.fecha >= desde, ProdInforme.fecha <= hasta,
        ProdInforme.status.in_([PROD_PUBLICADO, PROD_BORRADOR]),
    ))).scalars().all()
    out: dict[date, ProdInforme] = {}
    for r in sorted(rows, key=lambda r: (r.status == PROD_PUBLICADO, _utc(r.generated_at) or datetime.min.replace(tzinfo=timezone.utc))):
        out[r.fecha] = r  # queda el mejor: publicado > generado más tarde
    return out


async def _informes_ventas(db: AsyncSession, periodos: set[str]) -> dict[str, VentasNetasReport]:
    """Por mes: el publicado; si no hay, el borrador con el corte más reciente."""
    if not periodos:
        return {}
    rows = (await db.execute(select(VentasNetasReport).where(
        VentasNetasReport.periodo.in_(periodos), VentasNetasReport.status.in_([VN_PUBLICADO, VN_BORRADOR]),
    ))).scalars().all()
    out: dict[str, VentasNetasReport] = {}
    for r in sorted(rows, key=lambda r: (r.status == VN_PUBLICADO, r.fecha_dato or date.min,
                                         _utc(r.generated_at) or datetime.min.replace(tzinfo=timezone.utc))):
        out[r.periodo] = r  # queda el mejor: publicado > corte más nuevo > generado más tarde
    return out


def _desc_prod(r: ProdInforme) -> dict[str, Any]:
    return {"id": r.id, "status": r.status, "fecha": r.fecha.isoformat(), "corte_final": r.corte_final,
            "agentes": r.agentes, "generated_at": _iso(r.generated_at)}


def _desc_ventas(r: VentasNetasReport) -> dict[str, Any]:
    return {"id": r.id, "status": r.status, "periodo": r.periodo,
            "fecha_dato": r.fecha_dato.isoformat() if r.fecha_dato else None, "netas": r.netas,
            "generated_at": _iso(r.generated_at)}


class Fuentes:
    """Qué hay para calcular un período: informes por día y por mes, y qué días cuentan."""

    def __init__(self, desde: date, hasta: date, prods: dict[date, ProdInforme], ventas: dict[str, VentasNetasReport]):
        self.desde, self.hasta, self.prods, self.ventas = desde, hasta, prods, ventas
        self.limite = min(hasta, date.today())  # el resto (p. ej. del mes en curso) todavía no pasó
        self.cobertura = []
        for d in _dias(desde, self.limite) if desde <= self.limite else []:
            p, v = prods.get(d), ventas.get(_mes(d))
            self.cobertura.append({
                "fecha": d.isoformat(),
                "productividad": p.status if p else None,
                "horas": bool(p and (p.agentes or (p.data or {}).get("agentes"))),
                "ventas": bool(v) and (v.fecha_dato is None or v.fecha_dato >= d),
            })
        self.cubiertos = [date.fromisoformat(c["fecha"]) for c in self.cobertura if c["horas"] and c["ventas"]]

    def motivo(self) -> str | None:
        """Por qué no se puede calcular (None si al menos un día cuenta)."""
        if self.desde > date.today():
            return "El período todavía no empezó."
        if self.cubiertos:
            return None
        con_horas = [date.fromisoformat(c["fecha"]) for c in self.cobertura if c["horas"]]
        if not con_horas:
            return (f"No hay informes de Productividad para {_etiqueta(self.desde, self.hasta)}: "
                    "subí los cortes de llamadas de esos días.")
        sin_informe = sorted({_mes(d) for d in con_horas if _mes(d) not in self.ventas})
        if sin_informe:
            return (f"No hay informe de Ventas Netas de {' ni de '.join(nombre_mes(m) for m in sin_informe)}: "
                    "subí un corte de ventas de ese mes.")
        v = self.ventas[_mes(con_horas[0])]
        return (f"El corte de ventas de {nombre_mes(v.periodo)} es del {v.fecha_dato:%d/%m}: todavía no trae las ventas de los "
                f"días con horas ({', '.join(f'{d:%d/%m}' for d in con_horas[:6])}). Subí un corte de ventas posterior.")

    def descripcion(self) -> dict[str, Any]:
        return {
            "productividad": [_desc_prod(self.prods[d]) for d in sorted(self.prods)],
            "ventas": [_desc_ventas(self.ventas[m]) for m in sorted(self.ventas)],
        }


async def _fuentes(db: AsyncSession, desde: date, hasta: date) -> Fuentes:
    prods = await _informes_productividad(db, desde, hasta)
    ventas = await _informes_ventas(db, {_mes(d) for d in _dias(desde, hasta)})
    return Fuentes(desde, hasta, prods, ventas)


async def _manuales(db: AsyncSession) -> dict[str, str | None]:
    return {v.clave: v.vendedor for v in (await db.execute(select(SphVinculo))).scalars().all()}


def _validar_periodo(desde: date | None, hasta: date | None) -> tuple[date, date]:
    if not desde:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Indicá el día o el período")
    hasta = hasta or desde
    if hasta < desde:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "La fecha final es anterior a la inicial")
    if (hasta - desde).days + 1 > DIAS_MAX_PERIODO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"El período puede tener hasta {DIAS_MAX_PERIODO} días")
    return desde, hasta


async def _calcular_borrador(db: AsyncSession, desde: date, hasta: date, user_id: str) -> SphInforme:
    """Calcula el SPH del período y lo deja en su borrador (lo crea si no hay). No hace commit."""
    f = await _fuentes(db, desde, hasta)
    motivo = f.motivo()
    if motivo:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "sin_fuente", "message": motivo})
    meses = {_mes(d) for d in f.cubiertos}
    usados = {"productividad": [_desc_prod(f.prods[d]) for d in f.cubiertos],
              "ventas": [_desc_ventas(f.ventas[m]) for m in sorted(meses)]}
    produccion = {d: f.prods[d].data or {} for d in f.cubiertos}
    ventas = {m: f.ventas[m].data or {} for m in meses}
    try:  # el cruce por nombre compara cientos de pares: fuera del loop del servidor
        data = await asyncio.to_thread(calcular_periodo, desde, hasta, produccion, ventas, usados, await _manuales(db),
                                       None, f.limite)
    except DatosIncompletos as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "datos_incompletos", "message": str(exc)}) from exc
    borrador = (await db.execute(
        select(SphInforme).where(_del_periodo(desde, hasta), SphInforme.status == ESTADO_BORRADOR)
        .order_by(SphInforme.generated_at.desc())
    )).scalars().first()
    if not borrador:
        borrador = SphInforme(fecha=desde, status=ESTADO_BORRADOR)
        db.add(borrador)
    ultimo = f.ventas[_mes(f.cubiertos[-1])]
    borrador.hasta, borrador.tipo = hasta, tipo_periodo(desde, hasta)
    borrador.data = data
    borrador.generated_at, borrador.generated_by = datetime.now(timezone.utc), user_id
    borrador.prod_informe_id = f.prods[desde].id if desde == hasta else None
    borrador.ventas_report_id, borrador.ventas_corte = ultimo.id, ultimo.fecha_dato
    for k, v in resumen_lista(data).items():
        setattr(borrador, k, v)
    return borrador


async def _informe_visible(db: AsyncSession, informe_id: str, user: CurrentUser) -> SphInforme:
    """Gestión ve todo; el resto solo lo publicado."""
    r = await db.get(SphInforme, informe_id)
    if not r or (r.status != ESTADO_PUBLICADO and not user.has_perm(PERM_GESTION)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    return r


# ------------------------------------------------------------------ fuentes y días disponibles
@router.get("/fuentes")
async def ver_fuentes(desde: Optional[date] = Query(None), hasta: Optional[date] = Query(None),
                      fecha: Optional[date] = Query(None, description="Un día (equivale a desde = hasta)"),
                      user: CurrentUser = Depends(require_gestion), db: AsyncSession = Depends(get_db)) -> dict:
    """Qué informes se usarían para calcular el SPH del período, qué días cuentan y si se puede."""
    desde, hasta = _validar_periodo(desde or fecha, hasta)
    f = await _fuentes(db, desde, hasta)
    motivo = f.motivo()
    sph = (await db.execute(select(SphInforme.status, SphInforme.id).where(
        _del_periodo(desde, hasta), SphInforme.status.in_([ESTADO_BORRADOR, ESTADO_PUBLICADO])))).all()
    return {
        "desde": desde.isoformat(), "hasta": hasta.isoformat(), "tipo": tipo_periodo(desde, hasta),
        **f.descripcion(),
        "cobertura": f.cobertura,
        "dias": (hasta - desde).days + 1, "dias_cubiertos": len(f.cubiertos),
        "puede_calcular": motivo is None, "motivo": motivo,
        "sph": {s: i for s, i in sph},
    }


@router.get("/dias")
async def dias_disponibles(user: CurrentUser = Depends(require_gestion), db: AsyncSession = Depends(get_db)) -> dict:
    """Días recientes con informe de Productividad: si las ventas los cubren y si ya tienen SPH del día."""
    desde = date.today() - timedelta(days=DIAS_DISPONIBLES)
    prod = (await db.execute(select(ProdInforme.fecha, ProdInforme.status).where(
        ProdInforme.fecha >= desde, ProdInforme.status.in_([PROD_PUBLICADO, PROD_BORRADOR]),
    ))).all()
    estado_prod: dict[date, str] = {}
    for f, s in prod:
        if estado_prod.get(f) != PROD_PUBLICADO:
            estado_prod[f] = s
    ventas = await _informes_ventas(db, {_mes(f) for f in estado_prod})
    sph = (await db.execute(select(SphInforme.fecha, SphInforme.status, SphInforme.id).where(
        SphInforme.fecha >= desde, func.coalesce(SphInforme.hasta, SphInforme.fecha) == SphInforme.fecha,
        SphInforme.status.in_([ESTADO_BORRADOR, ESTADO_PUBLICADO]),
    ))).all()
    estado_sph: dict[date, dict[str, str]] = {}
    for f, s, i in sph:
        estado_sph.setdefault(f, {})[s] = i
    dias = []
    for f in sorted(estado_prod, reverse=True):
        v = ventas.get(_mes(f))
        dias.append({
            "fecha": f.isoformat(), "productividad": estado_prod[f],
            "ventas": v.status if v else None, "ventas_corte": v.fecha_dato.isoformat() if v and v.fecha_dato else None,
            "cubre": bool(v) and (v.fecha_dato is None or v.fecha_dato >= f),
            "sph": estado_sph.get(f, {}),
        })
    sugerida = next((d["fecha"] for d in dias if d["cubre"] and "published" not in d["sph"]), None)
    return {"dias": dias, "sugerida": sugerida}


# ------------------------------------------------------------------ calcular
class CalcularPayload(BaseModel):
    desde: Optional[date] = None
    hasta: Optional[date] = None
    fecha: Optional[date] = None  # un día (equivale a desde = hasta)


@router.post("/calcular", status_code=status.HTTP_201_CREATED)
async def calcular_sph(payload: CalcularPayload, request: Request, user: CurrentUser = Depends(require_gestion),
                       db: AsyncSession = Depends(get_db)) -> dict:
    desde, hasta = _validar_periodo(payload.desde or payload.fecha, payload.hasta)
    async with _lock:
        informe = await _calcular_borrador(db, desde, hasta, user.id)
        await db.commit()
        await db.refresh(informe)
    await record_action(db, user_id=user.id, action="sph_calculado", resource_type="sph_informe",
                        resource_id=informe.id, ip=client_ip(request),
                        extra={"desde": desde.isoformat(), "hasta": hasta.isoformat(), "sph": informe.sph, "netas": informe.netas})
    return {"informe": _resumen(informe)}


# ------------------------------------------------------------------ informes
@router.get("/informes")
async def listar_informes(user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    q = select(SphInforme).options(defer(SphInforme.data))  # la lista no necesita el detalle
    if not user.has_perm(PERM_GESTION):
        q = q.where(SphInforme.status == ESTADO_PUBLICADO)
    rows = (await db.execute(q.order_by(SphInforme.fecha.desc(), SphInforme.generated_at.desc()).limit(800))).scalars().all()
    nombres = await _nombres(db, {r.published_by for r in rows} | {r.generated_by for r in rows})
    return {"items": [_resumen(r) for r in rows], "total": len(rows), "usuarios": nombres}


@router.get("/informes/{informe_id}")
async def ver_informe(informe_id: str, request: Request, user: CurrentUser = Depends(require_ver),
                      db: AsyncSession = Depends(get_db)) -> dict:
    r = await _informe_visible(db, informe_id, user)
    out = {**_resumen(r), "data": r.data, "version_actual": VERSION_SPH}
    if user.has_perm(PERM_GESTION):
        # ¿Hay datos más nuevos que los usados? (un informe de Productividad nuevo o un corte de ventas posterior)
        f = await _fuentes(db, r.fecha, _hasta(r))
        usadas = (r.data or {}).get("fuentes") or {}
        prods_usados = {x.get("id") for x in _lista(usadas.get("productividad"))}
        ventas_usadas = {(x.get("id"), x.get("fecha_dato")) for x in _lista(usadas.get("ventas"))}
        prods_hoy = {f.prods[d].id for d in f.cubiertos}
        ventas_hoy = {(f.ventas[m].id, f.ventas[m].fecha_dato and f.ventas[m].fecha_dato.isoformat())
                      for m in {_mes(d) for d in f.cubiertos}}
        out["fuentes_nuevas"] = [nombre for nombre, nuevas in (("Productividad", prods_hoy - prods_usados),
                                                                ("Ventas Netas", ventas_hoy - ventas_usadas)) if nuevas]
        out["vinculos"] = await _manuales(db)
        out["usuarios"] = await _nombres(db, {r.generated_by, r.published_by})
    else:
        out["usuarios"] = await _nombres(db, {r.published_by})
    await record_action(db, user_id=user.id, action="view_sph_informe", resource_type="sph_informe",
                        resource_id=informe_id, ip=client_ip(request))
    return out


class PublicarPayload(BaseModel):
    confirm_replace: bool = False


@router.post("/informes/{informe_id}/publicar")
async def publicar(informe_id: str, payload: PublicarPayload, request: Request,
                   user: CurrentUser = Depends(require_gestion), db: AsyncSession = Depends(get_db)) -> dict:
    r = await db.get(SphInforme, informe_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    if r.status == ESTADO_PUBLICADO:
        return _resumen(r)
    actual = (await db.execute(select(SphInforme).where(
        _del_periodo(r.fecha, _hasta(r)), SphInforme.status == ESTADO_PUBLICADO))).scalars().first()
    if actual and not payload.confirm_replace:
        nombres = await _nombres(db, {actual.published_by})
        etiqueta = _etiqueta(r.fecha, _hasta(r))
        raise HTTPException(status.HTTP_409_CONFLICT, detail={
            "code": "replace_required",
            "message": f"{etiqueta[0].upper()}{etiqueta[1:]} ya tiene un SPH publicado. Si continuás, lo reemplaza.",
            "existing": {**_resumen(actual), "published_by": nombres.get(actual.published_by or "", actual.published_by)},
        })
    ahora = datetime.now(timezone.utc)
    if actual:
        actual.status, actual.replaced_at, actual.replaced_by_report_id = ESTADO_REEMPLAZADO, ahora, r.id
    r.status, r.published_at, r.published_by = ESTADO_PUBLICADO, ahora, user.id
    await db.commit()
    await db.refresh(r)
    await record_action(db, user_id=user.id, action="sph_reemplazado" if actual else "sph_publicado",
                        resource_type="sph_informe", resource_id=informe_id, ip=client_ip(request),
                        extra={"desde": r.fecha.isoformat(), "hasta": _hasta(r).isoformat(), "reemplaza_a": actual.id if actual else None})
    return _resumen(r)


@router.post("/informes/{informe_id}/despublicar")
async def despublicar(informe_id: str, request: Request, user: CurrentUser = Depends(require_gestion),
                      db: AsyncSession = Depends(get_db)) -> dict:
    r = await db.get(SphInforme, informe_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    if r.status != ESTADO_PUBLICADO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El informe no está publicado")
    r.status, r.published_at, r.published_by = ESTADO_BORRADOR, None, None
    await db.commit()
    await db.refresh(r)
    await record_action(db, user_id=user.id, action="sph_despublicado", resource_type="sph_informe",
                        resource_id=informe_id, ip=client_ip(request),
                        extra={"desde": r.fecha.isoformat(), "hasta": _hasta(r).isoformat()})
    return _resumen(r)


@router.post("/informes/{informe_id}/recalcular")
async def recalcular(informe_id: str, request: Request, user: CurrentUser = Depends(require_gestion),
                     db: AsyncSession = Depends(get_db)) -> dict:
    """Rehace el SPH del período con las fuentes y los vínculos vigentes.

    Un borrador se recalcula en el lugar. Un publicado no cambia nunca: se genera (o actualiza)
    el borrador del período, que después se publica en su lugar.
    """
    r = await db.get(SphInforme, informe_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    async with _lock:
        borrador = await _calcular_borrador(db, r.fecha, _hasta(r), user.id)
        await db.commit()
        await db.refresh(borrador)
    await record_action(db, user_id=user.id, action="sph_recalculado", resource_type="sph_informe",
                        resource_id=borrador.id, ip=client_ip(request),
                        extra={"desde": r.fecha.isoformat(), "hasta": _hasta(r).isoformat(), "desde_informe": informe_id})
    return {"informe": _resumen(borrador), "nuevo_borrador": borrador.id != r.id}


@router.delete("/informes/{informe_id}")
async def eliminar_informe(informe_id: str, request: Request, user: CurrentUser = Depends(require_gestion),
                           db: AsyncSession = Depends(get_db)) -> dict:
    r = await db.get(SphInforme, informe_id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    if r.status == ESTADO_PUBLICADO:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "El informe está publicado: despublicalo antes de eliminarlo")
    desde, hasta, estado = r.fecha, _hasta(r), r.status
    await db.delete(r)
    await db.commit()
    await record_action(db, user_id=user.id, action="sph_eliminado", resource_type="sph_informe",
                        resource_id=informe_id, ip=client_ip(request),
                        extra={"desde": desde.isoformat(), "hasta": hasta.isoformat(), "status": estado})
    return {"status": "deleted"}


# ------------------------------------------------------------------ vínculos manuales
@router.get("/vinculos")
async def listar_vinculos(user: CurrentUser = Depends(require_gestion), db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(select(SphVinculo).order_by(SphVinculo.nombre))).scalars().all()
    nombres = await _nombres(db, {v.updated_by for v in rows})
    return {"items": [{"clave": v.clave, "nombre": v.nombre, "vendedor": v.vendedor, "updated_at": _iso(v.updated_at),
                       "updated_by": nombres.get(v.updated_by or "", v.updated_by)} for v in rows]}


class VinculoPayload(BaseModel):
    clave: str = Field(..., min_length=1, max_length=200)
    nombre: str = Field(..., min_length=1, max_length=200)
    accion: Literal["vincular", "descartar", "automatico"]
    vendedor: Optional[str] = Field(None, max_length=200)


@router.put("/vinculos")
async def guardar_vinculo(payload: VinculoPayload, request: Request, user: CurrentUser = Depends(require_gestion),
                          db: AsyncSession = Depends(get_db)) -> dict:
    """vincular → este agente es ese vendedor · descartar → no es ninguno · automatico → vuelve al cruce por nombre."""
    clave, vendedor = payload.clave.strip(), (payload.vendedor or "").strip() or None
    actual = await db.get(SphVinculo, clave)
    antes = actual.vendedor if actual else "automatico"
    if payload.accion == "automatico":
        if actual:
            await db.delete(actual)
    else:
        if payload.accion == "vincular":
            if not vendedor:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Elegí el vendedor a vincular")
            if vendedor == SIN_VENDEDOR:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "«SIN VENDEDOR» agrupa ventas sin POS: no es una persona para vincular")
            otro = (await db.execute(select(SphVinculo).where(
                SphVinculo.vendedor == vendedor, SphVinculo.clave != clave))).scalars().first()
            if otro:
                raise HTTPException(status.HTTP_409_CONFLICT, f"{vendedor} ya está vinculado a {otro.nombre}. Quitá ese vínculo primero.")
        else:
            vendedor = None
        if not actual:
            actual = SphVinculo(clave=clave)
            db.add(actual)
        actual.nombre, actual.vendedor = payload.nombre.strip(), vendedor
        actual.updated_at, actual.updated_by = datetime.now(timezone.utc), user.id
    await db.commit()
    await record_action(db, user_id=user.id, action="sph_vinculo", resource_type="sph_vinculo", resource_id=clave,
                        ip=client_ip(request), extra={"agente": clave, "accion": payload.accion, "antes": antes, "vendedor": vendedor})
    return {"clave": clave, "accion": payload.accion, "vendedor": vendedor}
