"""Figuras del informe diario: piezas del lienzo de Voi (gráficos, indicadores, tablas) que el autor suma a su informe
mientras es borrador, con la especificación congelada (en la pantalla se vuelven a dibujar igual) y, cuando el navegador
la captura, una imagen para el PDF; y las imágenes que sube el autor (capturas, fotos), como la evidencia del informe de
auditoría. Las imágenes van al disco persistente, procesadas sin metadatos.

Viven en la columna JSON `figuras` del informe, en orden:
  [{"id", "tipo": grafico | imagen, "titulo", "nota", "spec" (solo gráfico), "origen": voi | lienzo | subida,
    "conversacion_id", "artefacto_id", "imagen": ruta relativa a UPLOAD_DIR o None, "ancho", "alto", "archivo_nombre",
    "imagen_sha256", "created_at", "created_by"}]
Solo el autor las cambia y solo mientras el informe es borrador; al firmar quedan en el código de verificación (la
huella de una imagen subida también).
"""
from __future__ import annotations

import asyncio
import hashlib
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from ....core.config import settings
from .models import BORRADOR, InformeDiario, gen_uuid

MAX_FIGURAS = 20
MAX_IMAGEN_MB = 15


class FiguraError(ValueError):
    def __init__(self, mensaje: str, codigo: int = 409):
        super().__init__(mensaje)
        self.codigo = codigo


def listar(inf: InformeDiario) -> list[dict[str, Any]]:
    return [f for f in (inf.figuras or []) if isinstance(f, dict) and f.get("id")]


def exigir_editable(inf: InformeDiario, user_id: str) -> None:
    if inf.autor_id != user_id:
        raise FiguraError("Solo el autor del informe puede cambiar sus figuras.", 403)
    if inf.estado != BORRADOR:
        raise FiguraError(f"El informe del {inf.fecha:%d/%m} ya está firmado: no se cambia.", 409)


def buscar(inf: InformeDiario, figura_id: str) -> dict[str, Any]:
    f = next((x for x in listar(inf) if x["id"] == figura_id), None)
    if f is None:
        raise FiguraError("Figura no encontrada.", 404)
    return f


def numero(inf: InformeDiario, figura_id: str) -> Optional[int]:
    for i, f in enumerate(listar(inf), 1):
        if f["id"] == figura_id:
            return i
    return None


def sumar(inf: InformeDiario, spec: dict[str, Any], *, user_id: str, titulo: Optional[str] = None,
          nota: Optional[str] = None, origen: str = "lienzo", conversacion_id: Optional[str] = None,
          artefacto_id: Optional[str] = None) -> tuple[dict[str, Any], bool]:
    """Suma una pieza del lienzo (ya validada) como figura. Devuelve (figura, nueva): la misma pieza no se duplica."""
    exigir_editable(inf, user_id)
    figs = listar(inf)
    if artefacto_id:
        previa = next((f for f in figs if f.get("artefacto_id") == artefacto_id), None)
        if previa is not None:
            return previa, False
    _exigir_lugar(figs)
    f = {"id": gen_uuid(), "tipo": "grafico", "titulo": (titulo or spec.get("titulo") or "Figura")[:255].strip() or "Figura",
         "nota": (nota or "").strip()[:4000] or None, "spec": spec,
         "origen": origen if origen in ("voi", "lienzo") else "lienzo", "conversacion_id": conversacion_id,
         "artefacto_id": artefacto_id, "imagen": None, "ancho": None, "alto": None,
         "created_at": datetime.now(timezone.utc).isoformat(), "created_by": user_id}
    inf.figuras = [*figs, f]                      # lista nueva: SQLAlchemy detecta el cambio del JSON
    return f, True


def _exigir_lugar(figs: list[dict[str, Any]]) -> None:
    if len(figs) >= MAX_FIGURAS:
        raise FiguraError(f"El informe admite hasta {MAX_FIGURAS} figuras: quitá alguna para sumar otra.")


def crear_imagen(inf: InformeDiario, *, user_id: str, webp: bytes, ancho: Optional[int], alto: Optional[int],
                 titulo: Optional[str] = None, nota: Optional[str] = None,
                 archivo_nombre: Optional[str] = None) -> dict[str, Any]:
    """Una captura o foto del autor como figura: ya procesada (WebP sin metadatos), queda en el disco persistente y su
    huella entra en el código de verificación. Lanza OSError si el disco falla."""
    exigir_editable(inf, user_id)
    figs = listar(inf)
    _exigir_lugar(figs)
    nombre = (archivo_nombre or "").strip()[:255] or None
    base = Path(nombre).stem.strip() if nombre else ""
    fid = gen_uuid()
    rel = f"informe_diario/{inf.id}/{fid}.webp"
    destino = ruta(rel)
    if destino is None:                           # pragma: no cover - UPLOAD_DIR mal configurado
        raise OSError("Almacenamiento no disponible")
    _escribir(destino, webp)
    f = {"id": fid, "tipo": "imagen", "titulo": ((titulo or "").strip() or base or "Imagen")[:255],
         "nota": (nota or "").strip()[:4000] or None, "spec": None, "origen": "subida", "conversacion_id": None,
         "artefacto_id": None, "imagen": rel, "ancho": ancho, "alto": alto, "archivo_nombre": nombre,
         "imagen_sha256": hashlib.sha256(webp).hexdigest(),
         "created_at": datetime.now(timezone.utc).isoformat(), "created_by": user_id}
    inf.figuras = [*figs, f]
    return f


