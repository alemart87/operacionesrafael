"""PDF del informe diario (A4, con la marca): encabezado, resultados del día, datos importados, resumen, métricas
críticas con sus compromisos, seguimiento de los compromisos anteriores y la firma con su código de verificación.

Las tipografías (Manrope y Barlow Condensed, licencia OFL) y el logo están en `app/assets`. Todo el texto que
escribe el usuario se escapa (no se interpreta como marcado) y los caracteres que la tipografía no tiene se quitan.
"""
from __future__ import annotations

import base64
import functools
import io
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (
    Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

from .importar import dia_corto, num
from .informe import ZONA, utc

ASSETS = Path(__file__).resolve().parents[3] / "assets"
LOGO = ASSETS / "logo-voicenter.png"

ROJO = colors.HexColor("#E6332A")
ROJO_OSCURO = colors.HexColor("#B81F18")
ROJO_CLARO = colors.HexColor("#FDECEB")
NARANJA = colors.HexColor("#B86E00")
NARANJA_CLARO = colors.HexColor("#FEF3E2")
VERDE = colors.HexColor("#047857")
VERDE_CLARO = colors.HexColor("#ECFDF5")
TINTA = colors.HexColor("#0F1116")
GRAFITO = colors.HexColor("#2A2F3A")
PIZARRA = colors.HexColor("#5B6275")
NIEBLA = colors.HexColor("#9CA3AF")
BORDE = colors.HexColor("#E5E7EB")
FONDO = colors.HexColor("#F6F7FB")

DIAS_LARGOS = ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo")
ESTADO_METRICA = {"critico": ("CRÍTICA", ROJO_OSCURO, ROJO_CLARO), "atencion": ("ATENCIÓN", NARANJA, NARANJA_CLARO),
                  "ok": ("EN ORDEN", VERDE, VERDE_CLARO)}
ESTADO_SEGUIMIENTO = {"cumplido": ("Cumplido", VERDE), "en_curso": ("En curso", NARANJA), "no_cumplido": ("No cumplido", ROJO_OSCURO)}
TONO = {"malo": ROJO_OSCURO, "atencion": NARANJA, "bueno": VERDE, "neutro": TINTA}

# ------------------------------------------------------------------ tipografías
_F = {"texto": "Helvetica", "semi": "Helvetica-Bold", "negrita": "Helvetica-Bold", "titulo": "Helvetica-Bold", "titulo_semi": "Helvetica-Bold"}
_GLIFOS: set[int] | None = None


def _registrar() -> None:
    global _GLIFOS
    if _GLIFOS is not None:
        return
    d = ASSETS / "fonts"
    try:
        for nombre, archivo in (("Manrope", "Manrope-Regular"), ("Manrope-SemiBold", "Manrope-SemiBold"),
                                ("Manrope-Bold", "Manrope-Bold"), ("Barlow-Bold", "BarlowCondensed-Bold"),
                                ("Barlow-SemiBold", "BarlowCondensed-SemiBold")):
            if nombre not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(nombre, str(d / f"{archivo}.ttf")))
        _F.update(texto="Manrope", semi="Manrope-SemiBold", negrita="Manrope-Bold", titulo="Barlow-Bold", titulo_semi="Barlow-SemiBold")
        _GLIFOS = set(pdfmetrics.getFont("Manrope").face.charToGlyph)
    except Exception:  # noqa: BLE001 — sin las tipografías, Helvetica (solo Latin-1)
        _GLIFOS = set(range(32, 256))


def _limpio(s: Any) -> str:
    """Escapa el texto del usuario y quita lo que la tipografía no puede dibujar (emojis, flechas…)."""
    texto = str(s or "").replace("→", "—").replace("✓", "OK").replace("\t", " ")
    limpio = "".join(c for c in texto if c == "\n" or ord(c) in (_GLIFOS or set()))
    if limpio != texto:   # lo que se quitó no deja espacios de más
        limpio = re.sub(r" ([.,;:!?])", r"\1", re.sub(r" {2,}", " ", limpio))
    return escape(limpio).replace("\n", "<br/>")


def _hex(c: Any) -> str:
    return "#" + c.hexval()[2:]


def _e(nombre: str, **kw: Any) -> ParagraphStyle:
    base = {"fontName": _F["texto"], "fontSize": 9, "leading": 12.5, "textColor": GRAFITO}
    return ParagraphStyle(nombre, **{**base, **kw})


