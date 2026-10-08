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
  no se asigna. Los vínculos manuales mandan sobre el cruce automático.
- SPH del asesor = netas del día ÷ horas conectadas. Entra al ranking desde `min_horas_ranking`.
- SPH de la operación = netas del día ÷ horas conectadas del equipo, sin las sesiones
  abiertas: ni sus horas ni las netas de esos agentes, para comparar lo mismo con lo mismo.

Todo es lógica pura (sin DB): recibe los datos de los dos informes y devuelve el del SPH.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from difflib import SequenceMatcher
from typing import Any, Iterable

VERSION_SPH = 1
MIN_HORAS_RANKING = 2.0      # horas conectadas mínimas para entrar al ranking de SPH
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
           manuales: dict[str, str | None] | None = None) -> dict[str, dict[str, Any]]:
    """Vínculo de cada agente con un vendedor del período: clave → {vendedor, nivel, candidatos}.

    `agentes`: [{"clave", ...}] (la clave de Productividad: «APELLIDOS, NOMBRES» sin tildes).
    `manuales`: clave → vendedor (None = no vincular). Mandan sobre el cruce automático.
    """
    agentes = list(agentes)
    manuales = manuales or {}
    roster = sorted(set(vendedores) - {SIN_VENDEDOR, "", None})
    out: dict[str, dict[str, Any]] = {}
    tomados: set[str] = set()
    for a in agentes:
        k = a["clave"]
        if k in manuales:
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


