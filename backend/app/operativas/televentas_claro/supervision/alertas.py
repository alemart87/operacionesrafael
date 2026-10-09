"""Alertas de uso de líneas con fecha: cuándo aparece y cuándo se va cada asesor en alerta.

El estado de alerta sale del informe de Ventas Netas vigente del mes (`calculo.uso`). Para medir el
foco del supervisor (coaching sobre uso dentro de los 5 días hábiles) hace falta saber desde cuándo
está: se guarda el día en que se generó el informe que la mostró (o el día en que empezó a medirse
la gestión, si es posterior) y se cierra con el primer informe en que ya no está.

Se sincroniza al leer el mes en curso (los meses pasados quedan como estaban): es idempotente y una
sola sincronización corre a la vez.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .calculo import sumar_habiles, supervisor_en
from .models import OPERATIVA, AlertaAsesor
from .scoring import DIAS_FOCO

ZONA = ZoneInfo("America/Asuncion")
TIPO_USO = "uso"
_lock = asyncio.Lock()


def dia_local(d: datetime | None) -> date | None:
    if d is None:
        return None
    return (d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d).astimezone(ZONA).date()


async def del_mes(db: AsyncSession, periodo: str) -> list[AlertaAsesor]:
    return list((await db.execute(select(AlertaAsesor).where(
        AlertaAsesor.operativa == OPERATIVA, AlertaAsesor.periodo == periodo,
    ).order_by(AlertaAsesor.desde))).scalars().all())


async def sincronizar(db: AsyncSession, *, periodo: str, reporte: Any, atrib: dict[str, Any], hoy: date,
                      inicio: date | None) -> int:
    """Abre las alertas nuevas y cierra las que ya no están, según el informe vigente. Devuelve los cambios."""
    if reporte is None or periodo != hoy.strftime("%Y-%m"):
        return 0
    dia = dia_local(reporte.generated_at) or hoy
    if inicio:
        dia = max(dia, inicio)
    en_alerta = {op: u for op, u in atrib["operadores"].items() if u["alerta"]}
    async with _lock:
        filas = await del_mes(db, periodo)
        abiertas = {a.operador_id: a for a in filas if a.hasta is None and a.tipo == TIPO_USO}
        cambios = 0
        for op, u in en_alerta.items():
            if op in abiertas:
                continue
            datos = {k: u[k] for k in ("pct_sin_uso", "evaluables", "sin_uso", "a_recuperar")}
            misma = next((a for a in filas if a.operador_id == op and a.tipo == TIPO_USO and a.desde == dia), None)
            if misma:  # se había ido y volvió el mismo día: se reabre
                misma.hasta = misma.corte_hasta = None
            else:
                db.add(AlertaAsesor(operativa=OPERATIVA, periodo=periodo, operador_id=op, tipo=TIPO_USO, desde=dia,
                                    corte_desde=reporte.fecha_dato, datos=datos))
            cambios += 1
        for op, a in abiertas.items():
            if op not in en_alerta:
                a.hasta, a.corte_hasta = max(dia, a.desde), reporte.fecha_dato
                cambios += 1
        if cambios:
            try:
                await db.commit()
            except IntegrityError:  # otro proceso ya la registró: queda la suya
                await db.rollback()
                return 0
        return cambios


def vence(a: AlertaAsesor, p: dict[str, Any]) -> date:
    """Último día para el coaching sobre uso: 5 días hábiles desde que apareció."""
    return sumar_habiles(a.desde, DIAS_FOCO, p["pesos_dia"], p["feriados"])


def a_scoring(a: AlertaAsesor, p: dict[str, Any]) -> dict[str, Any]:
    return {"id": a.id, "operador_id": a.operador_id, "desde": a.desde, "hasta": a.hasta, "vence": vence(a, p),
            "datos": a.datos or {}}


ORDEN_ESTADO = {"vencida": 0, "en_plazo": 1, "cubierta": 2, "resuelta": 3}


def del_supervisor(filas: list[AlertaAsesor], sid: str, *, p: dict[str, Any], tramos: dict[str, list[tuple[date, str | None]]],
                   ref: date, primero: date, coachings: list[Any], hoy: date, nombres: dict[str, str]) -> list[dict[str, Any]]:
    """Las alertas de uso del mes que le tocan a un supervisor (el que tenía al asesor al vencer el plazo, o hoy)
    y en qué quedó cada una: con coaching a tiempo, en plazo, vencida o resuelta sola antes del plazo."""
    out = []
    usos = sorted((c for c in coachings if c.metrica == "uso" and c.estado != "anulado"), key=lambda c: c.fecha)
    for a in filas:
        v = vence(a, p)
        if supervisor_en(tramos.get(a.operador_id, []), min(v, ref)) != sid:
            continue
        cubierta = next((c for c in usos if c.operador_id == a.operador_id and primero <= c.fecha <= v), None)
        if cubierta:
            estado = "cubierta"
        elif a.hasta and a.hasta <= v:
            estado = "resuelta"
        elif v < hoy:
            estado = "vencida"
        else:
            estado = "en_plazo"
        out.append({"id": a.id, "operador_id": a.operador_id, "operador": nombres.get(a.operador_id, "—"),
                    "desde": a.desde.isoformat(), "hasta": a.hasta.isoformat() if a.hasta else None,
                    "vence": v.isoformat(), "estado": estado, "datos": a.datos or {},
                    "coaching_id": cubierta.id if cubierta else None,
                    "coaching_fecha": cubierta.fecha.isoformat() if cubierta else None})
    out.sort(key=lambda x: (ORDEN_ESTADO[x["estado"]], x["vence"]))
    return out
