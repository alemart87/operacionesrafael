"""Maestro de operadores: detección en llamadas y en ventas, cruce por nombre y vínculos a mano.

Cada persona del piso aparece con dos nombres que no comparten un ID: el agente de la
plataforma («APELLIDOS, NOMBRES», Productividad) y el vendedor del POS (Ventas Netas).

- Detectar un mes: cada agente y cada vendedor que todavía no está en el maestro entra como un
  operador propio; después se cruzan los pendientes (agentes sin vendedor y vendedores sin agente)
  con el mismo motor del SPH y los que coinciden se unen en un operador.
- Lo que decide una persona manda: un vínculo manual, «no vende» (descartado) o «no usa la
  plataforma» (solo ventas) no lo vuelve a tocar el cruce automático.
- Unir dos operadores que ya tienen equipo en algún mes lo decide una persona: el cruce
  automático solo los deja sugeridos.
- La detección de un mes se rehace sola cuando cambian sus informes (firma de las fuentes).
"""
from __future__ import annotations

import asyncio
import hashlib
from collections import Counter
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..fuentes import informes_productividad, informes_ventas
from ..productividad.models import ProdInforme
from ..productividad.parser import nombre_visible
from ..sph.analyzer import SIN_VENDEDOR, cruzar, evaluar, partes_agente, tokens
from ..ventas_netas.models import VentasNetasReport
from .calculo import limites
from .models import (
    AGENTE_PENDIENTE, OPERATIVA, VENDEDOR_PENDIENTE, VINCULADO, EquipoAsignacion, Operador, OperadoresSync,
)

_lock = asyncio.Lock()  # un solo proceso atiende la API: una detección a la vez


class VinculoInvalido(ValueError):
    """La acción pedida sobre los vínculos no se puede hacer (el mensaje lo explica)."""


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


def _fecha(x: Any) -> date | None:
    try:
        return date.fromisoformat(str(x)[:10]) if x else None
    except ValueError:
        return None


def _vistos(o: Operador, d: date | None) -> None:
    if d:
        o.primera_vez = min(o.primera_vez, d) if o.primera_vez else d
        o.ultima_vez = max(o.ultima_vez, d) if o.ultima_vez else d


def _nombre_auto(o: Operador) -> None:
    """Nombre que se muestra: el de llamadas si lo tiene; si no, el del vendedor. Un nombre puesto a mano queda."""
    if not o.nombre_manual:
        o.nombre = o.agente_nombre or nombre_visible(o.vendedor or "") or o.nombre or "Sin nombre"


async def todos(db: AsyncSession) -> list[Operador]:
    return list((await db.execute(select(Operador).where(Operador.operativa == OPERATIVA))).scalars().all())


async def _con_equipo(db: AsyncSession, ids: set[str]) -> set[str]:
    if not ids:
        return set()
    rows = await db.execute(select(EquipoAsignacion.operador_id).where(
        EquipoAsignacion.operativa == OPERATIVA, EquipoAsignacion.operador_id.in_(ids)).distinct())
    return {r for (r,) in rows.all()}


# ------------------------------------------------------------------ identidades de un mes
def _firma(prods: dict[date, ProdInforme], ventas: dict[str, VentasNetasReport]) -> str:
    partes = [f"p:{d.isoformat()}:{r.id}:{r.generated_at.isoformat() if r.generated_at else ''}" for d, r in sorted(prods.items())]
    partes += [f"v:{m}:{r.id}:{r.generated_at.isoformat() if r.generated_at else ''}:{r.fecha_dato}" for m, r in sorted(ventas.items())]
    return hashlib.sha256("|".join(partes).encode()).hexdigest()


