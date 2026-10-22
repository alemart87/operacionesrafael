"""Ficha del postulante en PDF (A4 con la marca): datos, avance de los entrenamientos, el resultado del IPV con su título
(«DGV 4 · Término medio»), seguimiento e historial. Sale con los mismos datos y permisos que la ficha en pantalla y usa
las piezas del PDF del informe diario. Todo el texto del usuario se escapa."""
from __future__ import annotations

import functools
import io
import re
import unicodedata
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from reportlab.graphics.shapes import Drawing, Rect
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.deps import CurrentUser, client_ip
from ...core.database import get_db
from ...services.audit_service import record_action
from ..televentas_claro.informe_diario.pdf import (
    _F, BORDE, FONDO, GRAFITO, LOGO, PIZARRA, ROJO, TA_RIGHT, TINTA, _cab, _e, _Lienzo, _limpio, _registrar, _seccion, _tabla,
)
from . import api, entrenamientos, ipv
from . import servicio as srv
from .api import require_ver

router = APIRouter(prefix="/capacitacion", tags=["capacitación y mentoría"])

# Los mismos colores que la ficha en pantalla.
COLOR_NIVEL = {"superior": colors.HexColor("#15803D"), "termino_medio": colors.HexColor("#2A78D6"),
               "inferior": colors.HexColor("#E6332A")}
SEXO = {"F": "Femenino", "M": "Masculino", "X": "Otro"}
ESTADO_ENT = {"pendiente": "Sin empezar", "en_curso": "En curso", "evaluando": "Evaluando", "terminado": "Terminado"}
TIPO_COMENTARIO = {"feedback": "Feedback", "oportunidad": "Oportunidad de mejora", "postulante": "Su feedback"}
EVENTO = {"alta": "Ingresó al grupo", "estado": "Cambio de estado", "link": "Link del test generado", "link_anulado": "Link anulado",
          "ipv_inicio": "Empezó el IPV", "ipv_terminado": "Terminó el IPV", "datos": "Datos corregidos",
          "entrenamiento_enviado": "Entrenamiento enviado", "entrenamiento_reiniciado": "Entrenamiento reiniciado"}
MAX_HISTORIAL = 60


def _local(iso: str | None) -> datetime | None:
    return datetime.fromisoformat(iso).astimezone(srv.ZONA) if iso else None


def _fecha(iso: str | None, hora: bool = False) -> str:
    d = _local(iso)
    return (f"{d:%d/%m/%Y %H:%M}" if hora else f"{d:%d/%m/%Y}") if d else "—"


def _dato(etiqueta: str, valor: str) -> Paragraph:
    return Paragraph(f'<font name="{_F["semi"]}" color="#5B6275" size="7">{_limpio(etiqueta).upper()}</font><br/>'
                     f'<font name="{_F["negrita"]}" size="10.5" color="#0F1116">{_limpio(valor)}</font>', _e("dato", leading=14))


def _barra(decatipo: int, color: Any, ancho: float) -> Drawing:
    alto = 3.2 * mm
    d = Drawing(ancho, alto)
    d.add(Rect(0, 0, ancho, alto, fillColor=FONDO, strokeColor=BORDE, strokeWidth=0.4, rx=1.2, ry=1.2))
    d.add(Rect(0, 0, ancho * max(0, min(decatipo, 10)) / 10, alto, fillColor=color, strokeColor=None, rx=1.2, ry=1.2))
    return d


def _evento(h: dict[str, Any]) -> str:
    if h["tipo"] == "estado" and h.get("a"):
        texto = f"Pasó a {srv.ESTADO_NOMBRE.get(h['a'], h['a'])}"
    elif h["tipo"] == "entrenamiento":
        texto = "Entrenamiento evaluado: " + ("recomendado" if h.get("a") == "aprobado" else "no recomendado")
    else:
        t = EVENTO.get(h["tipo"], h["tipo"].replace("_", " "))
        texto = t[:1].upper() + t[1:]
    return " · ".join(x for x in (texto, h.get("detalle"), h.get("motivo")) if x)


