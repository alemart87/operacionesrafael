"""Base de conocimiento de Voi: los documentos que sube el superadmin (manuales, políticas, criterios) para que Voi
responda con lo que dicen y lo cite.

- Al subir: el texto se extrae en un subproceso aislado (`app.services.extraccion_texto`), se parte en fragmentos con
  su página y sección, y se guarda el original comprimido (para descargarlo desde la cita).
- Quién lo consulta: lo decide el superadmin por documento (`alcance`): todos los que usan Voi, solo quienes tienen
  ciertos permisos de la plataforma (p. ej. Facturación) o solo el superadmin. Voi busca con los permisos de quien
  conversa: nunca ve ni cita un documento que esa persona no podría abrir.
- Cómo busca: BM25 sobre términos normalizados (sin tildes ni palabras vacías, con un recorte de plurales y género), con
  un índice en memoria que se rehace cuando cambian los documentos.
- Cómo cita: cada resultado trae su cita lista para copiar, `[Título, p. 4](cita:frag_…)`; el panel la muestra como un
  chip que abre el pasaje exacto.
"""
from __future__ import annotations

import asyncio
import math
import re
import secrets
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any, Iterable, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from ..api.deps import CurrentUser
from ..core.operativas import ALL_PERMISSIONS
from .models import AsistenteDocumento, AsistenteFragmento

ALCANCES = ("todos", "permisos", "superadmin")
K1, B = 1.4, 0.75
MAX_RESULTADOS = 10
MAX_CATALOGO = 40            # documentos que se listan en la descripción de la herramienta

# Palabras que no ayudan a buscar (ya sin tildes). Incluye las muletillas de las preguntas («qué dice…», «explicame…»).
_VACIAS = frozenset("""
a al algo alguien algun alguna algunas alguno algunos ante antes aqui asi aun cada como con contame contra cual cuales
cuando cuanta cuantas cuanto cuantos de decir del desde dice dicen donde e el ella ellas ello ellos en entre era eran
es esa esas ese eso esos esta estan estar estas este esto estos explica explicame fue fueron ha habia han hasta hay la
las le les lo los mas me mi mis mucho muy nada ni no nos o os otra otras otro otros para pero poco por porque puede
pueden que quien quienes se sea segun ser si sin sino sobre son su sus tal tambien tan tanto te tiene tienen todo todos
tu tus un una unas uno unos y ya yo
""".split())
_TOKEN = re.compile(r"[a-z0-9]+")