async def identidades(db: AsyncSession, periodo: str, prods: dict[date, ProdInforme],
                      ventas: dict[str, VentasNetasReport]) -> tuple[dict[str, dict], dict[str, dict]]:
    """Agentes conectados (Productividad) y vendedores con netas o cargas (Ventas Netas) del mes."""
    agentes: dict[str, dict[str, Any]] = {}
    for d in sorted(prods):
        data = (await db.execute(select(ProdInforme.data).where(ProdInforme.id == prods[d].id))).scalar_one() or {}
        for a in data.get("agentes") or []:
            k = a.get("clave")
            if not k:
                continue
            x = agentes.setdefault(k, {"nombre": a.get("nombre") or k, "primera": d, "ultima": d})
            x["nombre"], x["ultima"] = a.get("nombre") or x["nombre"], d
    vendedores: dict[str, dict[str, Any]] = {}
    r = ventas.get(periodo)
    if r:
        data = (await db.execute(select(VentasNetasReport.data).where(VentasNetasReport.id == r.id))).scalar_one() or {}

        def ver(nombre: str | None, subcanal: str | None, legajo: str | None, f: date | None) -> None:
            if not nombre or nombre == SIN_VENDEDOR or nombre.startswith("CARGADO POR"):
                return
            x = vendedores.setdefault(nombre, {"subcanal": None, "legajos": Counter(), "primera": None, "ultima": None})
            x["subcanal"] = x["subcanal"] or subcanal
            if legajo:
                x["legajos"][str(legajo)] += 1
            if f:
                x["primera"] = min(x["primera"], f) if x["primera"] else f
                x["ultima"] = max(x["ultima"], f) if x["ultima"] else f

        for n in data.get("detalle_netas") or []:
            ver(n.get("vendedor"), n.get("subcanal"), n.get("legajo"),
                _fecha(n.get("fecha_venta")) or _fecha(n.get("fecha_carga")) or _fecha(n.get("fecha_activacion")))
        for c in (data.get("productividad") or {}).get("detalle_cargas") or []:
            if c.get("atribucion") in ("pos", "legajo"):
                ver(c.get("vendedor"), c.get("subcanal"), c.get("legajo"), _fecha(c.get("fecha_alta")))
        # El legajo de Ventas Netas es el de quien CARGÓ la venta: solo identifica a un vendedor si
        # carga únicamente para él (un mismo legajo de backoffice aparece en muchos vendedores).
        de_legajo: dict[str, set[str]] = {}
        for v, x in vendedores.items():
            for leg in x["legajos"]:
                de_legajo.setdefault(leg, set()).add(v)
        for x in vendedores.values():
            x["legajos"] = Counter({leg: c for leg, c in x["legajos"].items() if len(de_legajo[leg]) == 1})
    return agentes, vendedores


# ------------------------------------------------------------------ unir y separar
async def fusionar(db: AsyncSession, queda: Operador, sale: Operador) -> list[str]:
    """`sale` se integra en `queda`: sus nombres, sus fechas y sus equipos (si `queda` no tiene en ese mes).
    Devuelve los meses en que `sale` tenía equipo y se descartó por chocar con el de `queda`."""
    if (sale.agente_clave and queda.agente_clave) or (sale.vendedor and queda.vendedor):
        raise VinculoInvalido("Los dos operadores tienen el mismo tipo de nombre: separá uno antes de unirlos")
    agente = (sale.agente_clave, sale.agente_nombre) if sale.agente_clave and not queda.agente_clave else None
    venta = (sale.vendedor, sale.subcanal, sale.legajo) if sale.vendedor and not queda.vendedor else None
    sale.agente_clave = sale.vendedor = None  # primero se liberan: los nombres son únicos
    await db.flush()
    if agente:
        queda.agente_clave, queda.agente_nombre = agente
    if venta:
        queda.vendedor, queda.subcanal, queda.legajo = venta
    _vistos(queda, sale.primera_vez)
    _vistos(queda, sale.ultima_vez)
    queda.activo = queda.activo or sale.activo
    _nombre_auto(queda)

    rows = (await db.execute(select(EquipoAsignacion).where(
        EquipoAsignacion.operativa == OPERATIVA, EquipoAsignacion.operador_id.in_([queda.id, sale.id])))).scalars().all()
    meses_queda = {a.periodo for a in rows if a.operador_id == queda.id}
    descartados: list[str] = []
    for a in rows:
        if a.operador_id != sale.id:
            continue
        if a.periodo in meses_queda:
            descartados.append(a.periodo)
            await db.delete(a)
        else:
            a.operador_id = queda.id
    await db.delete(sale)
    await db.flush()
    return sorted(set(descartados))


async def separar(db: AsyncSession, o: Operador, user_id: str | None) -> Operador:
    """El vendedor pasa a un operador propio (sin equipos); el agente sigue en `o` con sus equipos."""
    if not (o.agente_clave and o.vendedor):
        raise VinculoInvalido("El operador no tiene un vínculo que separar")
    vendedor, subcanal, legajo = o.vendedor, o.subcanal, o.legajo
    o.vendedor = o.subcanal = o.legajo = None
    o.cruce, o.candidatos = "sin_cruce", []
    o.updated_at, o.updated_by = _ahora(), user_id
    _nombre_auto(o)
    await db.flush()
    nuevo = Operador(operativa=OPERATIVA, vendedor=vendedor, subcanal=subcanal, legajo=legajo, cruce="sin_agente",
                     candidatos=[], primera_vez=o.primera_vez, ultima_vez=o.ultima_vez, nombre=nombre_visible(vendedor),
                     updated_at=_ahora(), updated_by=user_id)
    db.add(nuevo)
    await db.flush()
    return nuevo