# ------------------------------------------------------------------ página: pie, número y marca de agua
class _Lienzo(rl_canvas.Canvas):
    def __init__(self, *a: Any, pie: str = "", borrador: bool = False, **k: Any):
        super().__init__(*a, **k)
        self._paginas: list[dict[str, Any]] = []
        self._pie, self._borrador = pie, borrador

    def showPage(self) -> None:  # noqa: N802 (API de reportlab)
        self._paginas.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        total = len(self._paginas)
        for estado in self._paginas:
            self.__dict__.update(estado)
            self._decorar(total)
            super().showPage()
        super().save()

    def _decorar(self, total: int) -> None:
        ancho, alto = A4
        self.saveState()
        self.setStrokeColor(BORDE)
        self.setLineWidth(0.6)
        self.line(16 * mm, 13 * mm, ancho - 16 * mm, 13 * mm)
        self.setFont(_F["texto"], 7.5)
        self.setFillColor(PIZARRA)
        self.drawString(16 * mm, 8.5 * mm, self._pie)
        self.drawRightString(ancho - 16 * mm, 8.5 * mm, f"Página {self._pageNumber} de {total}")
        if self._borrador:
            self.setFillColor(ROJO)
            self.setFillAlpha(0.07)
            self.setFont(_F["titulo"], 110)
            self.translate(ancho / 2, alto / 2)
            self.rotate(35)
            self.drawCentredString(0, -30, "BORRADOR")
        self.restoreState()


# ------------------------------------------------------------------ piezas
def _seccion(titulo: str) -> Table:
    t = Table([["", Paragraph(escape(titulo).upper(), _e("sec", fontName=_F["titulo"], fontSize=13.5, leading=16, textColor=TINTA))]],
              colWidths=[2.2 * mm, None])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, 0), ROJO), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("LEFTPADDING", (1, 0), (1, 0), 6), ("TOPPADDING", (0, 0), (-1, -1), 1),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 1), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    return t


def _tabla(filas: list[list[Any]], anchos: list[float], *, cabecera: bool = True, zebra: bool = False) -> Table:
    t = Table(filas, colWidths=anchos, repeatRows=1 if cabecera else 0)
    estilo = [("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
              ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
              ("LINEBELOW", (0, 0), (-1, -1), 0.5, BORDE), ("BOX", (0, 0), (-1, -1), 0.6, BORDE)]
    if cabecera:
        estilo += [("BACKGROUND", (0, 0), (-1, 0), FONDO)]
    if zebra:
        estilo += [("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FBFBFD")])]
    t.setStyle(TableStyle(estilo))
    return t


def _cab(texto: str, derecha: bool = False) -> Paragraph:
    return Paragraph(escape(texto).upper(), _e("cab", fontName=_F["semi"], fontSize=6.8, leading=8.5, textColor=PIZARRA,
                                                 alignment=TA_RIGHT if derecha else 0))


def _fecha_larga(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{DIAS_LARGOS[d.weekday()]} {d:%d/%m/%Y}"


def _valor(v: Any) -> str:
    if v is None or v == "":
        return "—"
    v = float(v)
    return num(v, 0 if v.is_integer() else 2)


def _cumplimiento(valor: Any, meta: Any) -> tuple[str, Any]:
    if valor is None or not meta:
        return "—", PIZARRA
    p = float(valor) / float(meta) * 100
    color = VERDE if p >= 100 else NARANJA if p >= 80 else ROJO_OSCURO
    return f"{num(p, 0)}%", color


# ------------------------------------------------------------------ secciones
def _encabezado(d: dict[str, Any], ancho: float) -> list[Any]:
    logo = Image(str(LOGO), width=24 * mm, height=24 * mm * 328 / 520) if LOGO.exists() else Spacer(1, 1)
    titulo = Paragraph("INFORME DIARIO", _e("t", fontName=_F["titulo"], fontSize=26, leading=27, textColor=TINTA, alignment=TA_RIGHT))
    sub = Paragraph("Televentas Claro · Gerencia Expansión RM", _e("s", fontSize=8.5, textColor=PIZARRA, alignment=TA_RIGHT))
    t = Table([[logo, [titulo, sub]]], colWidths=[40 * mm, ancho - 40 * mm])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("LINEBELOW", (0, 0), (-1, 0), 1.6, ROJO),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    firmado = d["estado"] == "firmado"
    estado = '<font color="#047857">Firmado</font>' if firmado else '<font color="#B81F18">Borrador · sin firmar</font>'
    datos = [[Paragraph(f'<font name="{_F["semi"]}" color="#5B6275" size="7">FECHA</font><br/>'
                        f'<font name="{_F["negrita"]}" size="11" color="#0F1116">{_fecha_larga(d["fecha"]).capitalize()}</font>', _e("m")),
              Paragraph(f'<font name="{_F["semi"]}" color="#5B6275" size="7">PREPARADO POR</font><br/>'
                        f'<font name="{_F["negrita"]}" size="11" color="#0F1116">{_limpio(d["autor"])}</font> '
                        f'<font color="#5B6275">· {_limpio(d.get("cargo"))}</font>', _e("m")),
              Paragraph(f'<font name="{_F["semi"]}" color="#5B6275" size="7">ESTADO</font><br/>'
                        f'<font name="{_F["negrita"]}" size="11">{estado}</font>', _e("m"))]]
    m = Table(datos, colWidths=[ancho * 0.32, ancho * 0.46, ancho * 0.22])
    m.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 8),
                           ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    return [t, m, Spacer(1, 4 * mm)]


