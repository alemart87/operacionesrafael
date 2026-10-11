"""Extracción de texto de documentos (PDF, Word .docx, texto y Markdown) para la base de conocimiento de Voi.

Corre dentro de un subproceso aislado (`app.jobs.isolated.run_isolated`), con tiempo y memoria acotados: un archivo
dañado o malicioso no puede colgar ni tumbar la API. Por eso este módulo solo usa la biblioteca estándar y pypdf, y no
importa nada más de la aplicación (el subproceso arranca liviano).

`procesar(nombre, contenido)` devuelve el texto partido en fragmentos de ~1.100 caracteres, cada uno con su página
(PDF) y su sección (títulos detectados), listos para buscar y citar.
"""
from __future__ import annotations

import io
import re
import zipfile
from collections import Counter
from pathlib import PurePath
from typing import Any, Iterable, Iterator, Optional
from xml.etree import ElementTree as ET

EXTENSIONES = (".pdf", ".docx", ".txt", ".md")
OBJETIVO = 1100              # caracteres por fragmento: apunta a esto, cortando entre párrafos
MAXIMO = 1600                # un párrafo más largo se parte por oraciones
MAX_PAGINAS = 2000
MAX_CARACTERES = 3_000_000   # de texto extraído (unas 1.500 páginas densas)
MAX_XML = 80 * 1024 * 1024   # document.xml descomprimido (defensa contra «zip bombs»)

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class DocumentoInvalido(ValueError):
    """Lo que no se pudo leer, explicado para quien lo subió."""


# ------------------------------------------------------------------ texto plano y detección de títulos
_ESPACIOS = re.compile(r"[ \t  -​ 　]+")
_VINETA = re.compile(r"^([•·▪◦●○■□➢►✓✔|\-–—*]|\d{1,3}[.)]|[a-zA-Z][.)])\s+")
_NUMERO_PAGINA = re.compile(r"^(p[aá]g(ina)?\.?\s*)?\d{1,4}(\s*(de|/)\s*\d{1,4})?$", re.I)
_NUMERADO_MULTI = re.compile(r"^\d{1,2}(\.\d{1,2}){1,4}\.?\s+\S")                 # 3.2 Cuotas diferidas
_NUMERADO_SIMPLE = re.compile(r"^(\d{1,2}[.)]|[IVXLC]{1,6}[.)])\s+[A-ZÁÉÍÓÚÑ]")      # 1. Introducción · IV. Anexos
_PALABRA_TITULO = re.compile(r"^(cap[ií]tulo|secci[oó]n|anexo|art[ií]culo|t[ií]tulo|ap[eé]ndice)\b\s*[\w.]*", re.I)


def limpiar(linea: str) -> str:
    return _ESPACIOS.sub(" ", linea.replace("­", "")).strip()


def es_titulo(linea: str) -> bool:
    """Heurística para títulos de sección en texto sin estilos (PDF, texto): cortos, sin punto final y numerados,
    en mayúsculas o con una palabra de sección («Capítulo 2», «Anexo B»)."""
    if not (3 <= len(linea) <= 90) or linea[-1] in ".,;":
        return False
    letras = [c for c in linea if c.isalpha()]
    if len(letras) < 3:
        return False
    palabras = len(linea.split())
    if _NUMERADO_MULTI.match(linea) and palabras <= 12:
        return True
    if _NUMERADO_SIMPLE.match(linea) and palabras <= 6:
        return True
    if _PALABRA_TITULO.match(linea) and palabras <= 12:
        return True
    mayusculas = sum(c.isupper() for c in letras) / len(letras)
    return mayusculas >= 0.85 and len(letras) >= 4 and palabras <= 12


def _parrafos(lineas: Iterable[str], pagina: Optional[int]) -> Iterator[dict[str, Any]]:
    """Arma párrafos con las líneas de una página: une las líneas cortadas, respeta viñetas y separa los títulos."""
    actual = ""
    for crudo in lineas:
        linea = limpiar(crudo)
        if not linea:
            if actual:
                yield {"pagina": pagina, "texto": actual}
                actual = ""
            continue
        if es_titulo(linea):
            if actual:
                yield {"pagina": pagina, "texto": actual}
                actual = ""
            yield {"pagina": pagina, "texto": linea, "titulo": True}
            continue
        if not actual:
            actual = linea
        elif actual.endswith("-") and linea[:1].islower():
            actual = actual[:-1] + linea                                   # pala-\nbra
        elif _VINETA.match(linea) or (actual[-1] in ".:;!?" and (linea[:1].isupper() or linea[:1].isdigit())):
            yield {"pagina": pagina, "texto": actual}
            actual = linea
        else:
            actual += " " + linea
    if actual:
        yield {"pagina": pagina, "texto": actual}


# ------------------------------------------------------------------ PDF
def _clave_repeticion(linea: str) -> str:
    return re.sub(r"\d+", "#", limpiar(linea).lower())