def _ipv(f: dict[str, Any], ancho: float) -> list[Any]:
    r = f["ipv"].get("resultado")
    if not r:
        estado = f["ipv"].get("estado")
        texto = (f"Lo está haciendo: lleva {f['ipv'].get('respondidas', 0)} de {f['ipv'].get('total', 87)} respondidas."
                 if estado == "en_curso" else "Tiene el link pero todavía no empezó." if estado == "pendiente"
                 else "Todavía no hizo el test.")
        return [Paragraph(_limpio(texto), _e("ipv0", textColor=PIZARRA))]
    dgv = r["escalas"][0]
    color = COLOR_NIVEL.get(dgv["nivel"], TINTA)
    nivel = ipv.NIVELES_IPV.get(dgv["nivel"], dgv["nivel"])
    # El resultado principal como título: «DGV 4 · Término medio».
    titulo = Paragraph(f'<font color="{"#" + color.hexval()[2:]}">DGV {int(dgv["decatipo"])}</font>'
                       f'<font color="#9CA3AF"> · </font>{_limpio(nivel).upper()}',
                       _e("dgv", fontName=_F["titulo"], fontSize=22, leading=25, textColor=TINTA))
    partes: list[Any] = [titulo, Paragraph("Disposición general para la venta · decatipo de 1 a 10", _e("dgvs", fontSize=7.8, textColor=PIZARRA)),
                         Spacer(1, 2.5 * mm), Paragraph(_limpio(r.get("resumen")), _e("res", fontSize=9.5, leading=13.5, textColor=TINTA))]
    for s in r.get("senales") or []:
        partes += [Spacer(1, 1.5 * mm), Paragraph(f'<font name="{_F["semi"]}">Atención:</font> {_limpio(s)}', _e("sen", textColor=colors.HexColor("#8A5200")))]
    caja = Table([[Paragraph(f'<font name="{_F["semi"]}" size="7" color="#047857">FORTALEZAS</font><br/>'
                             + _limpio(" · ".join(r.get("fortalezas") or []) or "Ninguna escala en nivel superior."), _e("fo")),
                   Paragraph(f'<font name="{_F["semi"]}" size="7" color="#B81F18">A TRABAJAR</font><br/>'
                             + _limpio(" · ".join(r.get("a_trabajar") or []) or "Ninguna escala en nivel inferior."), _e("at"))]],
                 colWidths=[ancho / 2 - 1.5 * mm, ancho / 2 - 1.5 * mm], spaceBefore=3 * mm)
    caja.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, 0), colors.HexColor("#ECFDF5")), ("BACKGROUND", (1, 0), (1, 0), colors.HexColor("#FDECEB")),
                              ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7), ("TOPPADDING", (0, 0), (-1, -1), 6),
                              ("BOTTOMPADDING", (0, 0), (-1, -1), 6), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                              ("LINEAFTER", (0, 0), (0, 0), 3 * mm, colors.white)]))
    partes.append(caja)
    barra = 52 * mm
    filas = [[_cab("Escala"), _cab("Decatipo", derecha=True), _cab(""), _cab("Nivel")]]
    for x in r["escalas"]:
        sub = bool(x.get("romano"))
        nombre = f"{x['romano']}. {x['nombre']}" if sub else x["nombre"]
        filas.append([Paragraph(_limpio(nombre), _e("en", fontName=_F["texto"] if sub else _F["semi"], leftIndent=8 if sub else 0)),
                      Paragraph(str(int(x["decatipo"])), _e("ed", fontName=_F["negrita"], alignment=TA_RIGHT)),
                      _barra(int(x["decatipo"]), COLOR_NIVEL.get(x["nivel"], GRAFITO), barra),
                      Paragraph(_limpio(ipv.NIVELES_IPV.get(x["nivel"], x["nivel"])), _e("eni", textColor=PIZARRA))])
    tabla = _tabla(filas, [ancho - barra - 52 * mm, 18 * mm, barra + 6 * mm, 28 * mm], zebra=True)
    tabla.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    terminado = _fecha(f["ipv"].get("terminado_at"))
    minutos = f" en {round(r['segundos'] / 60)} min" if r.get("segundos") else ""
    partes += [Spacer(1, 3 * mm), tabla, Spacer(1, 2 * mm),
               Paragraph(f"Terminado el {terminado}{minutos}. Es una herramienta de orientación: se complementa con la entrevista "
                         "y el desempeño en sala y piso.", _e("ipvn", fontSize=7.6, textColor=PIZARRA))]
    return partes


def _nombre_ent(x: dict[str, Any]) -> str:
    return x["nombre"] + (f" · intento {x['intento']}" if (x.get("intento") or 1) > 1 else "")