def _resultados(d: dict[str, Any], ancho: float) -> list[Any]:
    r = d.get("resultados") or {}
    ant = r.get("anterior") or {}
    filas = [[_cab("Resultado"), _cab("Del día", True), _cab("Meta", True), _cab("Cumplimiento", True),
              _cab("Día anterior", True), _cab("Comentario")]]
    grande = _e("v", fontName=_F["negrita"], fontSize=12.5, leading=15, textColor=TINTA, alignment=TA_RIGHT)
    der = _e("d", alignment=TA_RIGHT)
    items = [("Pospago", r.get("pospago") or {}, ant.get("pospago")), ("GPON", r.get("gpon") or {}, ant.get("gpon"))]
    items += [(o.get("nombre") or "Otro", o, None) for o in r.get("otros") or []]
    for nombre, x, previo in items:
        pct, color = _cumplimiento(x.get("valor"), x.get("meta"))
        filas.append([Paragraph(_limpio(nombre), _e("n", fontName=_F["negrita"], textColor=TINTA)),
                      Paragraph(_valor(x.get("valor")), grande), Paragraph(_valor(x.get("meta")), der),
                      Paragraph(f'<font name="{_F["negrita"]}" color="{_hex(color)}">{pct}</font>', der),
                      Paragraph(_valor(previo) if previo is not None else "—", der),
                      Paragraph(_limpio(x.get("comentario")) or '<font color="#9CA3AF">—</font>', _e("c", fontSize=8.5, leading=11.5))])
    out: list[Any] = [_seccion("Resultados del día"), Spacer(1, 2.5 * mm),
                      _tabla(filas, [ancho * 0.18, ancho * 0.12, ancho * 0.1, ancho * 0.14, ancho * 0.12, ancho * 0.34])]
    notas = []
    if r.get("fuente"):
        notas.append(f"Valores tomados de: {_limpio(r['fuente'])}.")
    if ant.get("fecha"):
        notas.append(f"Día anterior: informe del {dia_corto(date.fromisoformat(ant['fecha']))}.")
    if notas:
        out += [Spacer(1, 1.5 * mm), Paragraph(" ".join(notas), _e("nota", fontSize=7.5, leading=10, textColor=PIZARRA))]
    return out


def _importados(d: dict[str, Any], ancho: float) -> list[Any]:
    imps = d.get("importados") or []
    if not imps:
        return []
    out: list[Any] = [Spacer(1, 6 * mm), _seccion("Datos importados de la plataforma"), Spacer(1, 2.5 * mm)]
    for x in imps:
        cab = (f'<font name="{_F["negrita"]}" size="10.5" color="#0F1116">{_limpio(x.get("titulo"))}</font>'
               f'<font color="#5B6275"> · {_limpio(x.get("subtitulo"))}</font>')
        if x.get("estado") == "borrador":
            cab += ' <font color="#B86E00" name="' + _F["semi"] + '">(borrador)</font>'
        bloque: list[Any] = [Paragraph(cab, _e("ic", leading=14))]
        if x.get("aviso"):
            bloque.append(Paragraph(_limpio(x["aviso"]), _e("av", fontSize=7.5, leading=10, textColor=NARANJA)))
        kpis = x.get("kpis") or []
        celdas = []
        for k in kpis:
            color = _hex(TONO.get(k.get("tono") or "neutro", TINTA))
            celdas.append(Paragraph(
                f'<font name="{_F["semi"]}" size="6.8" color="#5B6275">{escape(str(k.get("label") or "")).upper()}</font><br/>'
                f'<font name="{_F["negrita"]}" size="12" color="{color}">{_limpio(k.get("valor"))}</font>'
                + (f'<br/><font size="7.2" color="#5B6275">{_limpio(k.get("detalle"))}</font>' if k.get("detalle") else ""),
                _e("k", leading=13)))
        por_fila = 4
        grilla = [celdas[i:i + por_fila] + [""] * (por_fila - len(celdas[i:i + por_fila])) for i in range(0, len(celdas), por_fila)]
        if grilla:
            g = Table(grilla, colWidths=[ancho / por_fila] * por_fila)
            g.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 6),
                                   ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                                   ("BOX", (0, 0), (-1, -1), 0.6, BORDE), ("INNERGRID", (0, 0), (-1, -1), 0.4, BORDE),
                                   ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FCFCFE"))]))
            bloque += [Spacer(1, 1.5 * mm), g]
        f = x.get("filas") or {}
        if f.get("filas"):
            cols = f.get("columnas") or []
            filas = [[_cab(c, i > 0) for i, c in enumerate(cols)]]
            for fila in f["filas"]:
                filas.append([Paragraph(_limpio(v), _e("tf", fontSize=8, leading=10.5, alignment=TA_RIGHT if i else 0))
                              for i, v in enumerate(fila)])
            primera = ancho * 0.32
            resto = (ancho - primera) / max(len(cols) - 1, 1)
            bloque += [Spacer(1, 1.5 * mm), _tabla(filas, [primera] + [resto] * (len(cols) - 1), zebra=True)]
        out += [KeepTogether(bloque), Spacer(1, 4 * mm)]
    return out


