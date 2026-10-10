"""Seguimiento de los informes diarios para el superadmin: quién lo presentó cada día, los compromisos abiertos y
vencidos, los comentarios y las palabras clave del período.

- Días esperados: de lunes a viernes que no son feriados ni no laborables (el calendario de Supervisión), desde el
  día en que se instaló el informe diario. El sábado cuenta si hay informe, pero no falta si no lo hay.
- Autores: los usuarios activos con la utilidad «Informe diario» (y quien tenga informes en el rango).
- Cumplimiento: informes firmados en los días esperados sobre los días esperados (hasta hoy).
"""
from __future__ import annotations

from collections import Counter
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ....api.deps import effective_permissions
from ....core.perfiles import perfil_name
from ....models.profile import Profile
from ....models.user import User
from ..supervision.calculo import peso_dia
from ..supervision.datos import parametros as sup_parametros
from . import informe as srv
from .models import ABIERTO, CUMPLIDO, FIRMADO, NO_CUMPLIDO, OPERATIVA, InformeCompromiso, InformeDiario
from .palabras import Diccionario, agregar

PERM = f"{OPERATIVA}.informe_diario"
DIAS_MAX = 92


async def autores_habilitados(db: AsyncSession) -> list[User]:
    perfiles = {p.slug: p.permissions for p in (await db.execute(select(Profile))).scalars().all()}
    usuarios = (await db.execute(select(User).where(User.is_active.is_(True)))).scalars().all()
    return [u for u in usuarios if PERM in effective_permissions(perfiles.get(u.role), u.operativas, u.role)]


async def calendario(db: AsyncSession) -> tuple[list[float], set[str]]:
    p = await sup_parametros(db)
    return p["pesos_dia"], set(p["feriados"])


def esperado(d: date, pesos: list[float], feriados: set[str], desde: date | None = None) -> bool:
    """Día en que se espera el informe: hábil completo (de lunes a viernes), no feriado y desde que existe."""
    return peso_dia(d, pesos, feriados) >= 1 and (desde is None or d >= desde)


def _hora_local(inf: InformeDiario) -> tuple[str | None, bool]:
    if not inf.firmado_at:
        return None, False
    local = srv.utc(inf.firmado_at).astimezone(srv.ZONA)
    return local.strftime("%H:%M"), local.date() > inf.fecha


