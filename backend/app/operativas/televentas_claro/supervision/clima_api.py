"""API del clima del equipo — Televentas Claro (`televentas_claro.clima_equipo`: gerente, sub gerente y coordinador).

* `GET  /control/clima?desde&hasta`      → el clima del día (o del rango): resumen, curva del día, líderes, equipos (los
                                           asesores siempre agregados), serie por día, quién mejoró o bajó y las alertas.
                                           Cada consulta queda en la auditoría (salvo el refresco automático).
* `POST /control/clima/alertas/{id}/calibrar` → «útil» o «falsa alarma» (la falsa alarma, además, la descarta).
* `POST /portal/termometro`             → el toque de mitad del día del supervisor: «¿Cómo vas?».

Las reglas están en `clima.py`. Tomar o anotar una alerta del clima es lo mismo que en el centro de comandos.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import CurrentUser, client_ip, require_perm
from ....core.database import get_db
from ....services.audit_service import record_action
from . import api as sup
from . import clima as srv
from . import coaching as coaching_srv
from . import comando as cmd
from .comando_api import _nombres
from .mi_dia_api import _utc, termometro
from .models import OPERATIVA, AlertaComando, ClimaIA, PulsoDia

router = APIRouter(prefix="/televentas-claro/supervision", tags=["televentas-claro · clima del equipo"])

require_clima = require_perm(cmd.PERM_CLIMA)
REPETIR_PULSO = timedelta(minutes=30)       # un segundo toque dentro de este rato corrige el anterior


@router.get("/control/clima")
async def clima(request: Request, desde: Optional[date] = Query(None), hasta: Optional[date] = Query(None),
                auto: bool = Query(False), user: CurrentUser = Depends(require_clima), db: AsyncSession = Depends(get_db)) -> dict:
    hoy = sup.hoy()
    hasta = hasta or hoy
    desde = desde or hasta
    if hasta > hoy or desde > hasta:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Elegí un rango hasta hoy")
    if (hasta - desde).days >= srv.MAX_DIAS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"El rango puede tener hasta {srv.MAX_DIAS} días")
    momento = coaching_srv.ahora()
    p = await sup.parametros(db)
    # Siete días antes del rango: para la serie de un día, la caída contra el promedio y los estados que se repiten.
    fotos = await srv.actualizar(db, min(desde, hasta - timedelta(days=6)) - timedelta(days=7), hasta, p=p, hoy=hoy, momento=momento)
    if hasta >= hoy - timedelta(days=1):
        await srv.sincronizar_alertas(db, {k: v for k, v in fotos.items() if k[1] >= hoy - timedelta(days=13)}, hoy=hoy, p=p, momento=momento)
    ctx = await sup.Contexto(hasta.strftime("%Y-%m")).cargar(db)
    nombres = await _nombres(db)
    out = srv.vista(fotos, desde=desde, hasta=hasta, hoy=hoy, supervisores=ctx.supervisores, nombres=nombres)
    ini, fin = srv._limites(desde, hasta)
    alertas = (await db.execute(select(AlertaComando).where(
        AlertaComando.operativa == OPERATIVA, AlertaComando.tipo.like("clima_%"),
        or_(AlertaComando.hasta.is_(None), AlertaComando.hasta >= ini), AlertaComando.desde < fin,
    ).order_by(AlertaComando.desde.desc()).limit(60))).scalars().all()
    lista = sorted((cmd.alerta_dict(a, nombres, hoy, {}) for a in alertas), key=cmd.orden_alertas)
    calibradas = [a for a in alertas if a.util is not None]
    ultima_ia = (await db.execute(select(ClimaIA).where(ClimaIA.operativa == OPERATIVA, ClimaIA.estado == "listo")
                                  .order_by(ClimaIA.fecha.desc()).limit(1))).scalar_one_or_none()
    if not auto:
        await record_action(db, user_id=user.id, action="clima_visto", resource_type="clima_equipo", resource_id=None,
                            ip=client_ip(request), extra={"desde": desde.isoformat(), "hasta": hasta.isoformat()})
    return {
        **out, "desde": desde.isoformat(), "hasta": hasta.isoformat(), "hoy": hoy.isoformat(), "actualizado": momento.isoformat(),
        "alertas": lista,
        "calibracion": {"nivel": p.get("clima_alertas") or "alta", "marcadas": len(calibradas),
                        "utiles": sum(1 for a in calibradas if a.util),
                        "pct_util": round(sum(1 for a in calibradas if a.util) / len(calibradas) * 100) if calibradas else None},
        "ia": {"estado": srv.ia_estado(), "ultimo": ultima_ia.fecha.isoformat() if ultima_ia else None, "hora": srv.settings.clima_ia_hora},
        "puede_actuar": user.has_perm(sup.PERM_GESTION),
    }


class CalibrarPayload(BaseModel):
    util: bool


@router.post("/control/clima/alertas/{alerta_id}/calibrar")
async def calibrar(alerta_id: str, payload: CalibrarPayload, request: Request, user: CurrentUser = Depends(require_clima),
                   db: AsyncSession = Depends(get_db)) -> dict:
    """Útil o falsa alarma: sirve para calibrar las reglas. La falsa alarma, si estaba abierta, queda descartada."""
    a = await db.get(AlertaComando, alerta_id)
    if not a or a.operativa != OPERATIVA or not cmd.es_clima(a.tipo):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alerta no encontrada")
    momento = coaching_srv.ahora()
    a.util, a.util_por, a.util_at = payload.util, user.id, momento
    if not payload.util and a.hasta is None and a.descartada_at is None:
        a.descartada_por, a.descartada_at, a.descartada_motivo = user.id, momento, "Falsa alarma (calibración del clima)"
    await db.commit()
    await record_action(db, user_id=user.id, action="clima_alerta_calibrada", resource_type="alerta_comando", resource_id=a.id,
                        ip=client_ip(request), extra={"tipo": a.tipo, "util": payload.util})
    return cmd.alerta_dict(a, await _nombres(db), sup.hoy(), {})


# ------------------------------------------------------------------ el termómetro del supervisor
class PulsoPayload(BaseModel):
    valor: Literal["bien", "normal", "dificil"]


@router.post("/portal/termometro")
async def pulso(payload: PulsoPayload, request: Request, user: CurrentUser = Depends(sup.require_portal),
                db: AsyncSession = Depends(get_db)) -> dict:
    """Un toque: cómo va el día. Si toca otra vez enseguida, corrige el anterior."""
    dia, momento = sup.hoy(), coaching_srv.ahora()
    ultimo = (await db.execute(select(PulsoDia).where(PulsoDia.supervisor_id == user.id, PulsoDia.fecha == dia)
                               .order_by(PulsoDia.at.desc()).limit(1))).scalar_one_or_none()
    if ultimo is not None and momento - _utc(ultimo.at) < REPETIR_PULSO:
        ultimo.valor, ultimo.at = payload.valor, momento
    else:
        db.add(PulsoDia(operativa=OPERATIVA, supervisor_id=user.id, fecha=dia, at=momento, valor=payload.valor))
    await db.commit()
    await record_action(db, user_id=user.id, action="termometro", resource_type="pulso_dia", resource_id=None, ip=client_ip(request),
                        extra={"fecha": dia.isoformat()})
    return await termometro(db, user.id, dia, await sup.parametros(db))
