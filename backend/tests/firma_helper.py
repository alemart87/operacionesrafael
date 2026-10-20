"""Ayudas para los tests del coaching con devolución firmada: una firma dibujada válida y la firma del asesor."""
from __future__ import annotations

import base64
import io

from PIL import Image, ImageDraw

BASE = "/api/v1/televentas-claro/supervision"


def png(ancho: int = 220, alto: int = 70) -> str:
    """Una firma dibujada (PNG con transparencia), como la que manda el celular."""
    im = Image.new("RGBA", (ancho, alto), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.line([(10, alto - 15), (60, 15), (110, alto - 20), (160, 20), (ancho - 10, alto - 25)], fill=(15, 17, 22, 255), width=4)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


async def firmar(ac, headers, coaching_id: str, **extra) -> dict:
    """El asesor acepta y firma (y el supervisor con su firma dibujada)."""
    r = await ac.post(f"{BASE}/portal/coaching/{coaching_id}/firmar", headers=headers,
                      json={"imagen": png(), "acepto": True, "imagen_supervisor": png(180, 60), **extra})
    assert r.status_code == 200, r.text
    return r.json()
