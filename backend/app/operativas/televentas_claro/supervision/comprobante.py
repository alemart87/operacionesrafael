"""Comprobante del coaching firmado (PDF A4 con la marca): lo que se trabajó, los compromisos del asesor, las firmas y
la huella de lo firmado. Usa las tipografías, colores y piezas del PDF del informe diario. Todo el texto del usuario
se escapa."""
from __future__ import annotations

import base64
import functools
import io
from datetime import date, datetime
from typing import Any

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from ..informe_diario.pdf import (
    _F, BORDE, FONDO, GRAFITO, LOGO, PIZARRA, ROJO, TA_RIGHT, TINTA, _cab, _e, _Lienzo, _limpio, _registrar, _seccion, _tabla,
)
from .alertas import ZONA
from .coaching import NOMBRE_ITEM, NOMBRE_METRICA

TIPO = {"diario": "Diario en puesto", "semanal": "Semanal uno a uno", "mensual": "Mensual de resultados"}
RESULTADO = {"cumplido": "Cumplido", "parcial": "Parcial", "no_cumplido": "No cumplido"}


def _local(iso: str | None) -> datetime | None:
    if not iso:
        return None
    d = datetime.fromisoformat(iso)
    return d.astimezone(ZONA)


def _dato(etiqueta: str, valor: str) -> Paragraph:
    return Paragraph(f'<font name="{_F["semi"]}" color="#5B6275" size="7">{_limpio(etiqueta).upper()}</font><br/>'
                     f'<font name="{_F["negrita"]}" size="10.5" color="#0F1116">{_limpio(valor)}</font>', _e("dato", leading=14))


def _imagen_firma(data_url: str | None) -> Any:
    if not (data_url or "").startswith("data:image/png;base64,"):
        return Spacer(1, 16 * mm)
    try:
        img = Image(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1])))
        escala = min(60 * mm / img.imageWidth, 22 * mm / img.imageHeight)
        img.drawWidth, img.drawHeight = img.imageWidth * escala, img.imageHeight * escala
        img.hAlign = "LEFT"
        return img
    except Exception:  # noqa: BLE001
        return Spacer(1, 16 * mm)