def sin_tildes(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", texto.lower()) if not unicodedata.combining(c))


def raiz(palabra: str) -> str:
    """Recorte liviano y consistente de plural y género (comisiones → comision, cuotas → cuot, meses → mes)."""
    if len(palabra) <= 3 or palabra.isdigit():
        return palabra
    if palabra.endswith("ces") and len(palabra) > 4:
        palabra = palabra[:-3] + "z"
    elif palabra.endswith("es") and len(palabra) > 4 and palabra[-3] in "lrndj":
        palabra = palabra[:-2]
    elif palabra.endswith("s") and not palabra.endswith("ss"):
        palabra = palabra[:-1]
    if len(palabra) > 3 and palabra[-1] in "aeo":
        palabra = palabra[:-1]
    return palabra


def terminos(texto: str) -> list[str]:
    return [raiz(t) for t in _TOKEN.findall(sin_tildes(texto or ""))
            if t not in _VACIAS and (len(t) > 1 or t.isdigit())]


def palabras_clave(texto: str) -> list[str]:
    """Las palabras de la consulta que cuentan para buscar, como las escribió la persona (para mostrarlas)."""
    vistas: list[str] = []
    for w in re.findall(r"\w+", (texto or "").lower()):
        if sin_tildes(w) not in _VACIAS and (len(w) > 1 or w.isdigit()) and w not in vistas:
            vistas.append(w)
    return vistas


def terminos_fragmento(texto: str, *, titulo: str = "", seccion: Optional[str] = None) -> dict[str, int]:
    """Los términos del fragmento con sus veces; el título del documento y la sección suman una vez cada término (así
    «¿qué dice el manual de comisiones…?» encuentra ese manual)."""
    cuenta = Counter(terminos(texto))
    cuenta.update(set(terminos(titulo)) | set(terminos(seccion or "")))
    return dict(cuenta)


def nuevo_id() -> str:
    return f"frag_{secrets.token_hex(8)}"


# ------------------------------------------------------------------ quién ve qué
def alcance_valido(alcance: Any) -> dict[str, Any]:
    """Valida y normaliza el alcance que eligió el superadmin. ValueError con el motivo si no sirve."""
    a = alcance if isinstance(alcance, dict) else {}
    tipo = a.get("tipo") or "todos"
    if tipo not in ALCANCES:
        raise ValueError("Alcance inválido: elegí todos, permisos o solo el superadmin.")
    if tipo != "permisos":
        return {"tipo": tipo, "permisos": []}
    permisos = sorted({str(p) for p in (a.get("permisos") or [])})
    desconocidos = [p for p in permisos if p not in ALL_PERMISSIONS]
    if desconocidos:
        raise ValueError(f"Permisos desconocidos: {', '.join(desconocidos[:5])}")
    if not permisos:
        raise ValueError("Elegí al menos un permiso para el alcance.")
    return {"tipo": "permisos", "permisos": permisos}


def puede_ver(doc: AsistenteDocumento, user: CurrentUser) -> bool:
    if user.is_superadmin:
        return True
    if not doc.activo:
        return False
    a = doc.alcance or {}
    tipo = a.get("tipo") or "todos"
    if tipo == "todos":
        return True
    if tipo == "permisos":
        return any(user.has_perm(p) for p in a.get("permisos") or [])
    return False


async def documentos_para(db: AsyncSession, user: CurrentUser) -> list[AsistenteDocumento]:
    """Los documentos activos que esta persona puede consultar con Voi (sin cargar el archivo)."""
    filas = (await db.execute(
        select(AsistenteDocumento).options(defer(AsistenteDocumento.contenido_gz))
        .where(AsistenteDocumento.activo.is_(True)).order_by(AsistenteDocumento.titulo))).scalars().all()
    return [d for d in filas if puede_ver(d, user)]


def describir_catalogo(docs: list[AsistenteDocumento]) -> str:
    lineas = []
    for d in docs[:MAX_CATALOGO]:
        extra = f", {d.paginas} págs." if d.paginas else ""
        desc = f": {d.descripcion.strip()[:180]}" if (d.descripcion or "").strip() else ""
        lineas.append(f"- «{d.titulo}» (id {d.id}{extra}){desc}")
    if len(docs) > MAX_CATALOGO:
        lineas.append(f"- … y {len(docs) - MAX_CATALOGO} más (la búsqueda los cubre a todos).")
    return "\n".join(lineas)


# ------------------------------------------------------------------ índice en memoria
@dataclass
class _Indice:
    version: tuple
    fragmentos: list[tuple[str, str, int]]            # (frag_id, documento_id, largo)
    postings: dict[str, list[tuple[int, int]]]         # término → [(posición, veces)]
    promedio: float


_indice_actual: Optional[_Indice] = None
_candado = asyncio.Lock()


def invalidar() -> None:
    global _indice_actual
    _indice_actual = None


async def _version(db: AsyncSession) -> tuple:
    fila = (await db.execute(select(func.count(AsistenteDocumento.id), func.max(AsistenteDocumento.updated_at),
                                    func.sum(AsistenteDocumento.fragmentos))
                             .where(AsistenteDocumento.activo.is_(True)))).one()
    return tuple(str(x) for x in fila)


async def _indice(db: AsyncSession) -> _Indice:
    global _indice_actual
    version = await _version(db)
    if _indice_actual is not None and _indice_actual.version == version:
        return _indice_actual
    async with _candado:
        if _indice_actual is not None and _indice_actual.version == version:
            return _indice_actual
        filas = (await db.execute(
            select(AsistenteFragmento.id, AsistenteFragmento.documento_id, AsistenteFragmento.terminos)
            .join(AsistenteDocumento, AsistenteDocumento.id == AsistenteFragmento.documento_id)
            .where(AsistenteDocumento.activo.is_(True))
            .order_by(AsistenteFragmento.documento_id, AsistenteFragmento.orden))).all()
        fragmentos: list[tuple[str, str, int]] = []
        postings: dict[str, list[tuple[int, int]]] = defaultdict(list)
        for pos, (fid, did, terms) in enumerate(filas):
            terms = terms or {}
            fragmentos.append((fid, did, sum(terms.values()) or 1))
            for t, n in terms.items():
                postings[t].append((pos, int(n)))
        promedio = (sum(f[2] for f in fragmentos) / len(fragmentos)) if fragmentos else 1.0
        _indice_actual = _Indice(version, fragmentos, dict(postings), promedio)
        return _indice_actual


# ------------------------------------------------------------------ búsqueda y citas
_CORCHETES = re.compile(r"[\[\]()]")


def etiqueta_cita(titulo: str, pagina: Optional[int], seccion: Optional[str]) -> str:
    """El texto del chip: «Manual de comisiones, p. 4» o «Política de calidad · Penalidades»."""
    titulo = _CORCHETES.sub("", titulo).strip()
    if pagina:
        return f"{titulo}, p. {pagina}"
    if seccion:
        return f"{titulo} · {_CORCHETES.sub('', seccion)[:60]}"
    return titulo


def cita(fragmento_id: str, titulo: str, pagina: Optional[int], seccion: Optional[str]) -> str:
    return f"[{etiqueta_cita(titulo, pagina, seccion)}](cita:{fragmento_id})"


async def buscar(db: AsyncSession, user: CurrentUser, consulta: str, *, documento_id: Optional[str] = None,
                 limite: int = 6, incluir_inactivos: bool = False) -> list[dict[str, Any]]:
    """Los fragmentos más relevantes para la consulta entre los documentos que la persona puede ver."""
    q = list(dict.fromkeys(terminos(consulta)))
    if not q:
        return []
    if incluir_inactivos and user.is_superadmin:
        docs = (await db.execute(select(AsistenteDocumento).options(defer(AsistenteDocumento.contenido_gz)))).scalars().all()
        visibles = {d.id: d for d in docs}
        filas = (await db.execute(select(AsistenteFragmento.id, AsistenteFragmento.documento_id, AsistenteFragmento.terminos)
                                  .order_by(AsistenteFragmento.documento_id, AsistenteFragmento.orden))).all()
        fragmentos = [(fid, did, sum((t or {}).values()) or 1) for fid, did, t in filas]
        postings: dict[str, list[tuple[int, int]]] = defaultdict(list)
        for pos, (_, _, terms) in enumerate(filas):
            for t, n in (terms or {}).items():
                postings[t].append((pos, int(n)))
        promedio = (sum(f[2] for f in fragmentos) / len(fragmentos)) if fragmentos else 1.0
        indice = _Indice((), fragmentos, dict(postings), promedio)
    else:
        visibles = {d.id: d for d in await documentos_para(db, user)}
        indice = await _indice(db)
    if documento_id:
        visibles = {k: v for k, v in visibles.items() if k == documento_id}
    if not visibles or not indice.fragmentos:
        return []
    total = len(indice.fragmentos)
    puntaje: dict[int, float] = defaultdict(float)
    aciertos: dict[int, int] = defaultdict(int)
    for t in q:
        lista = indice.postings.get(t)
        if not lista:
            continue
        idf = math.log(1 + (total - len(lista) + 0.5) / (len(lista) + 0.5))
        for pos, veces in lista:
            fid, did, largo = indice.fragmentos[pos]
            if did not in visibles:
                continue
            puntaje[pos] += idf * veces * (K1 + 1) / (veces + K1 * (1 - B + B * largo / indice.promedio))
            aciertos[pos] += 1
    if not puntaje:
        return []
    # Pesa también cuántos términos distintos de la consulta aparecen (mejor 3 de 3 que uno solo repetido).
    orden = sorted(puntaje, key=lambda p: -(puntaje[p] * (0.6 + 0.4 * aciertos[p] / len(q))))
    elegidos = orden[:max(1, min(limite, MAX_RESULTADOS))]
    ids = [indice.fragmentos[p][0] for p in elegidos]
    textos = {f.id: f for f in (await db.execute(select(AsistenteFragmento).where(AsistenteFragmento.id.in_(ids)))).scalars()}
    salida = []
    for p in elegidos:
        f = textos.get(indice.fragmentos[p][0])
        if f is None:
            continue
        d = visibles[f.documento_id]
        salida.append({
            "cita": cita(f.id, d.titulo, f.pagina, f.seccion), "fragmento_id": f.id, "documento": d.titulo,
            "documento_id": d.id, "pagina": f.pagina, "seccion": f.seccion, "texto": f.texto,
            "relevancia": round(puntaje[p], 2), "terminos_encontrados": f"{aciertos[p]} de {len(q)}",
        })
    return salida


async def pasaje(db: AsyncSession, user: CurrentUser, fragmento_id: str) -> Optional[dict[str, Any]]:
    """El pasaje exacto de una cita, si la persona puede ver ese documento (si no, como si no existiera)."""
    f = await db.get(AsistenteFragmento, fragmento_id)
    if f is None:
        return None
    fila = (await db.execute(select(AsistenteDocumento, AsistenteDocumento.contenido_gz.is_not(None))
                             .options(defer(AsistenteDocumento.contenido_gz))
                             .where(AsistenteDocumento.id == f.documento_id))).first()
    if fila is None or not puede_ver(fila[0], user):
        return None
    d, con_archivo = fila
    return {"id": f.id, "documento": d.titulo, "documento_id": d.id, "pagina": f.pagina, "seccion": f.seccion,
            "texto": f.texto, "descargable": bool(con_archivo), "archivo": d.archivo_nombre}


def construir_fragmentos(doc: AsistenteDocumento, fragmentos: Iterable[dict[str, Any]]) -> list[AsistenteFragmento]:
    return [AsistenteFragmento(id=nuevo_id(), documento_id=doc.id, orden=i, pagina=f.get("pagina"),
                               seccion=(f.get("seccion") or None) and f["seccion"][:200], texto=f["texto"],
                               terminos=terminos_fragmento(f["texto"], titulo=doc.titulo, seccion=f.get("seccion")))
            for i, f in enumerate(fragmentos)]


async def recalcular_terminos(db: AsyncSession, doc: AsistenteDocumento) -> None:
    """Después de cambiar el título: los términos de cada fragmento lo incluyen."""
    for f in (await db.execute(select(AsistenteFragmento).where(AsistenteFragmento.documento_id == doc.id))).scalars():
        f.terminos = terminos_fragmento(f.texto, titulo=doc.titulo, seccion=f.seccion)