async def vincular(db: AsyncSession, a_op: Operador, v_op: Operador, user_id: str | None) -> tuple[Operador, list[str]]:
    """Una persona decide que el agente de `a_op` es el vendedor de `v_op`."""
    if not a_op.agente_clave:
        raise VinculoInvalido("Elegí un operador con nombre de llamadas")
    if not v_op.vendedor:
        raise VinculoInvalido("Elegí un operador con nombre de vendedor")
    if a_op.id == v_op.id:
        a_op.cruce, a_op.candidatos, a_op.updated_at, a_op.updated_by = "manual", [], _ahora(), user_id
        return a_op, []
    if v_op.agente_clave:
        raise VinculoInvalido(f"{v_op.vendedor} ya está vinculado a {v_op.nombre}. Quitá ese vínculo primero.")
    if a_op.vendedor:  # el agente tenía otro vendedor: ese vendedor queda solo
        await separar(db, a_op, user_id)
    con_equipo = await _con_equipo(db, {a_op.id, v_op.id})
    queda, sale = (v_op, a_op) if (v_op.id in con_equipo and a_op.id not in con_equipo) else (a_op, v_op)
    descartados = await fusionar(db, queda, sale)
    queda.cruce, queda.candidatos, queda.updated_at, queda.updated_by = "manual", [], _ahora(), user_id
    return queda, descartados


# ------------------------------------------------------------------ cruce automático
async def cruzar_pendientes(db: AsyncSession) -> dict[str, int]:
    """Cruza los agentes sin vendedor con los vendedores sin agente que nadie confirmó a mano."""
    ops = await todos(db)
    agentes = {o.agente_clave: o for o in ops if o.agente_clave and not o.vendedor and o.cruce in AGENTE_PENDIENTE}
    vendedores = {o.vendedor: o for o in ops if o.vendedor and not o.agente_clave and o.cruce in VENDEDOR_PENDIENTE}
    if not agentes:
        return {"unidos": 0, "sugeridos": 0}
    res = cruzar([{"clave": k} for k in agentes], sorted(vendedores))
    con_equipo = await _con_equipo(db, {o.id for o in agentes.values()} | {o.id for o in vendedores.values()})
    unidos = sugeridos = 0
    for k, a_op in agentes.items():
        r = res[k]
        v = r["vendedor"]
        if v and v in vendedores:
            v_op = vendedores.pop(v)
            if a_op.id in con_equipo and v_op.id in con_equipo:  # los dos ya tienen equipo: lo decide una persona
                a_op.cruce, a_op.candidatos = "sin_cruce", [v]
                sugeridos += 1
                continue
            queda, sale = (v_op, a_op) if v_op.id in con_equipo else (a_op, v_op)
            await fusionar(db, queda, sale)
            queda.cruce, queda.candidatos, queda.updated_at = r["nivel"], [], _ahora()
            unidos += 1
        else:
            a_op.cruce, a_op.candidatos = r["nivel"], r["candidatos"]
    await db.flush()
    return {"unidos": unidos, "sugeridos": sugeridos}


def sugerencias(o: Operador, pendientes: list[Operador], tope: int = 5) -> list[dict[str, str]]:
    """Operadores del otro lado que se parecen por nombre (para vincular a mano)."""
    out: list[tuple[int, int, str, Operador]] = []
    if o.agente_clave and not o.vendedor:
        apellidos, nombres = partes_agente(o.agente_clave)
        for x in pendientes:
            if x.vendedor and not x.agente_clave and (r := evaluar(apellidos, nombres, tokens(x.vendedor))):
                out.append((2 if r[0] == "exacto" else 1, r[1], x.vendedor, x))
        for v in o.candidatos or []:  # los candidatos del cruce, aunque ya estén vinculados
            if v not in {t[2] for t in out}:
                out.append((0, 0, v, None))
    elif o.vendedor and not o.agente_clave:
        palabras = tokens(o.vendedor)
        for x in pendientes:
            if x.agente_clave and not x.vendedor and (r := evaluar(*partes_agente(x.agente_clave), palabras)):
                out.append((2 if r[0] == "exacto" else 1, r[1], x.agente_clave, x))
    out.sort(key=lambda t: (-t[0], -t[1], t[2]))
    return [{"id": x.id if x else None, "nombre": (x.nombre if x else n), "identidad": n} for _, _, n, x in out[:tope]]


