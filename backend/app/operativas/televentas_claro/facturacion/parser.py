"""Parser de archivos de liquidación de comisiones — Televentas Claro Fijo PGY.

Archivo: .txt delimitado por `;`, encoding cp1252, ~48 columnas.
- `Importe` (col 17) usa PUNTO como separador decimal (formato US): float() directo.
- Hay `;` embebidos en campos de texto posteriores a `Importe`; las columnas clave
  (0..20) se extraen por índice, sin romper.

Devuelve AGREGADOS (no filas crudas): se ejecuta en subproceso aislado y el
resultado debe ser pequeño. Todas las descripciones de concepto se incluyen.
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

# Índices de columna (estables en el layout del archivo)
_COL_LIQUIDACION = 0
_COL_DESCRIPCONCEPTO = 5
_COL_FECHA_ACTIVACION = 14
_COL_IMPORTE = 17
_COL_CUOTA = 19
_COL_OBS = 20
_COL_RATE_PLAN = 25  # RatePlanActi (código de plan de activación)

_DESC_ACTIVACIONES = "ACTIVACIONES"
_DESC_SUSPENSIONES = "SUSPENSIONES"
_DESC_DOC_FALTANTE = "LINEA CON DOCUMENTACION FALTANTE"
_DESC_CANCELACIONES = "CANCELACIONES"
# Conceptos que representan "mala calidad" de la venta (penalidades imputables a la línea).
_PENALIDADES_CALIDAD = {_DESC_SUSPENSIONES, _DESC_DOC_FALTANTE, _DESC_CANCELACIONES}

_COL_LINEA = 6            # NroCelularGestion
_COL_FECHA_GESTION = 15   # fecha del evento (cancelación, suspensión…)

_MAX_ROWS = 500_000  # guarda de seguridad

# Razones de cancelación (columna Observaciones: "... Razón: P9-735 - Primer factura Impaga").
_RAZON_RE = re.compile(r"Raz.{1,2}n:\s*([A-Z0-9\-]+)")
_RAZON_PFI = "P9-735"
_RAZON_PORT_OUT = "PNPOUT"
_RAZON_TXT = {
    "P9-735": "Primera factura impaga (PFI)", "P7": "Falta de pago", "P9-722": "Contratación dudosa",
    "P9-723": "Contratación dudosa", "P9-787": "Usurpación de identidad", "PNPOUT": "Port out",
    "A7": "Cancelación presuspendida", "A1": "Cancelación administrativa", "COMPET": "Competencia",
    "FALLEC": "Fallecimiento", "PROCOS": "Problema de costos",
}


def _razon(obs: str) -> str:
    o = obs.strip().strip('"')
    m = _RAZON_RE.search(o)
    if m:
        return m.group(1)
    if "PORT OUT" in o.upper():
        return _RAZON_PORT_OUT
    return "(sin razón)"


def _meses_entre(fa: str, fg: str) -> int | None:
    """Antigüedad de la línea al momento del evento, en meses calendario."""
    a, g = _year_month(fa), _year_month(fg)
    if not a or not g:
        return None
    return (int(g[:4]) * 12 + int(g[5:7])) - (int(a[:4]) * 12 + int(a[5:7]))


def _gross(activaciones: int, canc: dict[str, tuple[str, int | None, str | None]]) -> dict[str, Any]:
    """Desc Gross y Netas con el criterio de Claro (gráficos "Ventas Móv / Netas Móv / %Gross/Vta").

    Desc Gross = líneas dadas de baja EN EL MES (concepto CANCELACIONES, una vez por línea), de
    cualquier cohorte, por razón de Claro (PFI, falta de pago, fraude…), sin los port out.
    Netas = activaciones del mes − Desc Gross. %Gross/Vta = Desc Gross ÷ activaciones.
    Es un dato de caja del mes: ~85% de las bajas son ventas de 1 a 3 meses antes.
    """
    por_razon: dict[str, int] = defaultdict(int)
    por_edad: dict[int, int] = defaultdict(int)
    por_cohorte: dict[str, int] = defaultdict(int)
    port_out = 0
    desc_gross = 0
    for _lin, (razon, edad, cohorte) in canc.items():
        por_razon[razon] += 1
        if razon == _RAZON_PORT_OUT:
            port_out += 1
            continue
        desc_gross += 1
        if edad is not None:
            por_edad[max(edad, 0)] += 1
        if cohorte:
            por_cohorte[cohorte] += 1
    netas = activaciones - desc_gross
    return {
        "activaciones": activaciones,
        "cancelaciones": len(canc),
        "port_out": port_out,
        "desc_gross": desc_gross,
        "pfi": por_razon.get(_RAZON_PFI, 0),
        "netas": netas,
        "pct_gross": round(desc_gross / activaciones * 100, 1) if activaciones else 0.0,
        "por_razon": [
            {"razon": r, "texto": _RAZON_TXT.get(r, r), "lineas": n, "cuenta": r != _RAZON_PORT_OUT}
            for r, n in sorted(por_razon.items(), key=lambda kv: -kv[1])
        ],
        "por_edad": [{"meses": e, "lineas": n} for e, n in sorted(por_edad.items())],
        "por_cohorte": [{"mes": c, "lineas": n} for c, n in sorted(por_cohorte.items())],
    }


def _to_float(raw: str) -> float:
    raw = raw.strip().strip('"')
    if not raw:
        return 0.0
    try:
        return float(raw)  # punto = decimal
    except ValueError:
        try:
            return float(raw.replace(".", "").replace(",", "."))
        except ValueError:
            return 0.0


def _year_month(fecha: str) -> str | None:
    """`dd/mm/yyyy hh:mm` -> `yyyy-mm`."""
    fecha = fecha.strip()
    if len(fecha) >= 10 and fecha[2] == "/" and fecha[5] == "/":
        return f"{fecha[6:10]}-{fecha[3:5]}"
    return None


def _fecha_key(fecha: str) -> str:
    """`dd/mm/yyyy` -> `yyyy-mm-dd` (clave ordenable)."""
    f = fecha.strip()
    if len(f) >= 10 and f[2] == "/" and f[5] == "/":
        return f"{f[6:10]}-{f[3:5]}-{f[0:2]}"
    return f


def _motivo_doc(obs: str) -> str:
    o = obs.strip().strip('"').upper()
    if not o:
        return "(sin dato)"
    if "NO PRESENTADO" in o:
        return "Legajo no presentado"
    if "INCOMPLETO" in o or "OBSERVADO" in o:
        return "Legajo incompleto u observado"
    if "RECHAZ" in o:
        return "Legajo rechazado"
    return obs.strip().strip('"')[:80]


def _top(d: dict[str, list], total_monto: float, limit: int = 12) -> list[dict[str, Any]]:
    out = []
    for mes in sorted(d.keys(), key=lambda k: abs(d[k][1]), reverse=True)[:limit]:
        reg, monto = d[mes]
        out.append({
            "mes": mes,
            "registros": reg,
            "monto": round(monto, 2),
            "pct": round(monto / total_monto * 100, 1) if total_monto else 0.0,
        })
    return out


def parse_facturacion(path: str) -> dict[str, Any]:
    """Parsea una liquidación y devuelve agregados por concepto + cohortes clave."""
    conceptos: dict[str, list] = defaultdict(lambda: [0, 0.0])  # desc -> [registros, importe]
    liquidacion = None
    total_rows = 0

    ventas_por_mes: dict[str, list] = defaultdict(lambda: [0, 0.0])
    ventas_n = 0
    ventas_monto = 0.0
    mes_counter: dict[str, int] = defaultdict(int)  # para período dominante

    susp_por_mes: dict[str, list] = defaultdict(lambda: [0, 0.0])
    susp_n = 0
    susp_monto = 0.0

    doc_por_mes: dict[str, list] = defaultdict(lambda: [0, 0.0])
    doc_por_motivo: dict[str, list] = defaultdict(lambda: [0, 0.0])
    doc_n = 0
    doc_monto = 0.0

    plan_mix: dict[str, list] = defaultdict(lambda: [0, 0.0])     # plan -> [activaciones, prima upfront]
    ventas_por_dia: dict[str, list] = defaultdict(lambda: [0, 0.0])   # fecha venta -> [activaciones, prima]
    susp_por_dia: dict[str, list] = defaultdict(lambda: [0, 0.0])     # fecha venta -> [susp, monto]
    penal_por_dia: dict[str, list] = defaultdict(lambda: [0, 0.0])    # fecha venta -> [penalidades, monto] (calidad)
    canc_lineas: dict[str, tuple[str, int | None, str | None]] = {}   # línea -> (razón, edad meses, cohorte) · Desc Gross

    with open(path, encoding="cp1252", errors="replace") as fh:
        header = fh.readline()  # descartar cabecera
        if ";" not in header:
            raise ValueError("El archivo no parece tener el formato esperado (sin ';' en la cabecera).")
        for line in fh:
            parts = line.rstrip("\n").split(";")
            if len(parts) < 18:
                continue
            total_rows += 1
            if total_rows > _MAX_ROWS:
                raise ValueError("El archivo supera el máximo de filas admitido.")

            if liquidacion is None:
                liquidacion = parts[_COL_LIQUIDACION].strip()
            desc = parts[_COL_DESCRIPCONCEPTO].strip()
            importe = _to_float(parts[_COL_IMPORTE])
            conceptos[desc][0] += 1
            conceptos[desc][1] += importe

            cuota = parts[_COL_CUOTA].strip() if len(parts) > _COL_CUOTA else ""
            fa = parts[_COL_FECHA_ACTIVACION].strip() if len(parts) > _COL_FECHA_ACTIVACION else ""
            ym = _year_month(fa)
            dia = fa[:10] if len(fa) >= 10 else None  # 'dd/mm/yyyy'

            if desc == _DESC_ACTIVACIONES and cuota == "1":
                ventas_n += 1
                ventas_monto += importe
                if ym:
                    ventas_por_mes[ym][0] += 1
                    ventas_por_mes[ym][1] += importe
                    mes_counter[ym] += 1
                if dia:
                    ventas_por_dia[dia][0] += 1
                    ventas_por_dia[dia][1] += importe
                plan = (parts[_COL_RATE_PLAN].strip() if len(parts) > _COL_RATE_PLAN else "") or "(sin plan)"
                plan_mix[plan][0] += 1
                plan_mix[plan][1] += importe

            if desc == _DESC_SUSPENSIONES and importe < 0:
                susp_n += 1
                susp_monto += importe
                if ym:
                    susp_por_mes[ym][0] += 1
                    susp_por_mes[ym][1] += importe
                if dia:
                    susp_por_dia[dia][0] += 1
                    susp_por_dia[dia][1] += importe

            if desc == _DESC_DOC_FALTANTE:
                doc_n += 1
                doc_monto += importe
                if ym:
                    doc_por_mes[ym][0] += 1
                    doc_por_mes[ym][1] += importe
                motivo = _motivo_doc(parts[_COL_OBS]) if len(parts) > _COL_OBS else "(sin dato)"
                doc_por_motivo[motivo][0] += 1
                doc_por_motivo[motivo][1] += importe

            if desc == _DESC_CANCELACIONES:
                lin = parts[_COL_LINEA].strip() if len(parts) > _COL_LINEA else ""
                if lin and lin not in canc_lineas:
                    fg = parts[_COL_FECHA_GESTION].strip() if len(parts) > _COL_FECHA_GESTION else ""
                    obs = parts[_COL_OBS] if len(parts) > _COL_OBS else ""
                    canc_lineas[lin] = (_razon(obs), _meses_entre(fa, fg), ym)

            # Penalidades de calidad (suspensiones, documentación, cancelaciones) por fecha de
            # venta de la línea → insumo para el cruce de "calidad por fecha" entre liquidaciones.
            if dia and desc in _PENALIDADES_CALIDAD and (importe < 0 or desc == _DESC_DOC_FALTANTE):
                penal_por_dia[dia][0] += 1
                penal_por_dia[dia][1] += importe

    if total_rows == 0:
        raise ValueError("El archivo no contiene filas de datos.")

    # Concepto: todas las descripciones, ordenadas por |importe| desc
    conceptos_list = [
        {"descripcion": desc, "importe": round(v[1], 2), "registros": v[0]}
        for desc, v in conceptos.items()
    ]
    conceptos_list.sort(key=lambda c: abs(c["importe"]), reverse=True)

    total = round(sum(c["importe"] for c in conceptos_list), 2)
    creditos = round(sum(c["importe"] for c in conceptos_list if c["importe"] > 0), 2)
    debitos = round(sum(c["importe"] for c in conceptos_list if c["importe"] < 0), 2)

    periodo = max(mes_counter, key=mes_counter.get) if mes_counter else None

    doc_motivo_list = [
        {"motivo": m, "registros": v[0], "monto": round(v[1], 2)}
        for m, v in sorted(doc_por_motivo.items(), key=lambda kv: abs(kv[1][1]), reverse=True)
    ]

    # Mix de planes (por RatePlanActi de las activaciones)
    plan_mix_list = [
        {"plan": plan, "activaciones": v[0], "monto": round(v[1], 2),
         "ticket": round(v[1] / v[0], 2) if v[0] else 0.0}
        for plan, v in sorted(plan_mix.items(), key=lambda kv: -kv[1][0])
    ]

    # Suspensiones por DÍA de venta (curva diaria), ordenadas por fecha
    def _por_dia_sorted(d: dict[str, list]) -> list[dict[str, Any]]:
        return [{"fecha": k, "registros": v[0], "monto": round(v[1], 2)}
                for k, v in sorted(d.items(), key=lambda kv: _fecha_key(kv[0]))]

    return {
        "nro_liquidacion": liquidacion,
        "total_rows": total_rows,
        "periodo": periodo,
        "conceptos": conceptos_list,
        "total": total,
        "creditos": creditos,
        "debitos": debitos,
        "ventas": {
            "activaciones": ventas_n,
            "prima_upfront": round(ventas_monto, 2),
            "ticket": round(ventas_monto / ventas_n, 2) if ventas_n else 0.0,
            "por_mes_venta": _top(ventas_por_mes, ventas_monto),
            "por_dia": _por_dia_sorted(ventas_por_dia),
        },
        "suspensiones": {
            "registros": susp_n,
            "monto": round(susp_monto, 2),
            "por_mes_venta": _top(susp_por_mes, susp_monto),
            "por_dia": _por_dia_sorted(susp_por_dia),
        },
        "doc_faltante": {
            "registros": doc_n,
            "monto": round(doc_monto, 2),
            "promedio": round(doc_monto / doc_n, 2) if doc_n else 0.0,
            "por_mes_venta": _top(doc_por_mes, doc_monto),
            "por_motivo": doc_motivo_list,
        },
        "plan_mix": plan_mix_list,
        # Desc Gross / Netas / %Gross con el criterio de Claro (bajas del mes, sin port out).
        "gross": _gross(ventas_n, canc_lineas),
        # Insumo para "calidad por fecha de venta" (se cruza entre liquidaciones):
        "cohorte_calidad": {
            "ventas_por_dia": {k: [v[0], round(v[1], 2)] for k, v in ventas_por_dia.items()},
            "penal_por_dia": {k: [v[0], round(v[1], 2)] for k, v in penal_por_dia.items()},
        },
    }