def _resumen(d: dict[str, Any]) -> list[Any]:
    return [Spacer(1, 4 * mm), _seccion("Resumen del día"), Spacer(1, 2.5 * mm),
            Paragraph(_limpio(d.get("resumen")) or '<font color="#9CA3AF">Sin resumen.</font>', _e("r", fontSize=9.5, leading=14))]


def _metricas(d: dict[str, Any], ancho: float) -> list[Any]:
    ms = d.get("metricas") or []
    if not ms:
        return []
    filas = [[_cab("Métrica"), _cab("Indicador"), _cab("Comentario"), _cab("Compromiso o anotación")]]
    for m in ms:
        etiqueta, color, fondo = ESTADO_METRICA.get(m.get("estado") or "critico", ESTADO_METRICA["critico"])
        nombre = Paragraph(f'<font name="{_F["negrita"]}" color="#0F1116">{_limpio(m.get("nombre"))}</font><br/>'
                           f'<font name="{_F["semi"]}" size="6.8" color="{_hex(color)}">{etiqueta}</font>', _e("mn"))
        ind = (f'<font name="{_F["negrita"]}" size="11.5" color="#0F1116">{_limpio(m.get("indicador")) or "—"}</font>'
               + (f'<br/><font size="7.2" color="#5B6275">antes: {_limpio(m.get("anterior"))}</font>' if m.get("anterior") else ""))
        comp = _limpio(m.get("compromiso"))
        extra = []
        if m.get("responsable"):
            extra.append(f"Responsable: {_limpio(m['responsable'])}")
        if m.get("fecha_compromiso"):
            extra.append(f"Para el {dia_corto(date.fromisoformat(m['fecha_compromiso']))}")
        if extra:
            comp += f'<br/><font size="7.2" color="#5B6275">{" · ".join(extra)}</font>'
        filas.append([nombre, Paragraph(ind, _e("mi", leading=14)),
                      Paragraph(_limpio(m.get("comentario")) or '<font color="#9CA3AF">—</font>', _e("mc", fontSize=8.5, leading=11.5)),
                      Paragraph(comp or '<font color="#9CA3AF">—</font>', _e("mk", fontSize=8.5, leading=11.5))])
    t = _tabla(filas, [ancho * 0.22, ancho * 0.18, ancho * 0.30, ancho * 0.30])
    estilo = []
    for i, m in enumerate(ms, start=1):
        _, color, _f = ESTADO_METRICA.get(m.get("estado") or "critico", ESTADO_METRICA["critico"])
        estilo.append(("LINEBEFORE", (0, i), (0, i), 2.4, color))
    t.setStyle(TableStyle(estilo))
    return [Spacer(1, 6 * mm), _seccion("Métricas críticas"), Spacer(1, 2.5 * mm), t]