# ------------------------------------------------------------------ detección de un mes
async def detectar(db: AsyncSession, periodo: str, *, forzar: bool = False) -> dict[str, Any]:
    """Suma al maestro los agentes y vendedores del mes y cruza los pendientes. Se rehace solo si cambian
    los informes del mes (o con `forzar`). Hace commit."""
    async with _lock:
        primero, ultimo = limites(periodo)
        prods = await informes_productividad(db, primero, ultimo, con_datos=False)
        ventas = await informes_ventas(db, {periodo}, con_datos=False)
        firma = _firma(prods, ventas)
        sync_id = f"{OPERATIVA}:{periodo}"
        estado = await db.get(OperadoresSync, sync_id)
        if estado and estado.firma == firma and not forzar:
            return {**(estado.resumen or {}), "sin_cambios": True}

        agentes, vendedores = await identidades(db, periodo, prods, ventas)
        ops = await todos(db)
        por_agente = {o.agente_clave: o for o in ops if o.agente_clave}
        por_vendedor = {o.vendedor: o for o in ops if o.vendedor}
        nuevos = 0
        for k, a in agentes.items():
            o = por_agente.get(k)
            if not o:
                o = Operador(operativa=OPERATIVA, agente_clave=k, agente_nombre=a["nombre"], cruce="sin_cruce",
                             candidatos=[], nombre=a["nombre"])
                db.add(o)
                por_agente[k] = o
                nuevos += 1
            o.agente_nombre = a["nombre"]
            _nombre_auto(o)
            _vistos(o, a["primera"])
            _vistos(o, a["ultima"])
        for v, x in vendedores.items():
            o = por_vendedor.get(v)
            if not o:
                o = Operador(operativa=OPERATIVA, vendedor=v, cruce="sin_agente", candidatos=[], nombre=nombre_visible(v))
                db.add(o)
                por_vendedor[v] = o
                nuevos += 1
            o.subcanal = x["subcanal"] or o.subcanal
            o.legajo = x["legajos"].most_common(1)[0][0] if x["legajos"] else None
            _vistos(o, x["primera"])
            _vistos(o, x["ultima"])
        await db.flush()
        cruce = await cruzar_pendientes(db)

        ops = await todos(db)
        claves, nombres_v = set(agentes), set(vendedores)
        del_mes = [o for o in ops if (o.agente_clave in claves) or (o.vendedor in nombres_v)]
        resumen = {
            "periodo": periodo,
            "agentes": len(agentes), "vendedores": len(vendedores), "nuevos": nuevos, **cruce,
            "operadores_del_mes": len(del_mes),
            "vinculados": sum(1 for o in del_mes if o.cruce in VINCULADO),
            "por_revisar": sum(1 for o in del_mes if o.cruce in AGENTE_PENDIENTE + VENDEDOR_PENDIENTE),
            "dias_productividad": len(prods),
            "ventas": ({"id": ventas[periodo].id, "status": ventas[periodo].status,
                        "fecha_dato": ventas[periodo].fecha_dato.isoformat() if ventas[periodo].fecha_dato else None}
                       if periodo in ventas else None),
            "detectado_at": _ahora().isoformat(),
        }
        if not estado:
            estado = OperadoresSync(id=sync_id, firma=firma)
            db.add(estado)
        estado.firma, estado.synced_at, estado.resumen = firma, _ahora(), resumen
        await db.commit()
        return resumen


# ------------------------------------------------------------------ para el SPH
def vinculos_sph(ops: list[Operador]) -> dict[str, dict[str, Any]]:
    """Cruce de cada agente según el maestro, en el formato del SPH: clave → {vendedor, nivel, candidatos}."""
    out: dict[str, dict[str, Any]] = {}
    for o in ops:
        if not o.agente_clave:
            continue
        if o.vendedor:
            out[o.agente_clave] = {"vendedor": o.vendedor, "nivel": o.cruce if o.cruce in VINCULADO else "manual", "candidatos": []}
        elif o.cruce == "descartado":
            out[o.agente_clave] = {"vendedor": None, "nivel": "descartado", "candidatos": []}
        else:
            out[o.agente_clave] = {"vendedor": None, "nivel": o.cruce if o.cruce in AGENTE_PENDIENTE else "sin_cruce",
                                   "candidatos": list(o.candidatos or [])}
    return out


async def importar_vinculos_sph(db: AsyncSession) -> dict[str, int]:
    """Una sola vez: los vínculos manuales que ya tenía el SPH pasan al maestro."""
    from ..sph.models import SphVinculo

    ops = await todos(db)
    por_agente = {o.agente_clave: o for o in ops if o.agente_clave}
    por_vendedor = {o.vendedor: o for o in ops if o.vendedor}
    n = 0
    for v in (await db.execute(select(SphVinculo))).scalars().all():
        if v.clave in por_agente:
            continue
        if v.vendedor and v.vendedor in por_vendedor:
            continue  # ese vendedor ya tiene operador: que lo resuelva el cruce o una persona
        o = Operador(operativa=OPERATIVA, agente_clave=v.clave, agente_nombre=v.nombre, nombre=v.nombre,
                     vendedor=v.vendedor, cruce="manual" if v.vendedor else "descartado", candidatos=[],
                     updated_at=v.updated_at, updated_by=v.updated_by)
        db.add(o)
        por_agente[v.clave] = o
        if v.vendedor:
            por_vendedor[v.vendedor] = o
        n += 1
    await db.commit()
    return {"importados": n}

