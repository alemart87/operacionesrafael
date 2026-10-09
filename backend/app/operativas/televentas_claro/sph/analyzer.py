"""SPH estimado (ventas por hora): las horas de Productividad cruzadas con las ventas del día de la hoja de
productividad (CARGAS) de la planilla de Ventas Netas.

Definiciones:

- Horas: tiempo conectado (login) de cada agente en el informe de Productividad del día.
  Las sesiones abiertas (marcadas por Productividad) no cuentan: no son horas trabajadas.
- Ventas del día: las cargadas ese día (fecha de alta de la venta) en la hoja de productividad (CARGAS) de
  la planilla de Ventas Netas de su mes, en el estado en que estén: finalizadas (aprobadas), a confirmar o
  procesadas. No cuentan las rechazadas ni las canceladas administrativamente. No se usan las netas (líneas
  activadas): se activan días después y llegan en la planilla del mes de la activación, que puede ser otro.
  Cada planilla trae todo su mes hasta el corte, con el último estado de cada venta: vale la de corte más
  nuevo (`fuentes.py`).
- Vendedor de una venta: el POS de la carga; si no lo trae (las pendientes), el de su línea ya activada o el
  del legajo que la cargó si ese legajo carga para un único POS (lo resuelve Ventas Netas). Si no, no se sabe
  quién la vendió (su legajo carga para varios vendedores): cuenta en el SPH de la operación, no en el de un asesor.
- Cruce: no hay un ID común. El agente («APELLIDOS, NOMBRES» en la plataforma) se vincula con
  el vendedor del POS («NOMBRES APELLIDOS» en Claro) cuando están su primer apellido y su primer
  nombre. Exacto: están todas las palabras del agente. Probable: falta alguna, cambia la
  escritura (QUIÑONEZ / QUINONES) o el apellido aparece al final de un nombre largo (puede ser
  el segundo apellido). Uno a uno: un vendedor no va a dos agentes; con empate queda ambiguo y
  no se asigna. Los vínculos manuales mandan sobre el cruce automático. Desde Supervisión, el
  cruce sale del maestro de operadores (la misma lógica, guardada y corregible a mano).
- SPH del asesor = ventas del día ÷ horas conectadas. Entra al ranking desde `min_horas_ranking`
  (2 h en un día; 6 h, una jornada, en una semana, un mes o un rango).
- SPH de la operación = ventas del día ÷ horas conectadas del equipo, sin las sesiones abiertas:
  ni sus horas ni las ventas de esos agentes ese día, para comparar lo mismo con lo mismo.
- Período (semana, mes o rango): suma día por día. Un día CUENTA si tiene informe de
  Productividad (horas) y el corte de ventas de su mes ya lo alcanza; los demás se informan.
  Las ventas de un día se cruzan siempre con las horas de ESE día: las ventas del 10/10 que trae la
  planilla subida el 11/10 van contra las llamadas del 10/10. Cada venta se atribuye al asesor solo
  los días en que estuvo conectado.

Todo es lógica pura (sin DB): recibe los datos de los informes y devuelve el del SPH.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from difflib import SequenceMatcher
from typing import Any, Iterable
from zoneinfo import ZoneInfo

VERSION_SPH = 4              # v4: ventas del día de la hoja de productividad, no las netas (v3: netas de fin de mes; v2: períodos)
MIN_HORAS_RANKING = 2.0      # horas conectadas mínimas para entrar al ranking de SPH de un día
MIN_HORAS_RANKING_PERIODO = 6.0  # de una semana, un mes o un rango: al menos una jornada
DIAS_MAX_PERIODO = 62
ESTADO_FINALIZADA = "Vta_Finalizada"
ESTADO_RECHAZADA = "Vta_Rechazada"
CANCELADA = "Vta_Cancelada_Adm"  # figura finalizada pero se canceló administrativamente (no se activa)
ESTADOS = (ESTADO_FINALIZADA, "Vta_A_Confirmar", "Vta_Procesado", ESTADO_RECHAZADA, CANCELADA)  # los conocidos, en orden
NO_CUENTAN = (ESTADO_RECHAZADA, CANCELADA)
ATRIBUIDAS = ("pos", "linea", "legajo")  # ventas con vendedor identificado (las demás: "cargado por <legajo>")
SIN_VENDEDOR = "SIN VENDEDOR"
ZONA = ZoneInfo("America/Asuncion")
_PARTICULAS = {"DE", "DEL", "LA", "LAS", "LOS", "Y", "DA", "DI", "VDA", "VIUDA"}

# Vinculados: manual, exacto, probable. Sin vínculo: ambiguo, sin_cruce, incompleto, descartado.
VINCULADOS = ("manual", "exacto", "probable")
_RANGO = {"exacto": 2, "probable": 1}


# ------------------------------------------------------------------ nombres
def tokens(nombre: str | None) -> list[str]:
    """Palabras del nombre: sin tildes, en mayúsculas, sin partículas ni iniciales."""
    s = unicodedata.normalize("NFKD", nombre or "").encode("ascii", "ignore").decode().upper()
    return [t for t in re.sub(r"[^A-Z]+", " ", s).split() if len(t) > 1 and t not in _PARTICULAS]


def partes_agente(nombre: str | None) -> tuple[list[str], list[str]]:
    """'QUIÑONEZ MEDINA, RICHARD' → (['QUINONEZ', 'MEDINA'], ['RICHARD'])."""
    apellidos, _, nombres = (nombre or "").partition(",")
    return tokens(apellidos), tokens(nombres)


def _igual(a: str, b: str) -> tuple[bool, bool]:
    """(es la misma palabra, escrita igual). Con 5 letras o más tolera diferencias de escritura."""
    if a == b:
        return True, True
    if min(len(a), len(b)) >= 5 and SequenceMatcher(None, a, b).ratio() >= 0.85:
        return True, False
    return False, False


def evaluar(apellidos: list[str], nombres: list[str], vendedor: list[str]) -> tuple[str, int] | None:
    """Nivel ('exacto' | 'probable') y puntaje de que el agente sea ese vendedor; None si no lo es.

    Cada palabra del agente usa una palabra distinta del vendedor. Obligatorios: el primer
    nombre y un apellido (el primero; si no está, el segundo deja el vínculo como probable:
    'LOPEZ GIMENEZ, NANCY' ↔ 'NANCY GIMENEZ').
    """
    if not apellidos or not nombres:
        return None
    usadas: set[int] = set()

    def buscar(t: str) -> tuple[int, bool] | None:
        candidatos = [(i, ex) for i, v in enumerate(vendedor) if i not in usadas for ok, ex in [_igual(t, v)] if ok]
        if not candidatos:
            return None
        i, exacta = max(candidatos, key=lambda c: (c[1], -c[0]))  # primero la escrita igual
        usadas.add(i)
        return i, exacta

    nombre = buscar(nombres[0])
    if nombre is None:
        return None
    apellido = buscar(apellidos[0])
    resto = [buscar(t) for t in apellidos[1:] + nombres[1:]]
    if apellido is None and not any(r is not None for r in resto[:len(apellidos) - 1]):
        return None
    halladas = [r for r in [apellido, nombre, *resto] if r is not None]
    exacto = apellido is not None and all(r is not None for r in resto) and all(ex for _, ex in halladas)
    # En «NOMBRES APELLIDOS» largos, la última palabra suele ser el segundo apellido.
    if apellido is not None and len(vendedor) >= 4 and apellido[0] == len(vendedor) - 1 and len(apellidos) == 1:
        exacto = False
    puntaje = 2 * len(halladas) + sum(1 for _, ex in halladas if ex) - (2 if apellido is None else 0)
    return ("exacto" if exacto else "probable"), puntaje


def cruzar(agentes: Iterable[dict[str, Any]], vendedores: Iterable[str],
           manuales: dict[str, str | None] | None = None,
           fijos: dict[str, dict[str, Any]] | None = None) -> dict[str, dict[str, Any]]:
    """Vínculo de cada agente con un vendedor del período: clave → {vendedor, nivel, candidatos}.

    `agentes`: [{"clave", ...}] (la clave de Productividad: «APELLIDOS, NOMBRES» sin tildes).
    `manuales`: clave → vendedor (None = no vincular). Mandan sobre el cruce automático.
    `fijos`: clave → {vendedor, nivel, candidatos} ya resuelto (el maestro de operadores): se usa tal cual.
    """
    agentes = list(agentes)
    manuales = manuales or {}
    fijos = fijos or {}
    roster = sorted(set(vendedores) - {SIN_VENDEDOR, "", None})
    out: dict[str, dict[str, Any]] = {}
    tomados: set[str] = set()
    for a in agentes:
        k = a["clave"]
        if k in fijos:
            f = fijos[k]
            v = f.get("vendedor")
            out[k] = {"vendedor": v, "nivel": f.get("nivel") or ("manual" if v else "descartado"),
                      "candidatos": list(f.get("candidatos") or [])}
            if v:
                tomados.add(v)
        elif k in manuales:
            v = manuales[k]
            out[k] = {"vendedor": v, "nivel": "manual" if v else "descartado", "candidatos": []}
            if v:
                tomados.add(v)

    palabras = {v: tokens(v) for v in roster}
    pares: list[tuple[int, int, str, str, str]] = []
    incompletos: set[str] = set()
    for a in agentes:
        k = a["clave"]
        if k in out:
            continue
        apellidos, nombres = partes_agente(k)
        if not apellidos or not nombres:
            incompletos.add(k)
            continue
        for v in roster:
            if v not in tomados and (r := evaluar(apellidos, nombres, palabras[v])):
                pares.append((_RANGO[r[0]], r[1], k, v, r[0]))
    pares.sort(key=lambda x: (-x[0], -x[1], x[2], x[3]))

    asignados = set(tomados)
    ambiguos: dict[str, set[str]] = {}
    for rango, puntaje, k, v, nivel in pares:
        if k in out or k in ambiguos or v in asignados:
            continue
        mismo = (rango, puntaje)
        otros_v = {v2 for r2, p2, k2, v2, _ in pares if k2 == k and (r2, p2) == mismo and v2 != v and v2 not in asignados}
        otros_k = {k2 for r2, p2, k2, v2, _ in pares
                   if v2 == v and (r2, p2) == mismo and k2 != k and k2 not in out and k2 not in ambiguos}
        if otros_v or otros_k:  # empate: no se adivina
            ambiguos.setdefault(k, set()).update({v} | otros_v)
            for k2 in otros_k:
                ambiguos.setdefault(k2, set()).add(v)
            continue
        out[k] = {"vendedor": v, "nivel": nivel, "candidatos": []}
        asignados.add(v)

    for a in agentes:
        k = a["clave"]
        if k in out:
            continue
        if k in ambiguos:
            out[k] = {"vendedor": None, "nivel": "ambiguo", "candidatos": sorted(ambiguos[k])}
        elif k in incompletos:
            out[k] = {"vendedor": None, "nivel": "incompleto", "candidatos": []}
        else:  # los que se parecían pero quedaron para otro agente ayudan a corregir a mano
            out[k] = {"vendedor": None, "nivel": "sin_cruce",
                      "candidatos": sorted({v for _, _, k2, v, _ in pares if k2 == k})[:5]}
    return out


# ------------------------------------------------------------------ cálculo
def estado_de(c: dict[str, Any]) -> str:
    """Estado de la venta para el SPH: el de la carga, salvo las canceladas administrativamente (aparte)."""
    return CANCELADA if c.get("cancelada") else (c.get("estado") or "Sin estado")


def cuenta(c: dict[str, Any]) -> bool:
    """Es una venta del día: no está rechazada ni cancelada."""
    return estado_de(c) not in NO_CUENTAN


def vendedor_venta(c: dict[str, Any]) -> str:
    """El vendedor de la venta si se sabe quién la vendió; si no, SIN_VENDEDOR."""
    return c["vendedor"] if c.get("atribucion") in ATRIBUIDAS and c.get("vendedor") else SIN_VENDEDOR


def _cargado_por(c: dict[str, Any]) -> str:
    """Quién cargó una venta sin vendedor: «legajo nombre»."""
    v = c.get("vendedor") or ""
    return v[len("CARGADO POR"):].strip() if v.startswith("CARGADO POR") else (c.get("legajo") or "—")


def _estados(c: Counter) -> dict[str, int]:
    """Cantidades por estado, en el orden de `ESTADOS` (los que no se conocen, al final)."""
    orden = [e for e in ESTADOS if c.get(e)] + sorted(e for e in c if e not in ESTADOS and c[e])
    return {e: c[e] for e in orden}


def cargas_de(data: dict[str, Any]) -> list[dict[str, Any]] | None:
    """Las ventas de la hoja de productividad del informe de Ventas Netas (None si el informe no la trae)."""
    prod = data.get("productividad")
    if not isinstance(prod, dict) or "detalle_cargas" not in prod:
        return None
    return prod.get("detalle_cargas") or []


def ventas_del_mes(data: dict[str, Any]) -> int | None:
    """Cuántas ventas que cuentan trae el informe de Ventas Netas (None si no trae la hoja de productividad)."""
    cargas = cargas_de(data)
    return None if cargas is None else sum(1 for c in cargas if cuenta(c))


def _pct(a: float, b: float) -> float | None:
    return round(a / b * 100, 1) if b else None


def _sph(ventas: int, segundos: float) -> float | None:
    return round(ventas / (segundos / 3600), 2) if segundos > 0 else None


class DatosIncompletos(ValueError):
    """Los informes de origen no traen lo necesario para calcular el SPH."""


def fin_de_mes(d: date) -> date:
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


def tipo_periodo(desde: date, hasta: date) -> str:
    """dia · semana (lunes a domingo) · mes (del 1 al último día) · rango."""
    if desde == hasta:
        return "dia"
    if desde.weekday() == 0 and (hasta - desde).days == 6:
        return "semana"
    if desde.day == 1 and hasta == fin_de_mes(desde):
        return "mes"
    return "rango"


def _mes(d: date) -> str:
    return d.strftime("%Y-%m")


_MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
          "noviembre", "diciembre"]


def nombre_mes(periodo: str) -> str:
    """'2026-10' → 'octubre 2026'."""
    try:
        return f"{_MESES[int(periodo[5:7]) - 1]} {periodo[:4]}"
    except (ValueError, IndexError):
        return periodo


def _corto(d: date) -> str:
    return d.strftime("%d/%m")


def _lista_fechas(dias: list[date], tope: int = 8) -> str:
    txt = ", ".join(_corto(d) for d in dias[:tope])
    return txt + (f" y {len(dias) - tope} más" if len(dias) > tope else "")


def _lista(x: Any) -> list[dict[str, Any]]:
    """Las fuentes de la v1 venían como un solo dict; desde la v2, en listas."""
    return x if isinstance(x, list) else [x] if x else []


def _subida(fuente: dict[str, Any]) -> datetime | None:
    """Cuándo se generó el informe de ventas, en hora de Paraguay (None si no se sabe)."""
    try:
        d = datetime.fromisoformat(fuente["generated_at"]) if fuente.get("generated_at") else None
    except (TypeError, ValueError):
        return None
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).astimezone(ZONA) if d else None


def calcular_periodo(desde: date, hasta: date, produccion: dict[date, dict[str, Any]], ventas: dict[str, dict[str, Any]],
                     fuentes: dict[str, Any], manuales: dict[str, str | None] | None = None,
                     min_horas_ranking: float | None = None, hasta_datos: date | None = None,
                     fijos: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    """SPH de un período: un día, una semana, un mes o un rango.

    `produccion`: fecha → data del informe de Productividad de ese día (los días que lo tienen).
    `ventas`: 'YYYY-MM' → data del informe de Ventas Netas de ese mes (su hoja de productividad).
    `fuentes`: {"productividad": [...], "ventas": [{"periodo", "fecha_dato", "generated_at", ...}]}: qué informes
    se usaron; se guarda tal cual y de ahí sale el corte de ventas de cada mes.
    `hasta_datos`: los días posteriores (p. ej. el resto del mes en curso) no se informan como faltantes.
    `fijos`: el cruce de cada agente según el maestro de operadores (manda sobre el automático).
    """
    if min_horas_ranking is None:
        min_horas_ranking = MIN_HORAS_RANKING if desde == hasta else MIN_HORAS_RANKING_PERIODO
    fuente_mes = {f.get("periodo"): f for f in _lista(fuentes.get("ventas"))}
    limite = min(hasta, hasta_datos) if hasta_datos else hasta

    # Qué días cuentan: con horas y con ventas al corte.
    cobertura: list[dict[str, Any]] = []
    cubiertos: list[date] = []
    d = desde
    while d <= hasta:
        if d <= limite:
            corte = (fuente_mes.get(_mes(d)) or {}).get("fecha_dato")
            horas_ok = bool((produccion.get(d) or {}).get("agentes"))
            ventas_ok = _mes(d) in ventas and (not corte or corte >= d.isoformat())
            cobertura.append({"fecha": d.isoformat(), "horas": horas_ok, "ventas": ventas_ok})
            if horas_ok and ventas_ok:
                cubiertos.append(d)
        d += timedelta(days=1)
    if not cubiertos:
        raise DatosIncompletos("Ningún día del período tiene horas de Productividad y ventas al corte.")
    meses = sorted({_mes(d) for d in cubiertos})
    cargas_mes: dict[str, list[dict[str, Any]]] = {}
    for mes in meses:
        cargas = cargas_de(ventas[mes])
        if cargas is None:
            raise DatosIncompletos(f"El informe de Ventas Netas de {nombre_mes(mes)} no trae la hoja de productividad: "
                                   "recalculalo en Ventas Netas.")
        cargas_mes[mes] = cargas

    # Vendedores de los meses que cuentan (para el cruce): sus ventas del mes y su subcanal.
    subcanal: dict[str, str | None] = {}
    ventas_mes_v: Counter = Counter()
    for mes, cargas in cargas_mes.items():
        for c in cargas:
            v = vendedor_venta(c)
            if v != SIN_VENDEDOR:
                ventas_mes_v[v] += cuenta(c)
                if c.get("subcanal") or v not in subcanal:
                    subcanal[v] = c.get("subcanal") or subcanal.get(v)
        for f in (ventas[mes].get("productividad") or {}).get("por_vendedor") or []:  # informes sin subcanal en el detalle
            if f.get("vendedor") in subcanal and not subcanal[f["vendedor"]]:
                subcanal[f["vendedor"]] = f.get("subcanal")
    roster = set(ventas_mes_v)

    # Ventas de cada día, de la planilla de su mes: las que se cruzan con las horas de ese día.
    dias_iso = {d.isoformat() for d in cubiertos}
    del_dia: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for mes, cargas in cargas_mes.items():
        for c in cargas:
            f = (c.get("fecha_alta") or "")[:10]
            if f in dias_iso and f[:7] == mes:
                del_dia[f].append(c)

    # Agentes del período: nombre del último día en que se conectaron. Un solo cruce para todo el período.
    agentes: dict[str, dict[str, Any]] = {}
    for d in cubiertos:
        for a in produccion[d]["agentes"]:
            agentes[a["clave"]] = a
    vinculos = cruzar(agentes.values(), roster, manuales, fijos)
    vendedor_de = {k: v["vendedor"] for k, v in vinculos.items() if v["vendedor"]}
    agente_de = {v: k for k, v in vendedor_de.items()}

    acc = {k: {"login": 0, "login_abierta": 0, "dias": 0, "dias_sesion_abierta": 0, "ventas": 0, "ventas_sesion_abierta": 0,
               "productos": Counter(), "estados": Counter(), "llamadas": 0, "conversacion": 0, "modos": Counter(),
               "turnos": Counter()}
           for k in agentes}
    sin_agente_n: Counter = Counter()
    sin_agente_e: dict[str, Counter] = defaultdict(Counter)
    sin_vendedor: Counter = Counter()
    productos: Counter = Counter()
    subcanales: Counter = Counter()
    estados_tot: Counter = Counter()
    serie: list[dict[str, Any]] = []
    total = {"ventas": 0, "abiertas": 0}
    for d in cubiertos:
        dia = d.isoformat()
        ventas_v: dict[str, Counter] = defaultdict(Counter)   # vendedor → producto → ventas que cuentan
        estados_v: dict[str, Counter] = defaultdict(Counter)  # vendedor → estado → cargas (todas)
        estados_dia: Counter = Counter()
        n_dia = 0
        for c in del_dia.get(dia, []):
            v, e = vendedor_venta(c), estado_de(c)
            estados_v[v][e] += 1
            estados_dia[e] += 1
            if not cuenta(c):
                continue
            n_dia += 1
            prod = c.get("producto") or "Otros"
            ventas_v[v][prod] += 1
            productos[prod] += 1
            subcanales[subcanal.get(v) if v != SIN_VENDEDOR else None] += 1
            if v == SIN_VENDEDOR:
                sin_vendedor[_cargado_por(c)] += 1
        estados_tot.update(estados_dia)
        conectados = {a["clave"]: a for a in produccion[d]["agentes"]}
        horas_dia = abiertas_dia = 0
        for k, a in conectados.items():
            r = acc[k]
            login = int(a.get("login") or 0)
            vend = vendedor_de.get(k)
            n_v = sum(ventas_v[vend].values()) if vend in ventas_v else 0
            r["dias"] += 1
            r["llamadas"] += int(a.get("llamadas") or 0)
            r["conversacion"] += int(a.get("conversacion") or 0)
            r["modos"][a.get("modo")] += 1
            r["turnos"][a.get("turno")] += 1
            if a.get("dias_sesion_abierta"):  # horas que no son reales: fuera del SPH, con sus ventas
                r["dias_sesion_abierta"] += 1
                r["login_abierta"] += login
                r["ventas_sesion_abierta"] += n_v
                abiertas_dia += n_v
                continue
            r["login"] += login
            horas_dia += login
            if vend:
                r["ventas"] += n_v
                r["productos"].update(ventas_v.get(vend, {}))
                r["estados"].update(estados_v.get(vend, {}))
        # Ventas de vendedores sin un agente conectado ese día: cuentan para la operación, no para un asesor.
        for v, es in estados_v.items():
            if v != SIN_VENDEDOR and agente_de.get(v) not in conectados:
                sin_agente_n[v] += sum(ventas_v[v].values()) if v in ventas_v else 0
                sin_agente_e[v].update(es)
        total["ventas"] += n_dia
        total["abiertas"] += abiertas_dia
        serie.append({"fecha": dia, "ventas": n_dia, "ventas_operacion": n_dia - abiertas_dia, "horas": horas_dia,
                      "sph": _sph(n_dia - abiertas_dia, horas_dia), "estados": _estados(estados_dia),
                      "agentes": len(conectados)})

    filas: list[dict[str, Any]] = []
    for k, a in agentes.items():
        vin, r = vinculos[k], acc[k]
        vend = vin["vendedor"]
        filas.append({
            "clave": k, "nombre": a.get("nombre") or k,
            "vendedor": vend, "subcanal": subcanal.get(vend) if vend else None,
            "nivel": vin["nivel"], "candidatos": vin["candidatos"],
            "login": r["login"], "login_abierta": r["login_abierta"],
            "dias": r["dias"], "dias_sesion_abierta": r["dias_sesion_abierta"],
            "sesion_abierta": r["dias_sesion_abierta"] > 0,
            "llamadas": r["llamadas"], "conversacion": r["conversacion"],
            "modo": r["modos"].most_common(1)[0][0], "turno": r["turnos"].most_common(1)[0][0],
            "ventas": r["ventas"] if vend else None, "ventas_sesion_abierta": r["ventas_sesion_abierta"] if vend else 0,
            "productos": dict(r["productos"]), "estados": _estados(r["estados"]) if vend else {},
            "sph": _sph(r["ventas"], r["login"]) if vend and r["login"] else None,
            "en_ranking": bool(vend) and r["login"] >= min_horas_ranking * 3600,
        })
    filas.sort(key=lambda f: (f["sph"] is None, -(f["sph"] or 0), -(f["ventas"] or 0), f["nombre"]))

    validos = [f for f in filas if f["login"] > 0]
    vinc_validos = [f for f in validos if f["vendedor"]]
    horas = sum(f["login"] for f in validos)
    ventas_op = total["ventas"] - total["abiertas"]
    ventas_vinc = sum(f["ventas"] or 0 for f in vinc_validos)
    horas_vinc = sum(f["login"] for f in vinc_validos)
    sin_agente = sorted(({"vendedor": v, "subcanal": subcanal.get(v), "ventas": n, "estados": _estados(sin_agente_e[v])}
                         for v, n in sin_agente_n.items() if n), key=lambda x: (-x["ventas"], x["vendedor"]))

    estados = _estados(estados_tot)
    niveles = Counter(f["nivel"] for f in filas)
    kpis = {
        "sph": _sph(ventas_op, horas),
        "ventas": total["ventas"],
        "ventas_operacion": ventas_op,
        "ventas_sesion_abierta": total["abiertas"],
        "ventas_vinculadas": ventas_vinc,
        "ventas_sin_agente": sum(x["ventas"] for x in sin_agente),
        "ventas_sin_vendedor": sum(sin_vendedor.values()),
        "horas": horas,
        "horas_vinculadas": horas_vinc,
        "sph_vinculados": _sph(ventas_vinc, horas_vinc),
        "estados": estados,
        "finalizadas": estados.get(ESTADO_FINALIZADA, 0),
        "pendientes": sum(n for e, n in estados.items() if e != ESTADO_FINALIZADA and e not in NO_CUENTAN),
        "no_cuentan": sum(estados.get(e, 0) for e in NO_CUENTAN),
        "pct_finalizadas": _pct(estados.get(ESTADO_FINALIZADA, 0), total["ventas"]),
        "agentes": len(filas),
        "agentes_validos": len(validos),
        "agentes_por_dia": round(sum(x["agentes"] for x in serie) / len(serie), 1),
        "sesiones_abiertas": sum(f["dias_sesion_abierta"] for f in filas),
        "vinculados": sum(niveles[n] for n in VINCULADOS),
        "niveles": dict(niveles),
        "en_ranking": sum(1 for f in filas if f["en_ranking"]),
        "pct_cobertura": _pct(ventas_vinc, ventas_op),
        "pct_cobertura_horas": _pct(horas_vinc, horas),
        "productos": dict(productos.most_common()),
        "dias": (hasta - desde).days + 1,
        "dias_cubiertos": len(cubiertos),
    }

    un_dia = desde == hasta
    avisos: list[str] = []
    # Una planilla subida el mismo día que cuenta puede no traer todas las ventas de ese día (se bajó antes del cierre).
    parciales = [(d, s) for d in cubiertos if (s := _subida(fuente_mes.get(_mes(d)) or {})) and s.date() <= d]
    if parciales:
        d, s = parciales[-1]
        if un_dia:
            avisos.append(f"La planilla de ventas se subió el mismo día ({_corto(d)} a las {s:%H:%M}): si se bajó antes del "
                          "cierre, le faltan ventas de ese día. Recalculá el SPH con la planilla del día siguiente.")
        else:
            avisos.append(f"La planilla de ventas de {nombre_mes(_mes(d))} se subió el {_corto(d)} a las {s:%H:%M}, el mismo "
                          "día que cuenta: si se bajó antes del cierre, le faltan ventas de ese día. Recalculalo con la "
                          "planilla del día siguiente.")
    sin_horas = [date.fromisoformat(c["fecha"]) for c in cobertura if not c["horas"]]
    sin_ventas = [date.fromisoformat(c["fecha"]) for c in cobertura if c["horas"] and not c["ventas"]]
    if not un_dia and sin_horas:
        avisos.append(f"Sin informe de Productividad (no suman horas ni ventas): {_lista_fechas(sin_horas)}.")
    if not un_dia and sin_ventas:
        avisos.append(f"Con horas pero sin ventas al corte (quedan fuera hasta un corte de ventas posterior): {_lista_fechas(sin_ventas)}.")
    prod_borrador = [date.fromisoformat(f["fecha"]) for f in _lista(fuentes.get("productividad"))
                     if f.get("status") != "published" and f.get("fecha")]
    ventas_borrador = [nombre_mes(f.get("periodo") or "") for f in _lista(fuentes.get("ventas")) if f.get("status") != "published"]
    if un_dia:
        avisos += [f"Se calculó con el borrador de {nombre} (no está publicado)."
                   for nombre, hay in (("Productividad", prod_borrador), ("Ventas Netas", ventas_borrador)) if hay]
    elif prod_borrador or ventas_borrador:
        partes = ([f"Productividad de {'los días' if len(prod_borrador) > 1 else 'el'} {_lista_fechas(sorted(prod_borrador))}"] if prod_borrador else [])
        partes += [f"Ventas Netas de {' y '.join(ventas_borrador)}"] if ventas_borrador else []
        avisos.append(f"Se calculó con borradores (no publicados): {'; '.join(partes)}.")
    if kpis["sesiones_abiertas"]:
        quienes = "agente(s)" if un_dia else "jornada(s) de agentes"
        avisos.append(
            f"{kpis['sesiones_abiertas']} {quienes} con sesión abierta: sus horas no son reales y quedan fuera del SPH"
            + (f", junto con sus {kpis['ventas_sesion_abierta']} venta(s)." if kpis["ventas_sesion_abierta"] else ".")
        )
    cuando = "del día" if un_dia else "del período"
    if kpis["ventas_sin_agente"]:
        avisos.append(
            f"{kpis['ventas_sin_agente']} venta(s) {cuando} son de vendedores que no se vincularon con un agente conectado: "
            "cuentan en el SPH de la operación, no en el de los asesores. Si es un nombre distinto, vinculalo a mano."
        )
    if kpis["ventas_sin_vendedor"]:
        avisos.append(
            f"{kpis['ventas_sin_vendedor']} venta(s) {cuando} se cargaron sin POS desde un legajo que carga para más de un "
            "vendedor y todavía no se activaron: no se sabe quién las vendió. Cuentan en el SPH de la operación, no en el "
            "de un asesor; cuando se activan, su línea dice el vendedor (recalculá con una planilla posterior)."
        )
    nuevos = [e for e in estados if e not in ESTADOS]
    if nuevos:
        avisos.append(f"La hoja de productividad trae estados que el SPH no conoce ({', '.join(f'{e}: {estados[e]}' for e in nuevos)}): "
                      "cuentan como ventas del día. Si alguno no es una venta, avisá para dejarlo fuera.")

    return {
        "version": VERSION_SPH,
        "base": "ventas",
        "desde": desde.isoformat(),
        "hasta": hasta.isoformat(),
        "fecha": desde.isoformat(),
        "tipo": tipo_periodo(desde, hasta),
        "fuentes": fuentes,
        "parametros": {"min_horas_ranking": min_horas_ranking},
        "kpis": kpis,
        "serie": serie,
        "cobertura": cobertura,
        "agentes": filas,
        "ventas_sin_agente": sin_agente,
        "sin_vendedor": [{"cargado_por": k, "ventas": n} for k, n in sin_vendedor.most_common()],
        "por_subcanal": [{"subcanal": sc or "—", "ventas": n} for sc, n in subcanales.most_common()],
        "vendedores": sorted(({"vendedor": v, "subcanal": subcanal.get(v), "ventas_mes": ventas_mes_v.get(v, 0)}
                              for v in roster), key=lambda x: x["vendedor"]),
        "avisos": avisos,
    }


def calcular(fecha: date, prod: dict[str, Any], ventas: dict[str, Any], fuentes: dict[str, Any],
             manuales: dict[str, str | None] | None = None,
             min_horas_ranking: float = MIN_HORAS_RANKING) -> dict[str, Any]:
    """SPH de un día: el informe de Productividad del día y el de Ventas Netas de su mes."""
    if not prod.get("agentes"):
        raise DatosIncompletos("El informe de Productividad del día no tiene agentes conectados.")
    venta = {**(fuentes.get("ventas") or {})}
    venta.setdefault("periodo", _mes(fecha))
    f = {"productividad": _lista(fuentes.get("productividad")), "ventas": [venta]}
    return calcular_periodo(fecha, fecha, {fecha: prod}, {venta["periodo"]: ventas}, f, manuales, min_horas_ranking)


def resumen_lista(data: dict[str, Any]) -> dict[str, Any]:
    """Columnas desnormalizadas del informe (para listar sin abrir el JSON). `netas` es de los SPH anteriores a la v4."""
    k = data["kpis"]
    return {"sph": k["sph"], "ventas": k["ventas"], "netas": 0, "horas": round(k["horas"] / 3600, 2), "agentes": k["agentes"],
            "vinculados": k["vinculados"], "pct_cobertura": k["pct_cobertura"], "pct_activadas": None,
            "dias": k.get("dias_cubiertos", 1), "version": data.get("version", VERSION_SPH)}