def generar(d: dict[str, Any]) -> bytes:
    """`d`: el detalle del coaching como lo devuelve la API (con ítems, compromisos y firmas)."""
    _registrar()
    buf = io.BytesIO()
    margen = 16 * mm
    ancho = A4[0] - 2 * margen
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=margen, rightMargin=margen, topMargin=14 * mm, bottomMargin=18 * mm,
                            title=f"Coaching {d['operador']} {d['fecha']}", author=str(d["supervisor"]),
                            subject="Constancia de devolución de coaching · Televentas Claro", creator="Operaciones Voicenter")
    logo = Image(str(LOGO), width=24 * mm, height=24 * mm * 328 / 520) if LOGO.exists() else Spacer(1, 1)
    titulo = Paragraph("CONSTANCIA DE COACHING", _e("t", fontName=_F["titulo"], fontSize=24, leading=26, textColor=TINTA, alignment=TA_RIGHT))
    sub = Paragraph("Televentas Claro · Devolución firmada por el asesor", _e("s", fontSize=8.5, textColor=PIZARRA, alignment=TA_RIGHT))
    cab = Table([[logo, [titulo, sub]]], colWidths=[40 * mm, ancho - 40 * mm])
    cab.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                             ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("LINEBELOW", (0, 0), (-1, 0), 1.6, ROJO),
                             ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    firmado = _local(d.get("firmado_at"))
    metricas = " + ".join(NOMBRE_METRICA.get(m, m) for m in d.get("metricas") or [])
    datos = Table([[_dato("Asesor", d["operador"]), _dato("Supervisor", d["supervisor"]),
                    _dato("Firmado", f"{firmado:%d/%m/%Y %H:%M}" if firmado else "Sin firmar")],
                   [_dato("Tipo", TIPO.get(d["tipo"], d["tipo"])), _dato("Métricas", metricas or "—"),
                    _dato("Seguimiento", date.fromisoformat(d["seguimiento_fecha"]).strftime("%d/%m/%Y"))]],
                  colWidths=[ancho * 0.36, ancho * 0.36, ancho * 0.28])
    datos.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 7),
                               ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story: list[Any] = [cab, datos, Spacer(1, 6 * mm), _seccion("Lo que se trabajó"), Spacer(1, 3 * mm)]

    filas = [[_cab("Tipo"), _cab("Hora"), _cab("Detalle")]]
    for i in d.get("items") or []:
        momento = _local(i.get("at"))
        mets = ", ".join(NOMBRE_METRICA.get(m, m) for m in i.get("metricas") or [])
        filas.append([Paragraph(_limpio(NOMBRE_ITEM.get(i["tipo"], i["tipo"])), _e("it", fontName=_F["semi"])),
                      Paragraph(f"{momento:%d/%m %H:%M}" if momento else "—", _e("ih", textColor=PIZARRA)),
                      Paragraph(_limpio(i["texto"]) + (f'<br/><font color="#5B6275" size="7.5">{_limpio(mets)}'
                                                       + (f" · ref. {_limpio(i['referencia'])}" if i.get("referencia") else "")
                                                       + (" · con audio" if i.get("audio_id") else "") + "</font>"), _e("id"))])
    story.append(_tabla(filas, [24 * mm, 22 * mm, ancho - 46 * mm], zebra=True))

    story += [Spacer(1, 6 * mm), _seccion("Compromisos del asesor"), Spacer(1, 3 * mm)]
    filas = [[_cab("#"), _cab("Compromiso"), _cab("Para"), _cab("Seguimiento")]]
    for k, x in enumerate(d.get("compromisos") or [], start=1):
        filas.append([Paragraph(str(k), _e("cn", fontName=_F["negrita"])),
                      Paragraph(_limpio(x["texto"]) + (' <font color="#5B6275" size="7.5">(dicho por el asesor)</font>'
                                                       if x.get("origen") == "asesor" else ""), _e("ct")),
                      Paragraph(date.fromisoformat(x["para"]).strftime("%d/%m") if x.get("para") else "—", _e("cp")),
                      Paragraph(_limpio(RESULTADO.get(x.get("resultado") or "", "Pendiente")), _e("cr", textColor=GRAFITO))])
    story.append(_tabla(filas, [8 * mm, ancho - 58 * mm, 20 * mm, 30 * mm], zebra=True))

    firmas = {f["firmante"]: f for f in d.get("firmas") or []}
    asesor = firmas.get("asesor")
    if asesor and asesor.get("comentario"):
        story += [Spacer(1, 5 * mm), Paragraph(f'<font name="{_F["semi"]}">Comentario del asesor:</font> {_limpio(asesor["comentario"])}', _e("com"))]

    def bloque(f: dict[str, Any] | None, rol: str) -> list[Any]:
        linea = Table([[""]], colWidths=[64 * mm], rowHeights=[1])
        linea.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, -1), 0.8, GRAFITO)]))
        linea.hAlign = "LEFT"
        nombre = f["nombre"] if f else "—"
        return [_imagen_firma(f.get("imagen") if f else None), linea,
                Paragraph(f'<font name="{_F["negrita"]}" size="10" color="#0F1116">{_limpio(nombre)}</font>', _e("fn", leading=13)),
                Paragraph(rol, _e("fr", textColor=PIZARRA))]

    caja = Table([[bloque(asesor, "Asesor · acepta sus compromisos"), bloque(firmas.get("supervisor"), "Supervisor")]],
                 colWidths=[ancho / 2, ancho / 2])
    caja.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("VALIGN", (0, 0), (-1, -1), "BOTTOM")]))
    verif = Table([[Paragraph(
        f"Firmado en el celular del supervisor el {firmado:%d/%m/%Y} a las {firmado:%H:%M} (hora de Asunción, la pone el servidor). "
        f'Huella SHA-256 de lo firmado: <font name="{_F["negrita"]}" color="#0F1116">{_limpio(d.get("huella") or "—")}</font>. '
        "Si se cambia algo de lo firmado, la huella deja de coincidir. Constancia interna: no reemplaza una firma digital certificada."
        if firmado else "Sin firmar.", _e("v", fontSize=7.6, leading=10.4, textColor=PIZARRA))]], colWidths=[ancho])
    verif.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), FONDO), ("BOX", (0, 0), (-1, -1), 0.5, BORDE),
                               ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                               ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story += [Spacer(1, 9 * mm), KeepTogether([_seccion("Firmas"), Spacer(1, 4 * mm), caja, Spacer(1, 5 * mm), verif])]
    pie = f"Operaciones Voicenter · Coaching a {d['operador']} · {date.fromisoformat(d['fecha']):%d/%m/%Y}"
    doc.build(story, canvasmaker=functools.partial(_Lienzo, pie=pie, borrador=not firmado))
    return buf.getvalue()