def editar(inf: InformeDiario, figura_id: str, user_id: str, *, titulo: Optional[str] = None,
           nota: Optional[str] = None) -> dict[str, Any]:
    exigir_editable(inf, user_id)
    f = dict(buscar(inf, figura_id))
    if titulo is not None:
        f["titulo"] = titulo.strip()[:255] or f["titulo"]
    if nota is not None:
        f["nota"] = nota.strip()[:4000] or None
    inf.figuras = [f if x["id"] == figura_id else x for x in listar(inf)]
    return f


def quitar(inf: InformeDiario, figura_id: str, user_id: str) -> dict[str, Any]:
    exigir_editable(inf, user_id)
    f = buscar(inf, figura_id)
    inf.figuras = [x for x in listar(inf) if x["id"] != figura_id]
    _borrar_archivo(f.get("imagen"))
    return f


# ------------------------------------------------------------------ imágenes para el PDF (disco persistente)
def carpeta(informe_id: str) -> Path:
    return settings.upload_path / "informe_diario" / informe_id


def ruta(relativa: Optional[str]) -> Optional[Path]:
    """La ruta absoluta de un archivo guardado, solo si queda dentro de UPLOAD_DIR."""
    if not relativa:
        return None
    base = settings.upload_path.resolve()
    p = (base / relativa).resolve()
    return p if p.is_relative_to(base) else None


def _escribir(destino: Path, datos: bytes) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(destino.suffix + ".tmp")
    tmp.write_bytes(datos)
    tmp.replace(destino)


def _borrar_archivo(relativa: Optional[str]) -> None:
    p = ruta(relativa)
    if p is not None:
        try:
            p.unlink(missing_ok=True)
        except OSError:
            pass


def guardar_imagen(inf: InformeDiario, figura_id: str, user_id: str, webp: bytes, ancho: Optional[int],
                   alto: Optional[int]) -> dict[str, Any]:
    """Guarda la captura de la figura (ya procesada) y la deja referenciada. Lanza OSError si el disco falla."""
    exigir_editable(inf, user_id)
    f = dict(buscar(inf, figura_id))
    rel = f"informe_diario/{inf.id}/{figura_id}.webp"
    destino = ruta(rel)
    if destino is None:                           # pragma: no cover - UPLOAD_DIR mal configurado
        raise OSError("Almacenamiento no disponible")
    _escribir(destino, webp)
    f.update({"imagen": rel, "ancho": ancho, "alto": alto, "imagen_sha256": hashlib.sha256(webp).hexdigest()})
    inf.figuras = [f if x["id"] == figura_id else x for x in listar(inf)]
    return f


async def borrar_archivos(informe_id: str) -> None:
    p = carpeta(informe_id)
    if p.exists():
        await asyncio.to_thread(shutil.rmtree, p, True)


# ------------------------------------------------------------------ lo que ve cada uno
def figura_dict(f: dict[str, Any], n: int) -> dict[str, Any]:
    return {"id": f["id"], "figura": n, "tipo": f.get("tipo") or "grafico", "titulo": f.get("titulo"), "nota": f.get("nota"),
            "spec": f.get("spec") or None, "origen": f.get("origen"), "artefacto_id": f.get("artefacto_id"),
            "archivo_nombre": f.get("archivo_nombre"), "ancho": f.get("ancho"), "alto": f.get("alto"),
            "created_at": f.get("created_at"), "imagen": bool(f.get("imagen"))}


def para_dict(inf: InformeDiario) -> list[dict[str, Any]]:
    return [figura_dict(f, i) for i, f in enumerate(listar(inf), 1)]


def para_pdf(inf: InformeDiario) -> list[dict[str, Any]]:
    """Como `para_dict`, más la ruta absoluta de la imagen capturada (si existe en el disco)."""
    out = []
    for i, f in enumerate(listar(inf), 1):
        d = figura_dict(f, i)
        p = ruta(f.get("imagen"))
        d["imagen_ruta"] = str(p) if p is not None and p.exists() else None
        out.append(d)
    return out


def para_hash(inf: InformeDiario) -> list[dict[str, Any]]:
    """Lo que entra en el código de verificación: el contenido de cada figura (de un gráfico, su especificación; de una
    imagen subida, la huella del archivo)."""
    return [{k: f.get(k) for k in ("id", "tipo", "titulo", "nota", "spec", "artefacto_id", "imagen_sha256")} for f in listar(inf)]