def _repetidas(paginas: list[list[str]]) -> set[str]:
    """Encabezados y pies que se repiten en casi todas las páginas (nombre de la empresa, «Confidencial»…)."""
    if len(paginas) < 3:
        return set()
    cuenta: Counter[str] = Counter()
    for lineas in paginas:
        utiles = [l for l in lineas if limpiar(l)]
        cuenta.update({_clave_repeticion(l) for l in utiles[:3] + utiles[-3:]})
    minimo = max(3, int(len(paginas) * 0.6 + 0.999))
    return {k for k, n in cuenta.items() if n >= minimo and k}


def _pdf(contenido: bytes) -> tuple[int, list[dict[str, Any]]]:
    from pypdf import PdfReader

    try:
        lector = PdfReader(io.BytesIO(contenido))
        if lector.is_encrypted:
            try:
                abierto = lector.decrypt("")
            except Exception:  # noqa: BLE001
                abierto = 0
            if not abierto:
                raise DocumentoInvalido("El PDF está protegido con contraseña: subí una copia sin contraseña.")
        total = len(lector.pages)
    except DocumentoInvalido:
        raise
    except Exception as exc:  # noqa: BLE001
        raise DocumentoInvalido("No se pudo leer el PDF: parece dañado o no es un PDF válido.") from exc
    if total > MAX_PAGINAS:
        raise DocumentoInvalido(f"El PDF tiene {total} páginas: el máximo es {MAX_PAGINAS}.")
    paginas: list[list[str]] = []
    for pagina in lector.pages:
        try:
            paginas.append((pagina.extract_text() or "").splitlines())
        except Exception:  # noqa: BLE001 — una página rota no invalida el resto
            paginas.append([])
    repetidas = _repetidas(paginas)
    bloques: list[dict[str, Any]] = []
    for numero, lineas in enumerate(paginas, start=1):
        utiles = [l for l in lineas
                  if not (limpiar(l) and (_clave_repeticion(l) in repetidas or _NUMERO_PAGINA.match(limpiar(l))))]
        bloques.extend(_parrafos(utiles, numero))
    return total, bloques


# ------------------------------------------------------------------ Word (.docx)
def _texto_docx(nodo: ET.Element) -> str:
    partes = []
    for el in nodo.iter():
        if el.tag == f"{W}t" and el.text:          # w:delText (borrado) y w:instrText (campos) quedan afuera
            partes.append(el.text)
        elif el.tag == f"{W}tab":
            partes.append(" ")
        elif el.tag in (f"{W}br", f"{W}cr"):
            partes.append("\n")
    return "".join(partes)


def _es_titulo_docx(p: ET.Element, texto: str) -> bool:
    if len(texto) > 200:
        return False
    ppr = p.find(f"{W}pPr")
    if ppr is not None:
        estilo = ppr.find(f"{W}pStyle")
        valor = ((estilo.get(f"{W}val") if estilo is not None else "") or "").lower()
        # Word guarda «Título 1» como «Ttulo1» (saca las letras con tilde del identificador del estilo)
        if ppr.find(f"{W}outlineLvl") is not None or valor.startswith(
                ("heading", "ttulo", "titulo", "title", "subttulo", "subtitulo", "subtitle", "encabezado")):
            return True
    if len(texto) > 90 or texto[-1] in ".,;:":
        return False
    corridas = [r for r in p.iter(f"{W}r") if r.find(f"{W}t") is not None]
    negrita = bool(corridas) and all(_negrita(r) for r in corridas)
    return negrita or es_titulo(texto)


def _negrita(r: ET.Element) -> bool:
    b = r.find(f"{W}rPr/{W}b")
    return b is not None and (b.get(f"{W}val") or "true").lower() not in ("0", "false", "off")


def _docx(contenido: bytes) -> list[dict[str, Any]]:
    try:
        archivo = zipfile.ZipFile(io.BytesIO(contenido))
    except zipfile.BadZipFile as exc:
        raise DocumentoInvalido("No es un documento de Word (.docx) válido.") from exc
    with archivo:
        try:
            info = archivo.getinfo("word/document.xml")
        except KeyError as exc:
            raise DocumentoInvalido("No es un documento de Word (.docx) válido.") from exc
        if info.file_size > MAX_XML:
            raise DocumentoInvalido("El documento es demasiado grande para leerlo.")
        with archivo.open(info) as f:
            xml = f.read(MAX_XML + 1)
    if len(xml) > MAX_XML:
        raise DocumentoInvalido("El documento es demasiado grande para leerlo.")
    if b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:            # Word nunca los usa: se rechazan (entidades XML)
        raise DocumentoInvalido("El documento tiene un formato no admitido.")
    try:
        raiz = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise DocumentoInvalido("El documento de Word está dañado.") from exc
    bloques: list[dict[str, Any]] = []

    def recorrer(nodo: ET.Element) -> None:
        for hijo in nodo:
            if hijo.tag == f"{W}p":
                texto = limpiar(_texto_docx(hijo).replace("\n", " "))
                if texto:
                    bloques.append({"pagina": None, "texto": texto, **({"titulo": True} if _es_titulo_docx(hijo, texto) else {})})
            elif hijo.tag == f"{W}tbl":
                for fila in hijo.iter(f"{W}tr"):
                    celdas = [limpiar(" ".join(_texto_docx(p) for p in celda.iter(f"{W}p")).replace("\n", " "))
                              for celda in fila.findall(f"{W}tc")]
                    if any(celdas):
                        bloques.append({"pagina": None, "texto": " | ".join(celdas)})
            elif hijo.tag in (f"{W}sdt", f"{W}sdtContent", f"{W}customXml", f"{W}ins"):
                recorrer(hijo)

    cuerpo = raiz.find(f"{W}body")
    if cuerpo is not None:
        recorrer(cuerpo)
    return bloques


