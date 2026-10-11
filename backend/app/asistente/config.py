"""Configuración de Voi: valores por defecto, lectura y guardado (la edita el superadmin desde la consola)."""
from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from .models import AsistenteConfig

NOMBRE = "Voi"
ZONA = ZoneInfo("America/Asuncion")
UTILIDAD = "asistente"                      # la utilidad de cada operativa: `<operativa>.asistente`

# Precios de lista de Claude Sonnet 5.5 (US$ por millón de tokens), para estimar mientras llega el costo oficial.
PRECIOS = {"entrada": 2.0, "salida": 10.0, "cache_lectura": 0.10, "cache_5m": 2.50, "cache_1h": 4.0}

DEFECTO: dict[str, Any] = {
    # Interruptor general. Quién lo usa lo decide la utilidad «Asistente IA» de cada perfil; el superadmin, siempre.
    "habilitado": True,
    "topes": {
        "mensual_usd": 150.0,          # presupuesto del mes de toda la plataforma
        "alerta_pct": 80,              # aviso al superadmin
        "conversacion_usd": 1.0,       # tope duro de cada sesión (lo aplica Anthropic)
        "usuario_dia_usd": 5.0,        # por usuario y día (el superadmin no tiene)
        "mensajes_minuto": 6,          # ráfagas
    },
    "retencion": {"sesion_dias": 30, "copia_meses": 12},
    "autonomia": {"borradores_sin_confirmar": True},
    # Cuánto razona Claude antes de responder (por conversación): low = rápido, medium = equilibrado, high = profundo.
    "modelo": {"esfuerzo": "low"},
}
ESFUERZOS = ("low", "medium", "high")


def _mezclar(base: dict, extra: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        out[k] = _mezclar(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


async def fila(db: AsyncSession) -> AsistenteConfig:
    row = await db.get(AsistenteConfig, 1)
    if row is None:
        row = AsistenteConfig(id=1, data={}, recursos={})
        db.add(row)
        await db.flush()
    return row


async def leer(db: AsyncSession) -> dict[str, Any]:
    row = await db.get(AsistenteConfig, 1)
    return _mezclar(DEFECTO, row.data if row else {})


async def recursos(db: AsyncSession) -> dict[str, Any]:
    row = await db.get(AsistenteConfig, 1)
    return dict(row.recursos or {}) if row else {}


async def guardar(db: AsyncSession, cambios: dict[str, Any], por: str) -> dict[str, Any]:
    row = await fila(db)
    row.data = _mezclar(row.data or {}, cambios)
    row.updated_at, row.updated_by = datetime.now(timezone.utc), por
    await db.commit()
    return _mezclar(DEFECTO, row.data)


def simulador_activo() -> bool:
    """El simulador es solo para desarrollo y demostraciones: en producción nunca reemplaza a Claude."""
    return settings.asistente_simulador and settings.env != "production"


def clave_configurada() -> bool:
    return bool(settings.anthropic_api_key) or simulador_activo()


def centavos(usd: float | None) -> int | None:
    return None if usd is None else max(1, int(round(float(usd) * 100)))


def ahora_local() -> datetime:
    return datetime.now(ZONA)
