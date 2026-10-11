"""Imágenes que suben los usuarios (p. ej. la evidencia de un informe de auditoría).

Corre dentro de un subproceso aislado (`app.jobs.isolated.run_isolated`): una imagen dañada o armada para romper el
decodificador (o una «bomba» de millones de píxeles) mata el subproceso, no la API. Por eso solo usa Pillow y la
biblioteca estándar.

`procesar(contenido)` valida que sea una imagen real (PNG, JPG, WebP o GIF), la endereza según la cámara, le saca
TODOS los metadatos (EXIF: ubicación, dispositivo, fecha) y la vuelve a codificar en WebP: una versión completa (hasta
2.400 px) y una miniatura (hasta 720 px). Nunca se guarda el archivo original tal como llegó.
"""
from __future__ import annotations

import io
from typing import Any

FORMATOS = {"PNG": "PNG", "JPEG": "JPG", "WEBP": "WebP", "GIF": "GIF", "MPO": "JPG"}
MAX_PIXELES = 60_000_000          # 60 megapíxeles: más es una foto absurda o una «bomba» de descompresión
LADO_COMPLETA = 2400
LADO_MINIATURA = 720


class ImagenInvalida(ValueError):
    """Lo que no se pudo usar, explicado para quien la subió."""


def _webp(imagen: Any, *, sin_perdida: bool, calidad: int) -> bytes:
    buf = io.BytesIO()
    if sin_perdida:
        imagen.save(buf, "WEBP", lossless=True, quality=80, method=4)
    else:
        imagen.save(buf, "WEBP", quality=calidad, method=4)
    return buf.getvalue()


def procesar(contenido: bytes) -> dict[str, Any]:
    from PIL import Image, ImageOps

    Image.MAX_IMAGE_PIXELS = MAX_PIXELES
    try:
        with Image.open(io.BytesIO(contenido)) as prueba:
            formato = prueba.format
            prueba.verify()                      # estructura completa del archivo (sin decodificar todo)
    except Image.DecompressionBombError as exc:
        raise ImagenInvalida("La imagen es demasiado grande (más de 60 megapíxeles).") from exc
    except Exception as exc:  # noqa: BLE001
        raise ImagenInvalida("El archivo no es una imagen válida: subí un PNG, JPG, WebP o GIF.") from exc
    if formato not in FORMATOS:
        raise ImagenInvalida("Formato de imagen no admitido: subí un PNG, JPG, WebP o GIF.")
    try:
        with Image.open(io.BytesIO(contenido)) as original:
            original.seek(0)                     # GIF animado: el primer cuadro
            imagen = ImageOps.exif_transpose(original)
            imagen.load()
            alfa = imagen.mode in ("RGBA", "LA", "PA") or (imagen.mode == "P" and "transparency" in imagen.info)
            imagen = imagen.convert("RGBA" if alfa else "RGB")   # copia sin metadatos ni paleta
            imagen.info = {}                                       # ni EXIF, ni XMP, ni perfiles: nada viaja
    except Image.DecompressionBombError as exc:
        raise ImagenInvalida("La imagen es demasiado grande (más de 60 megapíxeles).") from exc
    except Exception as exc:  # noqa: BLE001
        raise ImagenInvalida("La imagen está dañada y no se pudo leer.") from exc
    if min(imagen.size) < 8:
        raise ImagenInvalida("La imagen es demasiado chica.")
    # Capturas de pantalla y gráficos (PNG, GIF) van sin pérdida: textos nítidos; las fotos, con compresión.
    sin_perdida = formato in ("PNG", "GIF")
    completa = imagen.copy()
    completa.thumbnail((LADO_COMPLETA, LADO_COMPLETA), Image.Resampling.LANCZOS)
    miniatura = imagen.copy()
    miniatura.thumbnail((LADO_MINIATURA, LADO_MINIATURA), Image.Resampling.LANCZOS)
    return {
        "completa": _webp(completa, sin_perdida=sin_perdida, calidad=88),
        "miniatura": _webp(miniatura, sin_perdida=False, calidad=80),
        "ancho": completa.size[0], "alto": completa.size[1], "formato_origen": FORMATOS[formato],
    }