# ------------------------------------------------------------------ texto y Markdown
def _decodificar(contenido: bytes) -> str:
    for codificacion in ("utf-8-sig", "cp1252"):
        try:
            texto = contenido.decode(codificacion)
            break
        except UnicodeDecodeError:
            continue
    else:
        texto = contenido.decode("latin-1")
    if "\x00" in texto[:4096]:
        raise DocumentoInvalido("El archivo no parece de texto.")
    return texto.replace("\r\n", "\n").replace("\r", "\n")


def _texto(contenido: bytes, markdown: bool) -> list[dict[str, Any]]:
    bloques: list[dict[str, Any]] = []
    lineas: list[str] = []
    for linea in _decodificar(contenido).split("\n"):
        m = re.match(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$", linea) if markdown else None
        if m:
            bloques.extend(_parrafos(lineas, None))
            lineas = []
            bloques.append({"pagina": None, "texto": limpiar(m.group(1)), "titulo": True})
        elif markdown and re.match(r"^\s*(```|~~~|---+|===+|\*\*\*+)\s*$", linea):
            lineas.append("")
        else:
            lineas.append(linea)
    bloques.extend(_parrafos(lineas, None))
    return bloques


# ------------------------------------------------------------------ fragmentos
def _partir(texto: str) -> list[str]:
    """Un párrafo largo, en pedazos de hasta OBJETIVO caracteres cortando entre oraciones (o entre palabras)."""
    if len(texto) <= MAXIMO:
        return [texto]
    pedazos: list[str] = []
    actual = ""
    for oracion in re.split(r"(?<=[.!?;:])\s+", texto):
        while len(oracion) > MAXIMO:
            corte = oracion.rfind(" ", 0, OBJETIVO)
            corte = corte if corte > OBJETIVO // 2 else OBJETIVO
            if actual:
                pedazos.append(actual)
                actual = ""
            pedazos.append(oracion[:corte].strip())
            oracion = oracion[corte:].strip()
        if actual and len(actual) + 1 + len(oracion) > OBJETIVO:
            pedazos.append(actual)
            actual = oracion
        else:
            actual = f"{actual} {oracion}".strip()
    if actual:
        pedazos.append(actual)
    return [p for p in pedazos if p]


def fragmentar(bloques: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Agrupa párrafos hasta ~OBJETIVO caracteres. Cada fragmento queda en una sola página y una sola sección, así la
    cita apunta al lugar exacto."""
    fragmentos: list[dict[str, Any]] = []
    partes: list[str] = []
    largo = 0
    pagina: Optional[int] = None
    seccion: Optional[str] = None

    def cerrar() -> None:
        nonlocal partes, largo
        texto = "\n".join(partes).strip()
        if texto:
            fragmentos.append({"pagina": pagina, "seccion": seccion, "texto": texto})
        partes, largo = [], 0

    for b in bloques:
        if b.get("pagina") != pagina:
            cerrar()
            pagina = b.get("pagina")
        if b.get("titulo"):
            cerrar()
            seccion = b["texto"][:200]
            continue
        for pedazo in _partir(b["texto"]):
            if partes and largo + 1 + len(pedazo) > OBJETIVO:
                cerrar()
            partes.append(pedazo)
            largo += len(pedazo) + 1
    cerrar()
    return fragmentos


def procesar(nombre: str, contenido: bytes) -> dict[str, Any]:
    """Lee el archivo y devuelve {"paginas", "caracteres", "truncado", "fragmentos": [{pagina, seccion, texto}]}."""
    extension = PurePath(nombre or "").suffix.lower()
    paginas: Optional[int] = None
    if extension == ".pdf":
        paginas, bloques = _pdf(contenido)
    elif extension == ".docx":
        bloques = _docx(contenido)
    elif extension in (".txt", ".md"):
        bloques = _texto(contenido, markdown=extension == ".md")
    else:
        raise DocumentoInvalido("Formato no admitido: subí un PDF, un Word (.docx), un .txt o un .md.")
    fragmentos = fragmentar(bloques)
    total, truncado, salida = 0, False, []
    for f in fragmentos:
        if total + len(f["texto"]) > MAX_CARACTERES:
            truncado = True
            break
        total += len(f["texto"])
        salida.append(f)
    return {"paginas": paginas, "caracteres": total, "truncado": truncado, "fragmentos": salida}