def _entrenamientos(p: dict[str, Any], ents: list[dict[str, Any]], ancho: float) -> list[Any]:
    av = p.get("avance") or {}
    pct = f"{av['pct']}%" if av.get("pct") is not None else "—"
    partes: list[Any] = [Paragraph(
        f'<font name="{_F["semi"]}">{av.get("terminados", 0)} terminados</font> (el mínimo del equipo es {av.get("meta", "—")}) · '
        f'{av.get("aprobados", 0)} recomendados · avance de casos {pct}', _e("av", textColor=GRAFITO))]
    if not ents:
        return partes + [Spacer(1, 2 * mm), Paragraph("Todavía no tiene entrenamientos enviados.", _e("ent0", textColor=PIZARRA))]
    filas = [[_cab("Entrenamiento"), _cab("Estado"), _cab("Casos", derecha=True), _cab("Nivel", derecha=True),
              _cab("Info", derecha=True), _cab("Resultado")]]
    for x in ents:
        r = x.get("resultado") or {}
        resultado = ("Recomendado" if r.get("aprobado") else "No recomendado") if r else "—"
        filas.append([Paragraph(_limpio(_nombre_ent(x)), _e("enom", fontName=_F["semi"])),
                      Paragraph(_limpio(ESTADO_ENT.get(x["estado"], x["estado"])), _e("eest")),
                      Paragraph(f"{x['hechos']}/{x['casos']}", _e("ecas", alignment=TA_RIGHT)),
                      Paragraph(f"{r['nivel_promedio']}" if r.get("nivel_promedio") is not None else "—", _e("eniv", alignment=TA_RIGHT)),
                      Paragraph(f"{round(r['info_pct'])}%" if r.get("info_pct") is not None else "—", _e("einf", alignment=TA_RIGHT)),
                      Paragraph(_limpio(resultado), _e("eres", fontName=_F["semi"],
                                                       textColor=(colors.HexColor("#047857") if r.get("aprobado") else ROJO) if r else PIZARRA))])
    partes += [Spacer(1, 2.5 * mm), _tabla(filas, [ancho - 120 * mm, 24 * mm, 16 * mm, 16 * mm, 16 * mm, 48 * mm], zebra=True)]
    for x in ents:
        r = x.get("resultado") or {}
        if not r.get("resumen"):
            continue
        texto = f'<font name="{_F["semi"]}" color="#0F1116">{_limpio(_nombre_ent(x))}:</font> {_limpio(r["resumen"])}'
        if r.get("fuertes"):
            texto += f'<br/><font name="{_F["semi"]}" color="#047857">Puntos fuertes:</font> {_limpio(" · ".join(r["fuertes"]))}'
        if r.get("mejorar"):
            texto += f'<br/><font name="{_F["semi"]}" color="#B81F18">Para mejorar:</font> {_limpio(" · ".join(r["mejorar"]))}'
        partes += [Spacer(1, 2.5 * mm), Paragraph(texto, _e("eresu"))]
    return partes