def calcular(fecha: date, prod: dict[str, Any], ventas: dict[str, Any], fuentes: dict[str, Any],
             manuales: dict[str, str | None] | None = None,
             min_horas_ranking: float = MIN_HORAS_RANKING) -> dict[str, Any]:
    """SPH del día.

    `prod`: data del informe de Productividad del día. `ventas`: data del informe de Ventas Netas
    del mes. `fuentes`: qué informes se usaron (id, estado, corte), se guarda tal cual.
    """
    dia = fecha.isoformat()
    netas_mes = ventas.get("detalle_netas") or []
    if netas_mes and not any(k in netas_mes[0] for k in ("fecha_venta", "fecha_carga")):
        raise DatosIncompletos("El informe de ventas no trae la fecha de venta de cada neta: recalculalo en Ventas Netas.")
    cargas_mes = (ventas.get("productividad") or {}).get("detalle_cargas") or []
    agentes_prod = prod.get("agentes") or []
    if not agentes_prod:
        raise DatosIncompletos("El informe de Productividad del día no tiene agentes conectados.")

    netas = [x for x in netas_mes if fecha_de_venta(x) == dia]
    cargas = [c for c in cargas_mes if c.get("fecha_alta") == dia and c.get("estado") != ESTADO_RECHAZADA]
    sin_fecha = sum(1 for x in netas_mes if not fecha_de_venta(x))

    # Vendedores del período: los de las netas y los de las cargas con vendedor atribuido.
    subcanal: dict[str, str | None] = {}
    netas_mes_v: Counter = Counter()
    for x in netas_mes:
        v = x.get("vendedor") or SIN_VENDEDOR
        netas_mes_v[v] += 1
        subcanal.setdefault(v, x.get("subcanal"))
    roster = set(netas_mes_v) | {c["vendedor"] for c in cargas_mes if c.get("vendedor") and c.get("atribucion") in ("pos", "legajo")}
    roster.discard(SIN_VENDEDOR)

    productos_v: dict[str, Counter] = defaultdict(Counter)
    for x in netas:
        productos_v[x.get("vendedor") or SIN_VENDEDOR][x.get("producto") or "Otros"] += 1
    cargadas_v = Counter(c.get("vendedor") or SIN_VENDEDOR for c in cargas)

    vinculos = cruzar(agentes_prod, roster, manuales)
    filas: list[dict[str, Any]] = []
    for a in agentes_prod:
        vin = vinculos[a["clave"]]
        vend = vin["vendedor"]
        login = int(a.get("login") or 0)
        abierta = bool(a.get("dias_sesion_abierta"))
        valido = not abierta and login > 0
        prods = productos_v.get(vend, Counter()) if vend else Counter()
        netas_a = sum(prods.values()) if vend else None
        cargadas_a = cargadas_v.get(vend, 0) if vend else None
        filas.append({
            "clave": a["clave"], "nombre": a.get("nombre") or a["clave"],
            "vendedor": vend, "subcanal": subcanal.get(vend) if vend else None,
            "nivel": vin["nivel"], "candidatos": vin["candidatos"],
            "login": login, "sesion_abierta": abierta,
            "llamadas": int(a.get("llamadas") or 0), "conversacion": int(a.get("conversacion") or 0),
            "modo": a.get("modo"), "turno": a.get("turno"),
            "netas": netas_a, "productos": dict(prods), "cargadas": cargadas_a,
            "sph": _sph(netas_a, login) if vend and valido else None,
            "sph_cargadas": _sph(cargadas_a, login) if vend and valido else None,
            "en_ranking": bool(vend) and valido and login >= min_horas_ranking * 3600,
        })
    filas.sort(key=lambda f: (f["sph"] is None, -(f["sph"] or 0), -(f["netas"] or 0), f["nombre"]))

    vinculados = {f["vendedor"] for f in filas if f["vendedor"]}
    validos = [f for f in filas if not f["sesion_abierta"] and f["login"] > 0]
    vinc_validos = [f for f in validos if f["vendedor"]]
    horas = sum(f["login"] for f in validos)
    netas_abiertas = sum(f["netas"] or 0 for f in filas if f["sesion_abierta"] and f["vendedor"])
    netas_op = len(netas) - netas_abiertas
    netas_vinc = sum(f["netas"] or 0 for f in vinc_validos)
    horas_vinc = sum(f["login"] for f in vinc_validos)

    sin_agente = []
    for v in sorted(set(productos_v) | set(cargadas_v)):
        # Las cargas sin POS quedan "CARGADO POR <legajo>": no son un vendedor para vincular.
        if v in vinculados or (not productos_v.get(v) and v.startswith("CARGADO POR")):
            continue
        sin_agente.append({"vendedor": v, "subcanal": subcanal.get(v), "netas": sum(productos_v[v].values()),
                           "cargadas": cargadas_v.get(v, 0)})
    sin_agente.sort(key=lambda x: (-x["netas"], -x["cargadas"], x["vendedor"]))

    por_subcanal = [{"subcanal": s or "—", "netas": n}
                    for s, n in Counter(x.get("subcanal") for x in netas).most_common()]
    niveles = Counter(f["nivel"] for f in filas)
    kpis = {
        "sph": _sph(netas_op, horas),
        "netas": len(netas),
        "netas_operacion": netas_op,
        "netas_sesion_abierta": netas_abiertas,
        "netas_vinculadas": netas_vinc,
        "netas_sin_agente": sum(x["netas"] for x in sin_agente),
        "horas": horas,
        "horas_vinculadas": horas_vinc,
        "sph_vinculados": _sph(netas_vinc, horas_vinc),
        "cargadas": len(cargas),
        "sph_cargadas": _sph(len(cargas) - sum(f["cargadas"] or 0 for f in filas if f["sesion_abierta"] and f["vendedor"]), horas),
        "pct_activadas": _pct(len(netas), len(cargas)),
        "agentes": len(filas),
        "agentes_validos": len(validos),
        "sesiones_abiertas": sum(1 for f in filas if f["sesion_abierta"]),
        "vinculados": sum(niveles[n] for n in VINCULADOS),
        "niveles": dict(niveles),
        "en_ranking": sum(1 for f in filas if f["en_ranking"]),
        "pct_cobertura": _pct(netas_vinc, netas_op),
        "pct_cobertura_horas": _pct(horas_vinc, horas),
        "productos": dict(Counter(x.get("producto") or "Otros" for x in netas).most_common()),
        "netas_sin_fecha_mes": sin_fecha,
    }

    avisos: list[str] = []
    corte = (fuentes.get("ventas") or {}).get("fecha_dato")
    dias_despues = (date.fromisoformat(corte) - fecha).days if corte else None
    if dias_despues is not None and dias_despues < DIAS_MADURACION and kpis["cargadas"]:
        avisos.append(
            f"El corte de ventas es de {dias_despues} día(s) después: de {kpis['cargadas']} ventas cargadas ese día ya "
            f"son netas {kpis['netas']} ({kpis['pct_activadas'] or 0:.0f}%). Las netas de un día se siguen activando hasta "
            "dos semanas después: recalculá el SPH con un corte de ventas posterior para completarlo."
        )
    for nombre, f in (("Productividad", fuentes.get("productividad")), ("Ventas Netas", fuentes.get("ventas"))):
        if f and f.get("status") != "published":
            avisos.append(f"Se calculó con el borrador de {nombre} (no está publicado).")
    if kpis["sesiones_abiertas"]:
        avisos.append(
            f"{kpis['sesiones_abiertas']} agente(s) con sesión abierta: sus horas no son reales y quedan fuera del SPH"
            + (f", junto con sus {netas_abiertas} neta(s)." if netas_abiertas else ".")
        )
    if kpis["netas_sin_agente"]:
        avisos.append(
            f"{kpis['netas_sin_agente']} neta(s) del día son de vendedores que no se vincularon con un agente conectado: "
            "cuentan en el SPH de la operación, no en el de los asesores. Si es un nombre distinto, vinculalo a mano."
        )
    if sin_fecha:
        avisos.append(f"{sin_fecha} neta(s) del mes no traen fecha de venta ni de carga: no se pueden ubicar en un día.")

    return {
        "version": VERSION_SPH,
        "fecha": dia,
        "fuentes": {**fuentes, "dias_despues": dias_despues},
        "parametros": {"min_horas_ranking": min_horas_ranking, "dias_maduracion": DIAS_MADURACION},
        "kpis": kpis,
        "agentes": filas,
        "ventas_sin_agente": sin_agente,
        "por_subcanal": por_subcanal,
        "vendedores": sorted(({"vendedor": v, "subcanal": subcanal.get(v), "netas_mes": netas_mes_v.get(v, 0)}
                              for v in roster), key=lambda x: x["vendedor"]),
        "avisos": avisos,
    }


def resumen_lista(data: dict[str, Any]) -> dict[str, Any]:
    """Columnas desnormalizadas del informe (para listar sin abrir el JSON)."""
    k = data["kpis"]
    return {"sph": k["sph"], "netas": k["netas"], "horas": round(k["horas"] / 3600, 2), "agentes": k["agentes"],
            "vinculados": k["vinculados"], "pct_cobertura": k["pct_cobertura"], "pct_activadas": k["pct_activadas"]}