async def panel(db: AsyncSession, *, desde: date, hasta: date, autor_id: str | None = None) -> dict[str, Any]:
    dia = srv.hoy()
    pesos, feriados = await calendario(db)
    inicio = await srv.inicio(db)
    dias = [desde + timedelta(days=k) for k in range((hasta - desde).days + 1)]

    q = select(InformeDiario).where(InformeDiario.operativa == OPERATIVA, InformeDiario.fecha >= desde, InformeDiario.fecha <= hasta)
    if autor_id:
        q = q.where(InformeDiario.autor_id == autor_id)
    infs = list((await db.execute(q.order_by(InformeDiario.fecha.desc(), InformeDiario.autor_nombre))).scalars().all())
    coms = await srv.comentarios(db, [i.id for i in infs])
    por_informe: dict[str, list] = {}
    for c in coms:
        por_informe.setdefault(c.informe_id, []).append(c)

    # ---- autores: los habilitados y quien tenga informes en el rango (las opciones del filtro, sin filtrar)
    todos: dict[str, dict[str, Any]] = {}
    for u in await autores_habilitados(db):
        todos[u.id] = {"id": u.id, "nombre": u.full_name, "cargo": perfil_name(u.role)}
    con_informes = (await db.execute(select(InformeDiario.autor_id, InformeDiario.autor_nombre, InformeDiario.autor_cargo).where(
        InformeDiario.operativa == OPERATIVA, InformeDiario.fecha >= desde, InformeDiario.fecha <= hasta).distinct())).all()
    for aid, nombre, cargo in con_informes:
        todos.setdefault(aid, {"id": aid, "nombre": nombre, "cargo": cargo})
    autores = {k: v for k, v in todos.items() if not autor_id or k == autor_id}

    # ---- palabras clave de los firmados
    temas, _ = await srv.diccionario(db)
    dic = Diccionario(temas)
    analisis: dict[str, dict[str, Any]] = {i.id: srv.palabras_de(i, dic) for i in infs if i.estado == FIRMADO}

    # ---- matriz autor × día
    idx = {(i.autor_id, i.fecha): i for i in infs}
    matriz = []
    tot_esp = tot_firm = 0
    for a in sorted(autores.values(), key=lambda x: x["nombre"].lower()):
        celdas, esp, firm = [], 0, 0
        for d in dias:
            i = idx.get((a["id"], d))
            exp = esperado(d, pesos, feriados, inicio) and d <= dia
            if i is not None:
                hora, tarde = _hora_local(i)
                estado = "firmado" if i.estado == FIRMADO else "borrador"
                celdas.append({"fecha": d.isoformat(), "estado": estado, "id": i.id, "hora": hora, "tarde": tarde,
                               "nivel": analisis.get(i.id, {}).get("nivel")})
            else:
                estado = "falta" if exp else ("futuro" if d > dia else "libre")
                celdas.append({"fecha": d.isoformat(), "estado": estado})
            if exp:
                esp += 1
                firm += bool(i is not None and i.estado == FIRMADO)
        tot_esp += esp
        tot_firm += firm
        matriz.append({**a, "dias": celdas, "esperados": esp, "firmados": firm,
                       "pct": round(firm / esp * 100, 1) if esp else None})

    # ---- compromisos
    qc = select(InformeCompromiso).where(InformeCompromiso.operativa == OPERATIVA)
    if autor_id:
        qc = qc.where(InformeCompromiso.autor_id == autor_id)
    comps = list((await db.execute(qc)).scalars().all())
    abiertos = [c for c in comps if c.estado == ABIERTO]
    cerrados = Counter(c.estado for c in comps if c.estado != ABIERTO and c.cerrado_fecha and desde <= c.cerrado_fecha <= hasta)
    nombre_autor = {a["id"]: a["nombre"] for a in todos.values()}
    lista_abiertos = sorted((srv.compromiso_dict(c, dia) | {"autor": nombre_autor.get(c.autor_id, "—"), "autor_id": c.autor_id}
                             for c in abiertos), key=lambda x: (not x["vencido"], x["fecha"]))

    # ---- informes y palabras
    filas = []
    for i in infs:
        a = analisis.get(i.id)
        hora, tarde = _hora_local(i)
        filas.append({**srv.resumen_dict(i, por_informe.get(i.id, [])), "nivel": a["nivel"] if a else None,
                      "criticas": a["criticas"] if a else 0, "temas": a["temas"] if a else {}, "hora": hora, "tarde": tarde})
    firmados = [i for i in infs if i.estado == FIRMADO]
    resumen_palabras = agregar([({"id": i.id, "fecha": i.fecha.isoformat(), "autor": i.autor_nombre, "autor_id": i.autor_id},
                                 analisis[i.id]) for i in firmados], dic)

    return {
        "desde": desde.isoformat(), "hasta": hasta.isoformat(), "hoy": dia.isoformat(), "inicio": inicio.isoformat() if inicio else None,
        "dias": [{"fecha": d.isoformat(), "esperado": esperado(d, pesos, feriados, inicio), "feriado": d.isoformat() in feriados}
                 for d in dias],
        "kpis": {
            "firmados": len(firmados), "borradores": sum(1 for i in infs if i.estado != FIRMADO),
            "esperados": tot_esp, "pct_cumplimiento": round(tot_firm / tot_esp * 100, 1) if tot_esp else None,
            "faltan": tot_esp - tot_firm, "sin_revisar": sum(1 for i in firmados if not i.revisado_at),
            "alertas": sum(1 for x in resumen_palabras["alertas"] if x["nivel"] == "alto"),
            "compromisos_abiertos": len(abiertos), "compromisos_vencidos": sum(1 for c in lista_abiertos if c["vencido"]),
            "cumplidos": cerrados.get(CUMPLIDO, 0), "no_cumplidos": cerrados.get(NO_CUMPLIDO, 0),
            "comentarios": len(coms),
        },
        "autores": matriz,
        "informes": filas,
        "compromisos": lista_abiertos[:200],
        "palabras": resumen_palabras,
        "opciones": {"autores": sorted(({"id": a["id"], "nombre": a["nombre"]} for a in todos.values()), key=lambda x: x["nombre"].lower())},
    }
