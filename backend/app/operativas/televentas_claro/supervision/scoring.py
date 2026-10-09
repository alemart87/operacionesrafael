"""Scoring v1 del modelo Líder Coach Comercial (cuentas puras, sin base de datos).

Asesor (0–100), cuatro componentes con puntos que crecen en línea recta entre dos extremos:
- Pospago (35) y GPON (15): netas contra su objetivo de referencia al corte. El objetivo de
  referencia es la parte del objetivo del equipo (proporcional a los días hábiles transcurridos)
  que le toca según los días que trabajó en el equipo hasta el corte de ventas (los días con
  conexión en Productividad, escalados si faltan informes; sin nombre de llamadas, los días
  hábiles que estuvo en el equipo).
- Uso de líneas (25): 100 con el umbral (10%) de sin uso o menos; 0 con `uso_cero` (35%) o más.
  Hacen falta `min_evaluables` líneas evaluables.
- Conversación (25): 100 desde la meta mínima de Productividad (37%); 0 en la banda roja (25%).
  Arriba de la meta máxima (47%) no resta, pero se marca. Hacen falta `min_horas_conversacion`.
Un componente sin datos suficientes no se evalúa y su peso se reparte entre los demás.

Si se pudo evaluar menos del `MIN_COBERTURA` % del peso, el puntaje es parcial (se muestra
marcado y va después en los rankings): un solo componente no alcanza para comparar.

Supervisor: 60 por el resultado del equipo (los mismos componentes sobre todo el equipo, contra
los objetivos del supervisor) y 40 por su gestión, desde el día en que empezó a registrarse:
- Cobertura (15): % del equipo actual con al menos un coaching en el mes.
- Foco (10): % de las alertas de uso de su equipo con coaching sobre uso dentro de los 5 días
  hábiles desde que aparecieron. Una alerta todavía en plazo no cuenta; una que se resolvió sola
  antes del plazo, tampoco.
- Seguimientos (5): % de los compromisos con fecha de seguimiento en el mes que se siguieron en esa
  fecha (o al día siguiente). Los que todavía no vencieron no cuentan.
- Tickets (10): con los tickets de revisión (fase siguiente); mientras, su peso se reparte.
Operación: los componentes sobre toda la operación.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Iterable

from .calculo import supervisor_en

SCORING_DEFECTO: dict[str, Any] = {
    "version": 1,
    "asesor": {"pospago": 35, "uso": 25, "conversacion": 25, "gpon": 15},
    "supervisor": {"resultado": 60, "cobertura": 15, "foco": 10, "tickets": 10, "seguimiento": 5},
    "uso_cero": 35.0,
    "min_horas_conversacion": 2.0,
}

MIN_COBERTURA = 60  # % del peso evaluado para que el puntaje no sea parcial
DIAS_FOCO = 5       # días hábiles para el coaching sobre uso desde que aparece la alerta
GRACIA_SEGUIMIENTO = 1  # el seguimiento vale a tiempo en la fecha acordada o al día siguiente
GESTION = ("cobertura", "foco", "seguimiento", "tickets")

NOMBRES = {
    "pospago": "Pospago", "gpon": "GPON", "uso": "Uso de líneas", "conversacion": "Conversación",
    "resultado": "Resultado del equipo", "cobertura": "Cobertura de coaching", "foco": "Foco",
    "tickets": "Tickets en plazo", "seguimiento": "Seguimientos a tiempo",
}


def lineal(v: float, cero: float, lleno: float) -> float:
    """0 en `cero`, 1 en `lleno` (sirve en los dos sentidos), recortado a [0, 1]."""
    if lleno == cero:
        return 1.0 if v >= lleno else 0.0
    return max(0.0, min(1.0, (v - cero) / (lleno - cero)))


def _comp(clave: str, peso: float, rel: float | None, valor: float | None, **detalle: Any) -> dict[str, Any]:
    return {"clave": clave, "nombre": NOMBRES[clave], "peso": peso, "rel": rel,
            "valor": round(valor, 1) if valor is not None else None, **detalle}


def puntaje(comps: list[dict[str, Any]]) -> dict[str, Any]:
    """Suma ponderada de los componentes evaluados (el peso de los que no se evalúan se reparte)."""
    evaluados = [c for c in comps if c["rel"] is not None]
    w = sum(c["peso"] for c in evaluados)
    for c in comps:
        if c["rel"] is not None and w:
            c["peso_efectivo"] = round(c["peso"] / w * 100, 1)
            c["puntos"] = round(c["rel"] * c["peso"] / w * 100, 1)
        else:
            c["peso_efectivo"], c["puntos"] = 0.0, None
    total = round(sum(c["rel"] * c["peso"] for c in evaluados) / w * 100, 1) if w else None
    peso_total = sum(c["peso"] for c in comps)
    cobertura = round(w / peso_total * 100) if peso_total else 0
    return {"total": total, "componentes": comps, "cobertura": cobertura,
            "parcial": total is not None and cobertura < MIN_COBERTURA}


# ------------------------------------------------------------------ componentes
def comp_ventas(clave: str, peso: float, netas: int | None, esperado: float | None) -> dict[str, Any]:
    if netas is None or not esperado or esperado <= 0:
        return _comp(clave, peso, None, None, netas=netas, esperado=round(esperado, 1) if esperado else None)
    pct = netas / esperado * 100
    return _comp(clave, peso, lineal(pct, 0, 100), pct, netas=netas, esperado=round(esperado, 1))


def comp_uso(peso: float, evaluables: int, sin_uso: int, p: dict[str, Any], sc: dict[str, Any]) -> dict[str, Any]:
    if evaluables < p["min_evaluables"]:
        return _comp("uso", peso, None, (sin_uso / evaluables * 100) if evaluables else None,
                     evaluables=evaluables, sin_uso=sin_uso)
    pct = sin_uso / evaluables * 100
    return _comp("uso", peso, lineal(pct, sc["uso_cero"], p["umbral_sin_uso"]), pct, evaluables=evaluables, sin_uso=sin_uso)


def comp_conversacion(peso: float, login: float, conv: float, pp: dict[str, Any], sc: dict[str, Any]) -> dict[str, Any]:
    horas = login / 3600
    if horas < sc["min_horas_conversacion"]:
        return _comp("conversacion", peso, None, (conv / login * 100) if login else None, horas=round(horas, 1))
    pct = conv / login * 100
    return _comp("conversacion", peso, lineal(pct, pp["rojo"], pp["meta_min"]), pct, horas=round(horas, 1),
                 sobre_meta=pct > pp["meta_max"])


# ------------------------------------------------------------------ gestión del supervisor
def _plural(k: int, uno: str, varios: str) -> str:
    return f"{k} {uno if k == 1 else varios}"


def gestion_pendiente(ws: dict[str, Any], detalle: str | None = None) -> list[dict[str, Any]]:
    return [_comp(k, ws[k], None, None, pendiente=True, **({"detalle": detalle} if detalle and k != "tickets" else {}))
            for k in GESTION]


def gestion_supervisor(sid: str, *, ws: dict[str, Any], equipo: list[str], coachings: list[dict[str, Any]],
                       alertas: list[dict[str, Any]], hoy: date, primero: date, ultimo: date) -> list[dict[str, Any]]:
    """Cobertura, foco y seguimientos de un supervisor en el mes (los tickets, pendientes).

    `coachings`: los no anulados con fecha en el mes (o un poco después, para el foco de las alertas de
    fin de mes) y los que tienen su seguimiento en el mes: operador_id, supervisor_id, metrica, fecha,
    seguimiento_fecha y seguimiento_dia (día en que se registró el seguimiento, o None).
    `alertas`: las de uso del mes ya atribuidas a un supervisor: operador_id, supervisor_id, vence, hasta."""
    # ---- cobertura: asesores del equipo actual con algún coaching en el mes
    hasta_mes = min(ultimo, hoy)
    con = {c["operador_id"] for c in coachings if primero <= c["fecha"] <= hasta_mes}
    n = len(equipo)
    k = sum(1 for op in equipo if op in con)
    cobertura = _comp("cobertura", ws["cobertura"], k / n if n else None, k / n * 100 if n else None, con=k, de=n,
                      detalle=f"{k} de {_plural(n, 'asesor', 'asesores')} con coaching en el mes" if n else "Sin asesores en el equipo")

    # ---- foco: alertas de uso con coaching sobre uso a tiempo
    cubiertas = exigibles = en_plazo = 0
    for a in alertas:
        if a["supervisor_id"] != sid:
            continue
        cubierta = any(c["operador_id"] == a["operador_id"] and c["metrica"] == "uso" and primero <= c["fecha"] <= a["vence"]
                       for c in coachings)
        if cubierta:
            cubiertas += 1
            exigibles += 1
        elif a["vence"] < hoy:
            if a["hasta"] is None or a["hasta"] > a["vence"]:
                exigibles += 1  # siguió en alerta después del plazo sin coaching
        elif a["hasta"] is None:
            en_plazo += 1
    if exigibles:
        detalle = f"{cubiertas} de {_plural(exigibles, 'alerta', 'alertas')} de uso con coaching en {DIAS_FOCO} días hábiles"
    else:
        detalle = "Sin alertas de uso vencidas"
    if en_plazo:
        detalle += f" · {en_plazo} en plazo"
    foco = _comp("foco", ws["foco"], cubiertas / exigibles if exigibles else None,
                 cubiertas / exigibles * 100 if exigibles else None, con=cubiertas, de=exigibles, en_plazo=en_plazo,
                 detalle=detalle)

    # ---- seguimientos: en la fecha acordada (o al día siguiente)
    a_tiempo = vencidos = proximos = 0
    for c in coachings:
        if c["supervisor_id"] != sid or not primero <= c["seguimiento_fecha"] <= ultimo:
            continue
        limite = c["seguimiento_fecha"] + timedelta(days=GRACIA_SEGUIMIENTO)
        if c["seguimiento_dia"] is not None:
            vencidos += 1
            a_tiempo += c["seguimiento_dia"] <= limite
        elif limite < hoy:
            vencidos += 1
        else:
            proximos += 1
    detalle = (f"{a_tiempo} de {_plural(vencidos, 'seguimiento', 'seguimientos')} a tiempo" if vencidos
               else "Sin seguimientos vencidos en el mes")
    if proximos:
        detalle += f" · {proximos} por venir"
    seguimiento = _comp("seguimiento", ws["seguimiento"], a_tiempo / vencidos if vencidos else None,
                        a_tiempo / vencidos * 100 if vencidos else None, con=a_tiempo, de=vencidos, proximos=proximos,
                        detalle=detalle)
    tickets = _comp("tickets", ws["tickets"], None, None, pendiente=True)
    return [cobertura, foco, seguimiento, tickets]


# ------------------------------------------------------------------ cálculo del mes
def calcular(*, primero: date, ultimo: date, corte: date | None, cal: dict[str, Any], p: dict[str, Any],
             sc: dict[str, Any], pp: dict[str, Any], agentes: dict[str, str], vendedores: dict[str, str],
             tramos: dict[str, list[tuple[date, str | None]]], ref: date, atrib: dict[str, Any],
             objetivos: dict[str, tuple[int | None, int | None]], prod: dict[str, list[tuple[date, int, int]]],
             supervisores: Iterable[str], coaching: dict[str, Any] | None = None) -> dict[str, Any]:
    """Scoring del mes: operación, cada supervisor (con su equipo actual) y cada asesor.

    `agentes`: operador → clave de Productividad; `vendedores`: operador → vendedor (los que tienen).
    `prod`: clave → [(día, login válido s, conversación válida s)]. `objetivos`: supervisor → (pospago, gpon).
    `coaching`: registros de la gestión: {"inicio": día desde el que se mide (o None), "hoy", "coachings",
    "alertas"} (ver `gestion_supervisor`). Sin registros, la gestión queda pendiente.
    """
    pesos_dia, feriados = p["pesos_dia"], set(p["feriados"])

    def peso(d: date) -> float:
        return 0.0 if d.isoformat() in feriados else float(pesos_dia[d.weekday()])

    wa, ws = sc["asesor"], sc["supervisor"]
    hasta_ventas = min(corte, ultimo) if corte else None
    fraccion = (cal["transcurridos"] / cal["total"]) if cal["total"] else 0.0

    def sup_de(op: str, d: date) -> str | None:
        return supervisor_en(tramos.get(op, []), d)

    # Días trabajados (peso de cada día) por operador y supervisor, hasta el corte de ventas. Si faltan
    # informes de Productividad, los días de cada agente se escalan a los días hábiles transcurridos:
    # nadie pierde parte del objetivo porque no se subió un día.
    dias_informe = {d for filas in prod.values() for d, _, _ in filas if primero <= d <= ultimo}
    w_informe = sum(peso(d) for d in dias_informe if hasta_ventas and d <= hasta_ventas)
    factor = (cal["transcurridos"] / w_informe) if w_informe else None
    dias: dict[tuple[str, str | None], float] = defaultdict(float)
    conv: dict[tuple[str, str | None], list[float]] = defaultdict(lambda: [0.0, 0.0])
    con_agente = set()
    for op, clave in agentes.items():
        for d, login, cv in prod.get(clave, []):
            if not primero <= d <= ultimo:
                continue
            s = sup_de(op, d)
            c = conv[(op, s)]
            c[0] += login
            c[1] += cv
            if factor:
                con_agente.add(op)
                if login > 0 and hasta_ventas and d <= hasta_ventas:
                    dias[(op, s)] += peso(d) * factor
    # Quien no tiene nombre de llamadas (o sin informes de Productividad): los días hábiles que estuvo en el equipo.
    if hasta_ventas:
        for op, ts in tramos.items():
            if op in con_agente:
                continue
            d = primero
            while d <= hasta_ventas:
                dias[(op, sup_de(op, d))] += peso(d)
                d += timedelta(days=1)

    uso_op = atrib["operadores"]
    por_sup = atrib["supervisores"]
    sups = list(supervisores)
    actuales = {s: [op for op in tramos if sup_de(op, ref) == s] for s in sups}

    def esperado(sid: str, producto: int) -> float | None:
        obj = (objetivos.get(sid) or (None, None))[producto]
        return obj * fraccion if obj else None

    # ---- asesores, en el equipo de su supervisor actual
    asesores: dict[str, dict[str, Any]] = {}
    for op in set(tramos) | set(uso_op) | {op for op, _ in conv}:
        sid = sup_de(op, ref)
        u = uso_op.get(op) or {"evaluables": 0, "sin_uso": 0}
        login, cv = conv.get((op, sid), [0.0, 0.0]) if sid else _suma(conv, op)
        comps = []
        if sid:
            total_dias = sum(v for (o, s), v in dias.items() if s == sid)
            parte = (dias.get((op, sid), 0.0) / total_dias) if total_dias else None
            vend = (por_sup.get(sid) or {}).get("asesores", {}).get(op, {})
            for clave, i in (("pospago", 0), ("gpon", 1)):
                e = esperado(sid, i)
                comps.append(comp_ventas(clave, wa[clave], vend.get(clave, 0) if op in vendedores else None,
                                         e * parte if (e is not None and parte) else None))
        else:
            comps += [comp_ventas("pospago", wa["pospago"], None, None), comp_ventas("gpon", wa["gpon"], None, None)]
        comps.append(comp_uso(wa["uso"], u["evaluables"], u["sin_uso"], p, sc))
        comps.append(comp_conversacion(wa["conversacion"], login, cv, pp, sc))
        r = puntaje(_orden(comps))
        r.update({"supervisor_id": sid, "dias": round(dias.get((op, sid), 0.0), 1) if sid else None})
        asesores[op] = r

    # ---- gestión: cada alerta es del supervisor que tenía al asesor al vencer su plazo (o hoy, si no venció)
    inicio = (coaching or {}).get("inicio")
    medir_gestion = coaching is not None and not (inicio and ultimo < inicio)
    alertas = [{**a, "supervisor_id": sup_de(a["operador_id"], min(a["vence"], ref))}
               for a in (coaching or {}).get("alertas", [])] if medir_gestion else []

    # ---- supervisores: resultado del equipo + gestión
    supervisores_out: dict[str, dict[str, Any]] = {}
    for sid in sups:
        equipo = actuales[sid]
        b = por_sup.get(sid) or {}
        comps = []
        for clave, i in (("pospago", 0), ("gpon", 1)):
            e = esperado(sid, i)
            comps.append(comp_ventas(clave, wa[clave], b.get(clave, 0) if corte else None, e))
        ev = sum((uso_op.get(op) or {}).get("evaluables", 0) for op in equipo)
        su = sum((uso_op.get(op) or {}).get("sin_uso", 0) for op in equipo)
        comps.append(comp_uso(wa["uso"], ev, su, p, sc))
        lg = sum(conv.get((op, sid), [0, 0])[0] for op in equipo)
        cvs = sum(conv.get((op, sid), [0, 0])[1] for op in equipo)
        comps.append(comp_conversacion(wa["conversacion"], lg, cvs, pp, sc))
        resultado = puntaje(_orden(comps))
        partes = [_comp("resultado", ws["resultado"], resultado["total"] / 100 if resultado["total"] is not None else None,
                        resultado["total"])]
        if medir_gestion:
            partes += gestion_supervisor(sid, ws=ws, equipo=equipo, coachings=coaching["coachings"], alertas=alertas,
                                         hoy=coaching["hoy"], primero=primero, ultimo=ultimo)
        else:
            partes += gestion_pendiente(ws, f"Se mide desde el {inicio:%d/%m/%Y}" if inicio and coaching is not None else None)
        total = puntaje(partes)
        supervisores_out[sid] = {"total": total["total"], "partes": total["componentes"],
                                 "resultado": resultado["total"], "componentes": resultado["componentes"],
                                 "parcial": resultado["parcial"],
                                 "asesores": {op: asesores[op] for op in equipo if op in asesores}}

    # ---- operación
    tot = atrib["total"]
    obj_pp = sum(o[0] or 0 for o in objetivos.values())
    obj_gp = sum(o[1] or 0 for o in objetivos.values())
    comps = [
        comp_ventas("pospago", wa["pospago"], tot["pospago"] if corte else None, obj_pp * fraccion if obj_pp else None),
        comp_ventas("gpon", wa["gpon"], tot["gpon"] if corte else None, obj_gp * fraccion if obj_gp else None),
        comp_uso(wa["uso"], sum(u["evaluables"] for u in uso_op.values()), sum(u["sin_uso"] for u in uso_op.values()), p, sc),
        comp_conversacion(wa["conversacion"], sum(v[0] for v in conv.values()), sum(v[1] for v in conv.values()), pp, sc),
    ]
    operacion = puntaje(_orden(comps))
    return {"operacion": operacion, "supervisores": supervisores_out, "asesores": asesores}


def _suma(conv: dict[tuple[str, str | None], list[float]], op: str) -> list[float]:
    t = [0.0, 0.0]
    for (o, _), v in conv.items():
        if o == op:
            t[0] += v[0]
            t[1] += v[1]
    return t


_ORDEN = {"pospago": 0, "uso": 1, "conversacion": 2, "gpon": 3}


def _orden(comps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(comps, key=lambda c: _ORDEN.get(c["clave"], 9))
