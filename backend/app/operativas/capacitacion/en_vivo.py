"""En vivo: el tablero del mentor y del capacitador con los entrenamientos que están pasando ahora, como el Pulse de un
contact center. Muestra quién está chateando, con qué cliente, a quién le toca y hace cuánto, y cómo viene el día.
La pantalla lo pide cada pocos segundos y solo lee.

Estado de cada conversación en curso, según su último mensaje:
- `responde_asesor`: el cliente escribió y espera al postulante. El reloj mide su tiempo de respuesta y se marca en
  amarillo o en rojo según `UMBRALES`.
- `responde_cliente`: el postulante escribió y la IA está contestando.
- `en_pausa`: sin actividad hace más de `PAUSA`. La puede retomar con su link.

Cada uno ve solo los grupos en curso donde tiene un papel (capacitador, mentor o gestión).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from statistics import mean
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.deps import CurrentUser
from ...core.config import settings
from ...core.database import get_db
from . import entrenamiento_ia as ia
from . import entrenamientos as ent
from . import servicio as srv
from .api import require_ver
from .models import CapAsignacion, CapGrupo, CapPostulante, CapSesion

router = APIRouter(prefix="/capacitacion", tags=["capacitación · en vivo"])

PAUSA = timedelta(minutes=10)
VENTANA = timedelta(days=3)        # conversaciones en curso más viejas quedaron abandonadas: no se muestran
UMBRALES = {"amarillo": 60, "rojo": 180}   # segundos que el cliente lleva esperando al postulante
RECIENTES = 12


def _fecha(x: Optional[str]) -> Optional[datetime]:
    return datetime.fromisoformat(x) if x else None


def _respuestas(ms: list[dict[str, Any]], desde: Optional[datetime] = None) -> list[float]:
    """Segundos que tardó el asesor en contestar cada vez que el cliente le escribió."""
    out = []
    for prev, m in zip(ms, ms[1:]):
        if prev["r"] == "cliente" and m["r"] == "asesor":
            a, b = _fecha(prev.get("at")), _fecha(m.get("at"))
            if a and b and (desde is None or b >= desde):
                out.append(max(0.0, (b - a).total_seconds()))
    return out


def estado_vivo(s: CapSesion, ahora: datetime) -> tuple[str, Optional[datetime]]:
    """El estado de una conversación en curso y desde cuándo está así (su último mensaje)."""
    ms = s.mensajes or []
    ultimo = _fecha(ms[-1].get("at")) if ms else srv.utc(s.iniciado_at)
    if ultimo and ahora - ultimo > PAUSA:
        return "en_pausa", ultimo
    if ms and ms[-1]["r"] == "asesor":
        return "responde_cliente", ultimo
    return "responde_asesor", ultimo


def _nombre(p: CapPostulante) -> dict[str, str]:
    return {"id": p.id, "nombre": p.nombre, "apellido": p.apellido}


@router.get("/en-vivo")
async def en_vivo(grupo: Optional[str] = None, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> dict:
    """Las conversaciones de entrenamiento en curso de los grupos del usuario, los indicadores del día y los postulantes."""
    ent._exigir_staff(user)
    todos = [g for g in await srv.grupos_visibles(db, user) if g.estado == "en_curso"]
    grupos = [g for g in todos if g.id == grupo] if grupo else todos
    if grupo and not grupos:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Grupo no encontrado")
    gmap: dict[str, CapGrupo] = {g.id: g for g in grupos}
    ps = (await db.execute(select(CapPostulante).where(CapPostulante.grupo_id.in_(list(gmap) or [""])))).scalars().all()
    pmap = {p.id: p for p in ps}
    ahora, hoy = srv.ahora(), srv.inicio_del_dia()

    sesiones = (await db.execute(select(CapSesion).where(
        CapSesion.postulante_id.in_(list(pmap) or [""]), CapSesion.asignacion_id.isnot(None),
        or_(and_(CapSesion.estado == "en_curso", CapSesion.iniciado_at >= ahora - VENTANA), CapSesion.terminado_at >= hoy),
    ))).scalars().all()
    asig = {a.id: a for a in (await db.execute(select(CapAsignacion).where(
        CapAsignacion.id.in_(list({s.asignacion_id for s in sesiones}) or [""])))).scalars().all()}
    d = srv.Datos()
    for p in ps:
        d.postulantes[p.grupo_id].append(p)
    d.entrenamientos = await srv.entrenamientos_de(db, list(pmap))
    progreso = {x["id"]: x for xs in d.entrenamientos.values() for x in xs}
    terminados_hoy = (await db.execute(select(CapAsignacion).where(
        CapAsignacion.grupo_id.in_(list(gmap) or [""]), CapAsignacion.estado == "terminado",
        CapAsignacion.terminado_at >= hoy))).scalars().all()

    vivas: list[dict[str, Any]] = []
    recientes: list[dict[str, Any]] = []
    por_postulante: dict[str, dict[str, Any]] = defaultdict(lambda: {"casos": 0, "niveles": [], "info": [], "ultima": None, "vivo": None})
    respuestas_dia: list[float] = []
    for s in sesiones:
        p = pmap.get(s.postulante_id)
        if p is None:
            continue
        c, a = s.caso or {}, asig.get(s.asignacion_id)
        ms = s.mensajes or []
        base = {"id": s.id, "postulante": _nombre(p), "grupo": {"id": p.grupo_id, "nombre": gmap[p.grupo_id].nombre},
                "entrenamiento": (c.get("entrenamiento") or {}).get("nombre"), "intento": (a.intento or 1) if a else 1,
                "caso": c.get("titulo"), "cliente": c.get("cliente_nombre"),
                "guiado": ((c.get("entrenamiento") or {}).get("modo")) == "guiado"}
        x = por_postulante[p.id]
        ultima = _fecha(ms[-1].get("at")) if ms else None
        if ultima and ultima >= hoy and (x["ultima"] is None or ultima > x["ultima"]):
            x["ultima"] = ultima
        respuestas_dia.extend(_respuestas(ms, hoy))
        if s.estado == "en_curso":
            est, desde = estado_vivo(s, ahora)
            prog = progreso.get(s.asignacion_id) or {}
            resp = _respuestas(ms)
            vivas.append({**base, "estado": est, "desde": srv.iso(desde), "iniciado_at": srv.iso(s.iniciado_at),
                          "mensajes": len(ms), "turnos": ia.turnos(ms), "max_turnos": c.get("max_turnos"),
                          "ultimo": {"r": ms[-1]["r"], "t": ms[-1]["t"][:160]} if ms else None,
                          "resp_media": round(mean(resp)) if resp else None,
                          "progreso": {"hechos": prog.get("hechos", 0), "casos": prog.get("casos", 0)}})
            if est != "en_pausa":
                x["vivo"] = "en_chat"
            elif x["vivo"] is None:
                x["vivo"] = "en_pausa"
        elif s.terminado_at and srv.utc(s.terminado_at) >= hoy:
            ev = s.evaluacion or {}
            x["casos"] += 1
            if s.estado == "terminada" and ev:
                x["niveles"].append(ev.get("nivel") or 0)
                x["info"].append(bool(ev.get("info_correcta")))
            recientes.append({**base, "estado": s.estado, "segundos": s.segundos, "fin_motivo": s.fin_motivo,
                              "terminado_at": srv.iso(s.terminado_at), "nivel": ev.get("nivel"),
                              "info_correcta": ev.get("info_correcta")})

    orden = {"responde_asesor": 0, "responde_cliente": 1, "en_pausa": 2}
    vivas.sort(key=lambda v: (orden[v["estado"]], v["desde"] or ""))
    recientes.sort(key=lambda r: r["terminado_at"] or "", reverse=True)

    filas = []
    for p in ps:
        if p.estado in srv.SALIDAS:
            continue
        x = por_postulante.get(p.id) or {"casos": 0, "niveles": [], "info": [], "ultima": None, "vivo": None}
        av = srv.avance(p, d)
        filas.append({**_nombre(p), "grupo": {"id": p.grupo_id, "nombre": gmap[p.grupo_id].nombre}, "estado": p.estado,
                      "vivo": x["vivo"] or ("activo_hoy" if x["ultima"] else "sin_actividad"),
                      "ultima": srv.iso(x["ultima"]), "casos_hoy": x["casos"],
                      "nivel_hoy": round(mean(x["niveles"]), 1) if x["niveles"] else None,
                      "info_hoy": {"ok": sum(x["info"]), "de": len(x["info"])},
                      "terminados": av["terminados"], "pendientes": sum(1 for y in d.entrenamientos[p.id] if y["estado"] != "terminado")})
    rango = {"en_chat": 0, "en_pausa": 1, "activo_hoy": 2, "sin_actividad": 3}
    filas.sort(key=lambda f: (rango[f["vivo"]], -(datetime.fromisoformat(f["ultima"]).timestamp() if f["ultima"] else 0), f["apellido"]))

    evaluadas = [r for r in recientes if r["estado"] == "terminada" and r["nivel"] is not None]
    cerradas = [r["segundos"] for r in recientes if r["segundos"]]
    activas = [v for v in vivas if v["estado"] != "en_pausa"]
    return {
        "ahora": srv.iso(ahora),
        "grupos": [{"id": g.id, "nombre": g.nombre} for g in todos],
        "kpis": {
            "en_chat": len(activas),
            "esperando": sum(1 for v in activas if v["estado"] == "responde_asesor"
                             and (ahora - datetime.fromisoformat(v["desde"])).total_seconds() >= UMBRALES["amarillo"]),
            "en_pausa": len(vivas) - len(activas),
            "postulantes_hoy": sum(1 for f in filas if f["vivo"] != "sin_actividad"), "postulantes": len(filas),
            "casos_hoy": len(recientes),
            "entrenamientos_hoy": len(terminados_hoy),
            "recomendados_hoy": sum(1 for a in terminados_hoy if (a.resultado or {}).get("aprobado")),
            "nivel_hoy": round(mean(r["nivel"] for r in evaluadas), 1) if evaluadas else None,
            "info_hoy": round(sum(1 for r in evaluadas if r["info_correcta"]) / len(evaluadas) * 100) if evaluadas else None,
            "evaluadas_hoy": len(evaluadas),
            "tiempo_caso": round(mean(cerradas)) if cerradas else None,
            "resp_media": round(mean(respuestas_dia)) if respuestas_dia else None,
        },
        "sesiones": vivas, "postulantes": filas, "recientes": recientes[:RECIENTES],
        "umbrales": {**UMBRALES, "pausa_min": int(PAUSA.total_seconds() // 60)},
        "minimo": settings.entrenamiento_meta_postulante,
    }
