"""API del analizador semántico de coaching (`televentas_claro.analisis_coaching`: gerente, sub gerente y coordinador).

* `GET /analisis`: estadísticas del rango (o de un supervisor), evaluación de cada supervisor, tiempo estimado, series,
  palabras y la lista de coachings firmados.
* `POST /analisis/informes`: pide un informe a Claude (Haiku) con los textos del rango; se arma en segundo plano.
* `GET /analisis/informes` y `GET /analisis/informes/{id}`: los informes pedidos (se comparten entre los jefes).

Solo coaching: nunca entra nada de Facturación. A Claude no le llegan nombres (ver `analisis.py`).
"""
from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, client_ip, require_perm
from ....core.config import settings
from ....core.database import get_db
from ....services.audit_service import record_action
from . import analisis as an
from . import api as sup
from .alertas import ZONA
from .models import OPERATIVA, AnalisisInforme

PERM_ANALISIS = f"{OPERATIVA}.analisis_coaching"
require_analisis = require_perm(PERM_ANALISIS)

router = APIRouter(prefix="/televentas-claro/supervision", tags=["televentas-claro · analizador de coaching"])


async def _supervisor_valido(db: AsyncSession, supervisor_id: Optional[str]) -> None:
    if supervisor_id and supervisor_id not in await sup._supervisores(db, {supervisor_id}):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supervisor no encontrado")


@router.get("/analisis")
async def analisis(desde: Optional[date] = Query(None), hasta: Optional[date] = Query(None),
                   supervisor_id: Optional[str] = Query(None, max_length=36),
                   user: CurrentUser = Depends(require_analisis), db: AsyncSession = Depends(get_db)) -> dict:
    """Estadísticas y evaluación de los coachings firmados en el rango (por defecto, el mes en curso)."""
    await _supervisor_valido(db, supervisor_id)
    try:
        d = await an.cargar(db, desde, hasta, supervisor_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    out = an.estadisticas(d)
    supervisores = await sup._supervisores(db, {x["id"] for x in out["supervisores"]})
    out["opciones"] = {"supervisores": sorted(({"id": i, "nombre": x["nombre"], "activo": x["activo"]} for i, x in supervisores.items()),
                                              key=lambda x: (not x["activo"], x["nombre"].lower()))}
    out["servicio"] = {"disponible": an.servicio_disponible(), "modelo": settings.analisis_modelo,
                       "simulador": an.simulador(), "informes_dia": settings.analisis_informes_dia}
    return out


class InformePayload(BaseModel):
    desde: date
    hasta: date
    supervisor_id: Optional[str] = Field(None, max_length=36)


@router.post("/analisis/informes", status_code=status.HTTP_201_CREATED)
async def pedir_informe(payload: InformePayload, request: Request, user: CurrentUser = Depends(require_analisis),
                        db: AsyncSession = Depends(get_db)) -> dict:
    """Pide el informe de Claude: lee los textos de los coachings firmados del rango (se arma en segundo plano)."""
    await _supervisor_valido(db, payload.supervisor_id)
    try:
        an.rango(payload.desde, payload.hasta)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    if not an.servicio_disponible():
        raise HTTPException(status.HTTP_409_CONFLICT, "El análisis con IA no está configurado: falta ANTHROPIC_API_KEY en el servidor")
    dia = sup.hoy()
    ini = datetime.combine(dia, time.min, tzinfo=ZONA).astimezone(timezone.utc)
    hechos = (await db.execute(select(func.count()).select_from(AnalisisInforme).where(
        AnalisisInforme.pedido_por == user.id, AnalisisInforme.created_at >= ini))).scalar() or 0
    if hechos >= settings.analisis_informes_dia:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, f"Llegaste al tope de {settings.analisis_informes_dia} informes por día")
    x = AnalisisInforme(operativa=OPERATIVA, desde=payload.desde, hasta=payload.hasta, supervisor_id=payload.supervisor_id,
                        estado="pendiente", modelo=settings.analisis_modelo, pedido_por=user.id, created_at=an._ahora())
    db.add(x)
    await db.commit()
    an.despertar()
    await record_action(db, user_id=user.id, action="analisis_informe_pedido", resource_type="analisis", resource_id=x.id,
                        ip=client_ip(request), extra={"desde": payload.desde.isoformat(), "hasta": payload.hasta.isoformat(),
                                                     "supervisor": payload.supervisor_id})
    return an.informe_dict(x, await sup._nombres(db, {user.id} | ({x.supervisor_id} if x.supervisor_id else set())))


@router.get("/analisis/informes")
async def informes(limite: int = Query(20, ge=1, le=100), user: CurrentUser = Depends(require_analisis),
                   db: AsyncSession = Depends(get_db)) -> dict:
    xs = list((await db.execute(select(AnalisisInforme).where(AnalisisInforme.operativa == OPERATIVA)
                                .order_by(AnalisisInforme.created_at.desc()).limit(limite))).scalars().all())
    nombres = await sup._nombres(db, {x.pedido_por for x in xs} | {x.supervisor_id for x in xs if x.supervisor_id})
    items = []
    for x in xs:
        d = an.informe_dict(x, nombres)
        d["resultado"] = None   # la lista va liviana: el informe completo se pide por su id
        d["resumen"] = (x.resultado or {}).get("resumen")
        items.append(d)
    return {"items": items}


@router.get("/analisis/informes/{informe_id}")
async def informe(informe_id: str, request: Request, user: CurrentUser = Depends(require_analisis),
                  db: AsyncSession = Depends(get_db)) -> dict:
    x = await db.get(AnalisisInforme, informe_id)
    if not x or x.operativa != OPERATIVA:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Informe no encontrado")
    if x.estado == "listo":
        await record_action(db, user_id=user.id, action="analisis_informe_visto", resource_type="analisis", resource_id=x.id,
                            ip=client_ip(request), extra={})
    return an.informe_dict(x, await sup._nombres(db, {x.pedido_por} | ({x.supervisor_id} if x.supervisor_id else set())))