def generar(f: dict[str, Any], ents: list[dict[str, Any]], *, generado_por: str) -> bytes:
    """`f`: la ficha como la devuelve la API; `ents`: los entrenamientos del postulante con su resultado."""
    _registrar()
    p, g = f["postulante"], f["grupo"]
    nombre = f"{p['nombre']} {p['apellido']}"
    buf = io.BytesIO()
    margen = 16 * mm
    ancho = A4[0] - 2 * margen
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=margen, rightMargin=margen, topMargin=14 * mm, bottomMargin=18 * mm,
                            title=f"Ficha {nombre}", author="Operaciones Voicenter",
                            subject="Ficha del postulante · Capacitación y mentoría", creator="Operaciones Voicenter")
    logo = Image(str(LOGO), width=24 * mm, height=24 * mm * 328 / 520) if LOGO.exists() else Spacer(1, 1)
    titulo = Paragraph("FICHA DEL POSTULANTE", _e("t", fontName=_F["titulo"], fontSize=24, leading=26, textColor=TINTA, alignment=TA_RIGHT))
    sub = Paragraph(f"Capacitación y mentoría · {_limpio(g['nombre'])}", _e("s", fontSize=8.5, textColor=PIZARRA, alignment=TA_RIGHT))
    cab = Table([[logo, [titulo, sub]]], colWidths=[40 * mm, ancho - 40 * mm])
    cab.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                             ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("LINEBELOW", (0, 0), (-1, 0), 1.6, ROJO),
                             ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    estado = p["estado_nombre"] + (f" · {p['motivo']}" if p.get("motivo") else "")
    datos = Table([[_dato("Postulante", nombre), _dato("CI", str(p["ci"])), _dato("Edad · sexo", f"{p['edad']} años · {SEXO.get(p['sexo'], p['sexo'])}")],
                   [_dato("Grupo", g["nombre"]), _dato("Ingresó", _fecha(g.get("fecha_inicio"))), _dato("Capacitador", g.get("capacitador") or "—")],
                   [_dato("Estado", estado), _dato("Desde", _fecha(p.get("estado_at"))), _dato("Día de capacitación", str(g.get("dia", "—")))]],
                  colWidths=[ancho * 0.40, ancho * 0.28, ancho * 0.32])
    datos.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 7), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story: list[Any] = [cab, datos, Spacer(1, 6 * mm)]

    test = _ipv(f, ancho)   # el título con el DGV queda pegado al encabezado de la sección
    story += [KeepTogether([_seccion("Test IPV"), Spacer(1, 3 * mm), *test[:4]]), *test[4:], Spacer(1, 7 * mm)]
    ent = _entrenamientos(p, ents, ancho)   # la sección no queda separada de su tabla
    story += [KeepTogether([_seccion("Entrenamientos"), Spacer(1, 3 * mm), *ent[:3]]), *ent[3:], Spacer(1, 7 * mm)]

    c = f.get("conteo") or {}
    seguimiento: list[Any] = [_seccion("Seguimiento"), Spacer(1, 2 * mm),
                              Paragraph(f"{c.get('total', 0)} comentarios: {c.get('feedback', 0)} feedback, {c.get('oportunidad', 0)} "
                                        f"oportunidades y {c.get('postulante', 0)} del postulante.", _e("segc", textColor=PIZARRA))]
    if f.get("comentarios"):
        filas = [[_cab("Fecha"), _cab("Tipo"), _cab("Comentario")]]
        for x in f["comentarios"]:
            quien = x.get("autor") or ("El postulante" if x.get("tipo") == "postulante" else "—")
            texto = _limpio(x.get("texto")) if x.get("texto") else '<font color="#5B6275">(audio sin transcribir)</font>'
            filas.append([Paragraph(_fecha(x.get("at"), hora=True), _e("cf", textColor=PIZARRA, fontSize=8)),
                          Paragraph(_limpio(TIPO_COMENTARIO.get(x["tipo"], x["tipo"])), _e("ct", fontName=_F["semi"], fontSize=8.5)),
                          Paragraph(f'{texto}<br/><font color="#5B6275" size="7.5">{_limpio(quien)}</font>', _e("cx"))])
        seguimiento += [Spacer(1, 2.5 * mm), _tabla(filas, [30 * mm, 30 * mm, ancho - 60 * mm], zebra=True)]
    story += [KeepTogether(seguimiento), Spacer(1, 7 * mm)]

    historial = f.get("historial") or []
    if historial:
        filas = [[_cab("Fecha"), _cab("Evento"), _cab("Por")]]
        for h in historial[:MAX_HISTORIAL]:
            por = h.get("por") or ("El postulante" if h["tipo"].startswith("ipv") else "La IA" if h["tipo"] == "entrenamiento" else "—")
            filas.append([Paragraph(_fecha(h.get("at"), hora=True), _e("hf", textColor=PIZARRA, fontSize=8)),
                          Paragraph(_limpio(_evento(h)), _e("he")), Paragraph(_limpio(por), _e("hp", textColor=PIZARRA, fontSize=8))])
        story.append(KeepTogether([_seccion("Historial"), Spacer(1, 3 * mm), _tabla(filas, [30 * mm, ancho - 80 * mm, 50 * mm], zebra=True)]))
        if len(historial) > MAX_HISTORIAL:
            story.append(Paragraph(f"Se muestran los {MAX_HISTORIAL} eventos más recientes de {len(historial)}.", _e("hm", fontSize=7.6, textColor=PIZARRA)))

    ahora = datetime.now(srv.ZONA)
    nota = Table([[Paragraph(
        f"Documento interno y confidencial: contiene datos personales del postulante. Generado por {_limpio(generado_por)} "
        f"el {ahora:%d/%m/%Y} a las {ahora:%H:%M} (hora de Asunción). No lo reenvíes fuera del equipo.",
        _e("nota", fontSize=7.6, leading=10.4, textColor=PIZARRA))]], colWidths=[ancho])
    nota.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), FONDO), ("BOX", (0, 0), (-1, -1), 0.5, BORDE),
                              ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                              ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story += [Spacer(1, 8 * mm), nota]
    pie = f"Operaciones Voicenter · Ficha de {nombre} · {ahora:%d/%m/%Y} · Confidencial"
    doc.build(story, canvasmaker=functools.partial(_Lienzo, pie=pie))
    return buf.getvalue()


def _archivo(p: dict[str, Any]) -> str:
    base = unicodedata.normalize("NFKD", f"{p['nombre']} {p['apellido']}").encode("ascii", "ignore").decode()
    slug = re.sub(r"[^A-Za-z0-9]+", "-", base).strip("-")[:50] or "postulante"
    return f"Ficha_{slug}_{srv.hoy().isoformat()}.pdf"


@router.get("/postulantes/{pid}/pdf")
async def ficha_pdf(pid: str, request: Request, user: CurrentUser = Depends(require_ver), db: AsyncSession = Depends(get_db)) -> Response:
    """La ficha para imprimir o compartir: lo mismo que se ve en pantalla (mismos permisos), sin los audios."""
    f = await api.ficha(pid, user, db)
    ents = (await entrenamientos.de_postulante(pid, user, db))["entrenamientos"]
    contenido = generar(f, ents, generado_por=user.full_name or user.email)
    await record_action(db, user_id=user.id, action="capacitacion_ficha_pdf", resource_type="cap_postulante", resource_id=pid,
                        ip=client_ip(request))
    return Response(contenido, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{_archivo(f["postulante"])}"', "Cache-Control": "no-store"})
