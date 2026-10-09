"""SPH estimado (ventas por hora): las horas de Productividad cruzadas con las netas de Ventas Netas.

Definiciones:

- Horas: tiempo conectado (login) de cada agente en el informe de Productividad del día.
  Las sesiones abiertas (marcadas por Productividad) no cuentan: no son horas trabajadas.
- Netas del día: líneas netas (hoja DDI) del informe de Ventas Netas del mes cuya fecha de
  venta es el día. Fecha de venta = la de la carga; si no viene, la fecha de carga (en los
  datos son iguales). Una neta sin ninguna de las dos no se puede ubicar en un día.
- Cargadas del día: ventas cargadas ese día (hoja CARGAS) sin las rechazadas. Las netas de un
  día se siguen activando hasta dos semanas después: netas ÷ cargadas dice cuánto ya se activó.
- Cruce: no hay un ID común. El agente («APELLIDOS, NOMBRES» en la plataforma) se vincula con
  el vendedor del POS («NOMBRES APELLIDOS» en Claro) cuando están su primer apellido y su primer
  nombre. Exacto: están todas las palabras del agente. Probable: falta alguna, cambia la
  escritura (QUIÑONEZ / QUINONES) o el apellido aparece al final de un nombre largo (puede ser
  el segundo apellido). Uno a uno: un vendedor no va a dos agentes; con empate queda ambiguo y
  no se asigna. Los vínculos manuales mandan sobre el cruce automático. Desde Supervisión, el
  cruce sale del maestro de operadores (la misma lógica, guardada y corregible a mano).
- SPH del asesor = netas ÷ horas conectadas. Entra al ranking desde `min_horas_ranking`
  (2 h en un día; 6 h, una jornada, en una semana, un mes o un rango).
- SPH de la operación = netas ÷ horas conectadas del equipo, sin las sesiones abiertas:
  ni sus horas ni las netas de esos agentes ese día, para comparar lo mismo con lo mismo.
- Período (semana, mes o rango): suma día por día. Un día CUENTA si tiene informe de
  Productividad (horas) y el corte de ventas de su mes ya lo alcanza; los demás se informan.
  Cada neta se atribuye al asesor solo los días en que estuvo conectado.

Todo es lógica pura (sin DB): recibe los datos de los informes y devuelve el del SPH.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date, timedelta
from difflib import SequenceMatcher
from typing import Any, Iterable

VERSION_SPH = 2              # v2: períodos (semana, mes, rango), fuentes en listas, horas válidas por agente
MIN_HORAS_RANKING = 2.0      # horas conectadas mínimas para entrar al ranking de SPH de un día
MIN_HORAS_RANKING_PERIODO = 6.0  # de una semana, un mes o un rango: al menos una jornada
DIAS_MAX_PERIODO = 62
DIAS_MADURACION = 7          # corte de ventas a menos días que esto: las netas del día siguen activándose
ESTADO_RECHAZADA = "Vta_Rechazada"
SIN_VENDEDOR = "SIN VENDEDOR"
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
def fecha_de_venta(neta: dict[str, Any]) -> str | None:
    return neta.get("fecha_venta") or neta.get("fecha_carga")


def _pct(a: float, b: float) -> float | None:
    return round(a / b * 100, 1) if b else None


def _sph(netas: int, segundos: float) -> float | None:
    return round(netas / (segundos / 3600), 2) if segundos > 0 else None


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


def calcular_periodo(desde: date, hasta: date, produccion: dict[date, dict[str, Any]], ventas: dict[str, dict[str, Any]],
                     fuentes: dict[str, Any], manuales: dict[str, str | None] | None = None,
                     min_horas_ranking: float | None = None, hasta_datos: date | None = None,
                     fijos: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    """SPH de un período: un día, una semana, un mes o un rango.

    `produccion`: fecha → data del informe de Productividad de ese día (los días que lo tienen).
    `ventas`: 'YYYY-MM' → data del informe de Ventas Netas de ese mes.
    `fuentes`: {"productividad": [...], "ventas": [{"periodo", "fecha_dato", ...}]}: qué informes se
    usaron; se guarda tal cual y de ahí sale el corte de ventas de cada mes.
    `hasta_datos`: los días posteriores (p. ej. el resto del mes en curso) no se informan como faltantes.
    `fijos`: el cruce de cada agente según el maestro de operadores (manda sobre el automático).
    """
    if min_horas_ranking is None:
        min_horas_ranking = MIN_HORAS_RANKING if desde == hasta else MIN_HORAS_RANKING_PERIODO
    for data in ventas.values():
        netas = data.get("detalle_netas") or []
        if netas and not any(k in netas[0] for k in ("fecha_venta", "fecha_carga")):
            raise DatosIncompletos("El informe de ventas no trae la fecha de venta de cada neta: recalculalo en Ventas Netas.")
    cortes = {f.get("periodo"): f.get("fecha_dato") for f in _lista(fuentes.get("ventas"))}
    limite = min(hasta, hasta_datos) if hasta_datos else hasta

    # Qué días cuentan: con horas y con ventas al corte.
    cobertura: list[dict[str, Any]] = []
    cubiertos: list[date] = []
    d = desde
    while d <= hasta:
        if d <= limite:
            corte = cortes.get(_mes(d))
            horas_ok = bool((produccion.get(d) or {}).get("agentes"))
            ventas_ok = _mes(d) in ventas and (not corte or corte >= d.isoformat())
            cobertura.append({"fecha": d.isoformat(), "horas": horas_ok, "ventas": ventas_ok})
            if horas_ok and ventas_ok:
                cubiertos.append(d)
        d += timedelta(days=1)
    if not cubiertos:
        raise DatosIncompletos("Ningún día del período tiene horas de Productividad y ventas al corte.")

    # Vendedores de los meses que cuentan (para el cruce) y su subcanal.
    subcanal: dict[str, str | None] = {}
    netas_mes_v: Counter = Counter()
    roster: set[str] = set()
    sin_fecha = 0
    for mes in sorted({_mes(d) for d in cubiertos}):
        data = ventas[mes]
        for x in data.get("detalle_netas") or []:
            v = x.get("vendedor") or SIN_VENDEDOR
            netas_mes_v[v] += 1
            subcanal.setdefault(v, x.get("subcanal"))
            sin_fecha += 0 if fecha_de_venta(x) else 1
        roster |= {c["vendedor"] for c in (data.get("productividad") or {}).get("detalle_cargas") or []
                   if c.get("vendedor") and c.get("atribucion") in ("pos", "legajo")}
    roster |= set(netas_mes_v)
    roster.discard(SIN_VENDEDOR)

    # Agentes del período: nombre del último día en que se conectaron. Un solo cruce para todo el período.
    agentes: dict[str, dict[str, Any]] = {}
    for d in cubiertos:
        for a in produccion[d]["agentes"]:
            agentes[a["clave"]] = a
    vinculos = cruzar(agentes.values(), roster, manuales, fijos)
    vendedor_de = {k: v["vendedor"] for k, v in vinculos.items() if v["vendedor"]}
    agente_de = {v: k for k, v in vendedor_de.items()}

    acc = {k: {"login": 0, "login_abierta": 0, "dias": 0, "dias_sesion_abierta": 0, "netas": 0, "netas_sesion_abierta": 0,
               "productos": Counter(), "cargadas": 0, "llamadas": 0, "conversacion": 0, "modos": Counter(), "turnos": Counter()}
           for k in agentes}
    sin_agente_p: dict[str, Counter] = defaultdict(Counter)
    sin_agente_c: Counter = Counter()
    productos: Counter = Counter()
    subcanales: Counter = Counter()
    serie: list[dict[str, Any]] = []
    total = {"netas": 0, "cargadas": 0, "netas_abiertas": 0, "cargadas_abiertas": 0}
    for d in cubiertos:
        dia = d.isoformat()
        mes = ventas[_mes(d)]
        netas = [x for x in mes.get("detalle_netas") or [] if fecha_de_venta(x) == dia]
        cargas = [c for c in (mes.get("productividad") or {}).get("detalle_cargas") or []
                  if c.get("fecha_alta") == dia and c.get("estado") != ESTADO_RECHAZADA]
        netas_v: dict[str, Counter] = defaultdict(Counter)
        for x in netas:
            prod = x.get("producto") or "Otros"
            netas_v[x.get("vendedor") or SIN_VENDEDOR][prod] += 1
            productos[prod] += 1
            subcanales[x.get("subcanal")] += 1
        cargadas_v = Counter(c.get("vendedor") or SIN_VENDEDOR for c in cargas)
        conectados = {a["clave"]: a for a in produccion[d]["agentes"]}
        horas_dia = abiertas_dia = cargadas_abiertas_dia = 0
        for k, a in conectados.items():
            r = acc[k]
            login = int(a.get("login") or 0)
            vend = vendedor_de.get(k)
            n_v = sum(netas_v[vend].values()) if vend in netas_v else 0
            r["dias"] += 1
            r["llamadas"] += int(a.get("llamadas") or 0)
            r["conversacion"] += int(a.get("conversacion") or 0)
            r["modos"][a.get("modo")] += 1
            r["turnos"][a.get("turno")] += 1
            if a.get("dias_sesion_abierta"):  # horas que no son reales: fuera del SPH, con sus netas
                r["dias_sesion_abierta"] += 1
                r["login_abierta"] += login
                r["netas_sesion_abierta"] += n_v
                abiertas_dia += n_v
                cargadas_abiertas_dia += cargadas_v.get(vend, 0) if vend else 0
                continue
            r["login"] += login
            horas_dia += login
            if vend:
                r["netas"] += n_v
                r["productos"].update(netas_v.get(vend, {}))
                r["cargadas"] += cargadas_v.get(vend, 0)
        # Netas de vendedores sin un agente conectado ese día: cuentan para la operación, no para un asesor.
        for v, prods in netas_v.items():
            if agente_de.get(v) not in conectados:
                sin_agente_p[v].update(prods)
        for v, c in cargadas_v.items():
            if agente_de.get(v) not in conectados:
                sin_agente_c[v] += c
        total["netas"] += len(netas)
        total["cargadas"] += len(cargas)
        total["netas_abiertas"] += abiertas_dia
        total["cargadas_abiertas"] += cargadas_abiertas_dia
        serie.append({"fecha": dia, "netas": len(netas), "netas_operacion": len(netas) - abiertas_dia, "horas": horas_dia,
                      "sph": _sph(len(netas) - abiertas_dia, horas_dia), "cargadas": len(cargas),
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
            "netas": r["netas"] if vend else None, "netas_sesion_abierta": r["netas_sesion_abierta"] if vend else 0,
            "productos": dict(r["productos"]), "cargadas": r["cargadas"] if vend else None,
            "sph": _sph(r["netas"], r["login"]) if vend and r["login"] else None,
            "sph_cargadas": _sph(r["cargadas"], r["login"]) if vend and r["login"] else None,
            "en_ranking": bool(vend) and r["login"] >= min_horas_ranking * 3600,
        })
    filas.sort(key=lambda f: (f["sph"] is None, -(f["sph"] or 0), -(f["netas"] or 0), f["nombre"]))

    validos = [f for f in filas if f["login"] > 0]
    vinc_validos = [f for f in validos if f["vendedor"]]
    horas = sum(f["login"] for f in validos)
    netas_op = total["netas"] - total["netas_abiertas"]
    netas_vinc = sum(f["netas"] or 0 for f in vinc_validos)
    horas_vinc = sum(f["login"] for f in vinc_validos)

    sin_agente = []
    for v in sorted(set(sin_agente_p) | set(sin_agente_c)):
        # Las cargas sin POS quedan "CARGADO POR <legajo>": no son un vendedor para vincular.
        if not sin_agente_p.get(v) and v.startswith("CARGADO POR"):
            continue
        sin_agente.append({"vendedor": v, "subcanal": subcanal.get(v), "netas": sum(sin_agente_p[v].values()),
                           "cargadas": sin_agente_c.get(v, 0)})
    sin_agente.sort(key=lambda x: (-x["netas"], -x["cargadas"], x["vendedor"]))

    niveles = Counter(f["nivel"] for f in filas)
    kpis = {
        "sph": _sph(netas_op, horas),
        "netas": total["netas"],
        "netas_operacion": netas_op,
        "netas_sesion_abierta": total["netas_abiertas"],
        "netas_vinculadas": netas_vinc,
        "netas_sin_agente": sum(x["netas"] for x in sin_agente),
        "horas": horas,
        "horas_vinculadas": horas_vinc,
        "sph_vinculados": _sph(netas_vinc, horas_vinc),
        "cargadas": total["cargadas"],
        "sph_cargadas": _sph(total["cargadas"] - total["cargadas_abiertas"], horas),
        "pct_activadas": _pct(total["netas"], total["cargadas"]),
        "agentes": len(filas),
        "agentes_validos": len(validos),
        "agentes_por_dia": round(sum(x["agentes"] for x in serie) / len(serie), 1),
        "sesiones_abiertas": sum(f["dias_sesion_abierta"] for f in filas),
        "vinculados": sum(niveles[n] for n in VINCULADOS),
        "niveles": dict(niveles),
        "en_ranking": sum(1 for f in filas if f["en_ranking"]),
        "pct_cobertura": _pct(netas_vinc, netas_op),
        "pct_cobertura_horas": _pct(horas_vinc, horas),
        "productos": dict(productos.most_common()),
        "netas_sin_fecha_mes": sin_fecha,
        "dias": (hasta - desde).days + 1,
        "dias_cubiertos": len(cubiertos),
    }

    un_dia = desde == hasta
    ultimo = cubiertos[-1]
    corte = cortes.get(_mes(ultimo))
    dias_despues = (date.fromisoformat(corte) - ultimo).days if corte else None
    avisos: list[str] = []
    if dias_despues is not None and dias_despues < DIAS_MADURACION and kpis["cargadas"]:
        if un_dia:
            cuando = "es del mismo día" if dias_despues == 0 else f"es de {dias_despues} día(s) después"
            avisos.append(
                f"El corte de ventas {cuando}: de {kpis['cargadas']} ventas cargadas ese día ya "
                f"son netas {kpis['netas']} ({kpis['pct_activadas'] or 0:.0f}%). Las netas de un día se siguen activando hasta "
                "dos semanas después: recalculá el SPH con un corte de ventas posterior para completarlo."
            )
        else:
            cuando = "el mismo último día que cuenta" if dias_despues == 0 else f"{dias_despues} día(s) después del último día que cuenta"
            avisos.append(
                f"El corte de ventas es del {_corto(date.fromisoformat(corte))}, {cuando}: "
                f"de {kpis['cargadas']} ventas cargadas en el período ya son netas {kpis['netas']} "
                f"({kpis['pct_activadas'] or 0:.0f}%). Los últimos días todavía suman netas: recalculalo con un corte posterior."
            )
    sin_horas = [date.fromisoformat(c["fecha"]) for c in cobertura if not c["horas"]]
    sin_ventas = [date.fromisoformat(c["fecha"]) for c in cobertura if c["horas"] and not c["ventas"]]
    if not un_dia and sin_horas:
        avisos.append(f"Sin informe de Productividad (no suman horas ni netas): {_lista_fechas(sin_horas)}.")
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
            + (f", junto con sus {kpis['netas_sesion_abierta']} neta(s)." if kpis["netas_sesion_abierta"] else ".")
        )
    if kpis["netas_sin_agente"]:
        avisos.append(
            f"{kpis['netas_sin_agente']} neta(s) {'del día' if un_dia else 'del período'} son de vendedores que no se vincularon "
            "con un agente conectado: cuentan en el SPH de la operación, no en el de los asesores. Si es un nombre distinto, "
            "vinculalo a mano."
        )
    if sin_fecha:
        avisos.append(f"{sin_fecha} neta(s) del mes no traen fecha de venta ni de carga: no se pueden ubicar en un día.")

    return {
        "version": VERSION_SPH,
        "desde": desde.isoformat(),
        "hasta": hasta.isoformat(),
        "fecha": desde.isoformat(),
        "tipo": tipo_periodo(desde, hasta),
        "fuentes": {**fuentes, "dias_despues": dias_despues},
        "parametros": {"min_horas_ranking": min_horas_ranking, "dias_maduracion": DIAS_MADURACION},
        "kpis": kpis,
        "serie": serie,
        "cobertura": cobertura,
        "agentes": filas,
        "ventas_sin_agente": sin_agente,
        "por_subcanal": [{"subcanal": sc or "—", "netas": n} for sc, n in subcanales.most_common()],
        "vendedores": sorted(({"vendedor": v, "subcanal": subcanal.get(v), "netas_mes": netas_mes_v.get(v, 0)}
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
    """Columnas desnormalizadas del informe (para listar sin abrir el JSON)."""
    k = data["kpis"]
    return {"sph": k["sph"], "netas": k["netas"], "horas": round(k["horas"] / 3600, 2), "agentes": k["agentes"],
            "vinculados": k["vinculados"], "pct_cobertura": k["pct_cobertura"], "pct_activadas": k["pct_activadas"],
            "dias": k.get("dias_cubiertos", 1)}
