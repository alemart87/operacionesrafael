"""Publicación de Voi en Claude Managed Agents: entorno, habilidades y agente (con versiones).

Lee los archivos de `claude/` y crea o actualiza lo que cambió (por huella). Cada cambio del agente es una versión nueva
en Anthropic; las conversaciones en curso siguen con la suya. Los ids y versiones quedan en `asistente_config.recursos`.
Corre sola al arrancar (si hay clave) y desde la consola del superadmin («Publicar agente»).
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from . import definicion
from .cliente import cliente
from .config import fila, simulador_activo

log = logging.getLogger("asistente.publicacion")


def _id(obj: Any) -> str:
    return obj["id"] if isinstance(obj, dict) else obj.id


def _version(obj: Any) -> int | None:
    v = obj.get("version") if isinstance(obj, dict) else getattr(obj, "version", None)
    return int(v) if v is not None else None


def cuenta() -> str:
    """Con qué cuenta se publica (huella de la clave, nunca la clave): si cambia, lo publicado no sirve."""
    if simulador_activo():
        return "simulador"
    return hashlib.sha256(settings.anthropic_api_key.encode()).hexdigest()[:12]


async def _existe(fn: Any, *args: Any) -> bool:
    try:
        await fn(*args)
    except Exception as exc:  # noqa: BLE001
        if getattr(exc, "status_code", None) == 404:
            return False
        raise
    return True


async def _verificar(c: Any, rec: dict[str, Any]) -> dict[str, Any]:
    """Descarta lo que ya no existe en Anthropic (borrado desde la consola) o es de otra cuenta: se vuelve a crear."""
    if rec.get("cuenta") != cuenta():
        return {}
    rec = dict(rec)
    if (rec.get("entorno") or {}).get("id") and not await _existe(c.beta.environments.retrieve, rec["entorno"]["id"]):
        rec["entorno"] = {}
    habs = dict(rec.get("habilidades") or {})
    for nombre, h in list(habs.items()):
        if not h.get("id") or not await _existe(c.skills.retrieve, h["id"]):
            habs.pop(nombre)
    rec["habilidades"] = habs
    if (rec.get("agente") or {}).get("id") and not await _existe(c.beta.agents.retrieve, rec["agente"]["id"]):
        rec["agente"] = {}
    return rec


async def _entorno(c: Any, previo: dict[str, Any]) -> dict[str, Any]:
    spec = definicion.entorno()
    h = definicion.huella(spec)
    if previo.get("id") and previo.get("huella") == h:
        return previo
    if previo.get("id"):
        await c.beta.environments.update(previo["id"], config=spec["config"], description=spec.get("description"))
        return {**previo, "huella": h}
    try:
        env = await c.beta.environments.create(name=spec["name"], config=spec["config"], description=spec.get("description"))
    except Exception as exc:  # noqa: BLE001 — el nombre es único: si ya existe (otra instalación), se reutiliza
        if "409" not in str(exc) and "already" not in str(exc).lower():
            raise
        env = None
        async for e in c.beta.environments.list():
            if getattr(e, "name", None) == spec["name"]:
                env = e
                break
        if env is None:
            raise
        await c.beta.environments.update(_id(env), config=spec["config"], description=spec.get("description"))
    return {"id": _id(env), "huella": h}


async def _habilidades(c: Any, previas: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for hab in definicion.habilidades():
        prev = previas.get(hab.nombre) or {}
        archivos = [(f"{hab.nombre}/{ruta}", contenido, "text/markdown" if ruta.endswith(".md") else "text/plain")
                    for ruta, contenido in hab.archivos]
        if prev.get("id") and prev.get("huella") == hab.huella:
            out[hab.nombre] = prev
        elif prev.get("id"):
            v = await c.skills.versions.create(prev["id"], files=archivos)
            out[hab.nombre] = {"id": prev["id"], "version": _version(v) or "latest", "huella": hab.huella}
        else:
            s = await c.skills.create(files=archivos, display_name=f"Voi · {hab.titulo}")
            out[hab.nombre] = {"id": _id(s), "version": _version(s) or "latest", "huella": hab.huella}
    return out


async def publicar(db: AsyncSession, *, por: str = "sistema", forzar: bool = False) -> dict[str, Any]:
    """Crea o actualiza en Anthropic lo que cambió (verificando que lo publicado siga existiendo). Devuelve los recursos."""
    c = cliente()
    row = await fila(db)
    rec = await _verificar(c, dict(row.recursos or {}))
    cambios: list[str] = []

    env = await _entorno(c, rec.get("entorno") or {})
    if env != rec.get("entorno"):
        cambios.append("entorno")
    habs = await _habilidades(c, rec.get("habilidades") or {})
    if habs != rec.get("habilidades"):
        cambios.append("habilidades")
    skills = [{"type": "custom", "skill_id": h["id"], "version": str(h["version"])} for h in habs.values()]
    params = definicion.agente(skills)
    h = definicion.huella(params)
    prev = rec.get("agente") or {}
    if forzar or not prev.get("id") or prev.get("huella") != h:
        if prev.get("id"):
            a = await c.beta.agents.update(prev["id"], **params)
        else:
            a = await c.beta.agents.create(**params)
        prev = {"id": _id(a), "version": _version(a), "huella": h, "modelo": params["model"].get("id"),
                "publicado_at": datetime.now(timezone.utc).isoformat(), "publicado_por": por}
        cambios.append(f"agente v{prev['version']}")
    rec = {**rec, "entorno": env, "habilidades": habs, "agente": prev, "cuenta": cuenta()}
    row.recursos = rec
    await db.commit()
    log.info("Voi publicado: %s", ", ".join(cambios) or "sin cambios")
    return {"cambios": cambios, "recursos": rec}


def listo(rec: dict[str, Any]) -> bool:
    return bool((rec.get("agente") or {}).get("id") and (rec.get("entorno") or {}).get("id"))


def desactualizado(rec: dict[str, Any]) -> bool:
    """La definición del repositorio cambió desde la última publicación (o nunca se publicó, o cambió la cuenta)."""
    if not listo(rec) or rec.get("cuenta") != cuenta():
        return True
    if any((rec.get("habilidades") or {}).get(h.nombre, {}).get("huella") != h.huella for h in definicion.habilidades()):
        return True
    if (rec.get("entorno") or {}).get("huella") != definicion.huella(definicion.entorno()):
        return True
    skills = [{"type": "custom", "skill_id": x["id"], "version": str(x["version"])}
              for x in (rec.get("habilidades") or {}).values()]
    return (rec.get("agente") or {}).get("huella") != definicion.huella(definicion.agente(skills))
