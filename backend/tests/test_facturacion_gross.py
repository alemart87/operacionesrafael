"""Desc Gross / Netas / %Gross (criterio Claro) sobre una liquidación sintética."""
from app.operativas.televentas_claro.facturacion.analyzers.analisis import analyze_facturacion
from app.operativas.televentas_claro.facturacion.analyzers.compare import compare_facturacion
from app.operativas.televentas_claro.facturacion.parser import parse_facturacion

HEADER = ";".join([
    "NroLiquidacion", "Cabecera", "NroEntidad", "DescripEntidad", "Concepto", "DescripConcepto", "NroCelularGestion",
    "NroCuentaGestion", "CategoriaCliente", "SegmentoCliente", "NroSerieSimGestion", "FormaVentaActi", "FormaPago",
    "FechaPreActivacion", "FechaActivacion", "FechaGestion", "FechaFinChargeback", "Importe", "MontoInformativo",
    "Cuota", "Observaciones", "PromocionActivacion", "CampaniaActivacion", "RegionGestion", "CategoriaPlanActiv", "RatePlanActi",
])


def _fila(concepto: str, desc: str, linea: str, fa: str, fg: str, importe: str, cuota: str, obs: str, plan: str = "CG15G") -> str:
    p = ["390", "1", "300383", "VOICENTER S.A.", concepto, desc, linea, "1", "M", "CO", "1", "PROP", "B",
         fa, fa, fg, "", importe, "0", cuota, obs, "722", "722TLK", "PY", "ZZ", plan]
    return ";".join(p)


def _archivo(tmp_path):
    filas = [HEADER]
    # 10 activaciones en junio
    for i in range(10):
        filas.append(_fila("1", "ACTIVACIONES", f"99000000{i}", "10/06/2026 10:00:00", "10/06/2026 10:00:00", "204545", "1",
                           "Negocio: CR - Plan: CG15G - Portacion: NO"))
    # Bajas del mes: 3 por PFI (ventas de abril), 1 por falta de pago (venta de marzo), 2 port out (no cuentan)
    for i in range(3):
        filas.append(_fila("5", "CANCELACIONES", f"98100000{i}", "05/04/2026 09:00:00", "12/06/2026 01:00:00", "0", "0",
                           "CANCELACION. Razón: P9-735 - Primer factura Impaga  - Activación"))
    # la misma línea PFI aparece dos veces (dos filas): cuenta una sola vez
    filas.append(_fila("5", "CANCELACIONES", "981000000", "05/04/2026 09:00:00", "12/06/2026 01:00:00", "0", "0",
                       "CANCELACION. Razón: P9-735 - Primer factura Impaga  - Activación"))
    filas.append(_fila("5", "CANCELACIONES", "982000000", "20/03/2026 09:00:00", "03/06/2026 01:00:00", "0", "0",
                       "CANCELACION. Raz n: P7 - Falta de Pago"))
    for i in range(2):
        filas.append(_fila("5", "CANCELACIONES", f"98300000{i}", "01/12/2025 09:00:00", "02/06/2026 01:00:00", "0", "0",
                           "CANCELACION POR PORT OUT. Raz n: PNPOUT - Portabilidad Numérica Port Out"))
    path = tmp_path / "liq.txt"
    path.write_text("\n".join(filas) + "\n", encoding="cp1252")
    return str(path)


def test_gross_netas_pct(tmp_path):
    parsed = parse_facturacion(_archivo(tmp_path))
    g = parsed["gross"]
    assert g["activaciones"] == 10
    assert g["cancelaciones"] == 6          # 3 PFI (una repetida) + 1 P7 + 2 port out
    assert g["port_out"] == 2
    assert g["desc_gross"] == 4             # sin port out
    assert g["pfi"] == 3
    assert g["netas"] == 6
    assert g["pct_gross"] == 40.0
    assert {e["meses"]: e["lineas"] for e in g["por_edad"]} == {2: 3, 3: 1}
    assert {c["mes"]: c["lineas"] for c in g["por_cohorte"]} == {"2026-04": 3, "2026-03": 1}
    razones = {r["razon"]: r for r in g["por_razon"]}
    assert razones["PNPOUT"]["cuenta"] is False and razones["P9-735"]["cuenta"] is True


def test_gross_en_analisis_y_compare(tmp_path):
    data = analyze_facturacion(parse_facturacion(_archivo(tmp_path)))
    assert data["kpis"]["desc_gross"] == 4 and data["kpis"]["netas"] == 6 and data["kpis"]["pct_gross"] == 40.0
    assert any("Gross (criterio Claro)" in a for a in data["analisis_rapido"])
    viejo = {"id": "a", "title": "may", "periodo": "2026-05", "data": {"conceptos": [], "kpis": {"total": 1, "ventas_activaciones": 9}}}
    nuevo = {"id": "b", "title": "jun", "periodo": "2026-06", "data": data}
    cmp_ = compare_facturacion([viejo, nuevo])
    assert cmp_["gross"]["disponible"] is True
    assert cmp_["gross"]["desc_gross"] == [None, 4]
    assert cmp_["gross"]["pct_gross"] == [None, 40.0]