def _seguimiento(d: dict[str, Any], ancho: float) -> list[Any]:
    ss = d.get("seguimiento") or []
    if not ss:
        return []
    filas = [[_cab("Compromiso"), _cab("Estado"), _cab("Nota")]]
    for s in ss:
        etiqueta, color = ESTADO_SEGUIMIENTO.get(s.get("estado"), ("—", PIZARRA))
        desde = f'Del {dia_corto(date.fromisoformat(s["desde"]))}' if s.get("desde") else ""
        filas.append([
            Paragraph(f'<font name="{_F["semi"]}" color="#0F1116">{_limpio(s.get("metrica"))}</font>'
                      f'<font size="7.2" color="#5B6275"> · {desde}</font><br/>{_limpio(s.get("texto"))}', _e("sc", fontSize=8.5, leading=11.5)),
            Paragraph(f'<font name="{_F["negrita"]}" color="{_hex(color)}">{etiqueta}</font>', _e("se")),
            Paragraph(_limpio(s.get("nota")) or '<font color="#9CA3AF">—</font>', _e("sn", fontSize=8.5, leading=11.5)),
        ])
    return [Spacer(1, 6 * mm), _seccion("Seguimiento de compromisos anteriores"), Spacer(1, 2.5 * mm),
            _tabla(filas, [ancho * 0.46, ancho * 0.14, ancho * 0.40])]


def _firma(d: dict[str, Any], ancho: float) -> list[Any]:
    f = d.get("firma") or {}
    firmado = d["estado"] == "firmado"
    contenido: list[Any] = []
    if firmado and (f.get("imagen") or "").startswith("data:image/png;base64,"):
        try:
            crudo = base64.b64decode(f["imagen"].split(",", 1)[1])
            img = Image(io.BytesIO(crudo))
            escala = min(62 * mm / img.imageWidth, 22 * mm / img.imageHeight)
            img.drawWidth, img.drawHeight = img.imageWidth * escala, img.imageHeight * escala
            img.hAlign = "LEFT"
            contenido.append(img)
        except Exception:  # noqa: BLE001 — sin la imagen, queda la firma electrónica
            pass
    if not contenido:
        contenido.append(Spacer(1, 14 * mm))
    linea = Table([[""]], colWidths=[70 * mm], rowHeights=[1])
    linea.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, -1), 0.8, GRAFITO)]))
    linea.hAlign = "LEFT"
    nombre = f.get("nombre") or d.get("autor")
    cargo = f.get("cargo") or d.get("cargo")
    contenido += [linea, Paragraph(f'<font name="{_F["negrita"]}" size="10.5" color="#0F1116">{_limpio(nombre)}</font>', _e("fn", leading=14)),
                  Paragraph(_limpio(cargo), _e("fc", textColor=PIZARRA))]
    if firmado and f.get("firmado_at"):
        momento = utc(datetime.fromisoformat(f["firmado_at"])).astimezone(ZONA)
        contenido += [Spacer(1, 2 * mm), Paragraph(
            f'Firmado electrónicamente el {momento:%d/%m/%Y} a las {momento:%H:%M} (hora de Asunción).<br/>'
            f'Código de verificación: <font name="{_F["negrita"]}" color="#0F1116">{escape(f.get("codigo") or "—")}</font>',
            _e("fv", fontSize=7.8, leading=10.5, textColor=PIZARRA))]
    else:
        contenido += [Spacer(1, 2 * mm), Paragraph("Borrador sin firmar: el código de verificación se genera al firmar.",
                                                     _e("fb", fontSize=7.8, leading=10.5, textColor=ROJO_OSCURO))]
    caja = Table([[contenido]], colWidths=[ancho * 0.55])
    caja.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0)]))
    caja.hAlign = "LEFT"
    return [Spacer(1, 9 * mm), KeepTogether([_seccion("Firma"), Spacer(1, 3 * mm), caja])]


# ------------------------------------------------------------------ armado
def generar(d: dict[str, Any]) -> bytes:
    """`d`: el informe como lo devuelve `informe.a_dict`."""
    _registrar()
    buf = io.BytesIO()
    margen = 16 * mm
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=margen, rightMargin=margen, topMargin=14 * mm, bottomMargin=18 * mm,
                            title=f"Informe diario {d['fecha']} - {d['autor']}", author=str(d["autor"]),
                            subject="Informe diario · Televentas Claro", creator="Operaciones Voicenter")
    ancho = A4[0] - 2 * margen
    story: list[Any] = [*_encabezado(d, ancho), *_resultados(d, ancho), *_importados(d, ancho), *_resumen(d),
                        *_metricas(d, ancho), *_seguimiento(d, ancho), *_firma(d, ancho)]
    pie = f"Operaciones Voicenter · Informe diario de {d['autor']} · {date.fromisoformat(d['fecha']):%d/%m/%Y}"
    doc.build(story, canvasmaker=functools.partial(_Lienzo, pie=pie, borrador=d["estado"] != "firmado"))
    return buf.getvalue()
