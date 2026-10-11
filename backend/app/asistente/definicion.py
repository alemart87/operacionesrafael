"""La definición de Voi como archivos del repositorio (carpeta `claude/`), en el formato de Claude Managed Agents.

- `claude/agents/voi.md`: el agente (YAML arriba con modelo y herramientas del espacio de trabajo; abajo, sus
  instrucciones). Al publicar se le suman las herramientas de la plataforma (`herramientas/`).
- `claude/environments/voi.yaml`: el entorno (contenedor aislado, sin internet).
- `claude/skills/<nombre>/SKILL.md`: las habilidades (Agent Skills) que el agente carga cuando las necesita.

Cada pieza tiene una huella (hash): si no cambió, no se vuelve a publicar; si cambió, se publica una versión nueva.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from ..core.config import settings
from .herramientas import REGISTRO

CARPETA = Path(__file__).resolve().parent / "claude"
TC = "televentas_claro"

# Habilidades que solo se dan a quien tiene el permiso del módulo (las demás, a todos los que usan Voi).
PERMISO_HABILIDAD: dict[str, tuple[str, ...]] = {
    "voi-informe-diario": (f"{TC}.informe_diario",),
    "voi-auditoria-de-ventas": (f"{TC}.auditoria",),
    "voi-productividad-y-sph": (f"{TC}.productividad", f"{TC}.sph"),
    "voi-ventas-netas": (f"{TC}.ventas_netas",),
    "voi-supervision-y-alertas": (f"{TC}.supervision", f"{TC}.tickets"),
}
# Cómo se muestran (consola y Anthropic); el `name` del SKILL.md queda en minúsculas y guiones, como pide el formato.
TITULOS_HABILIDAD = {
    "voi-analisis-de-datos": "Análisis de datos", "voi-auditoria-de-ventas": "Auditoría de ventas",
    "voi-ayuda-plataforma": "Ayuda de la plataforma", "voi-informe-diario": "Informe diario",
    "voi-productividad-y-sph": "Productividad y SPH", "voi-supervision-y-alertas": "Supervisión y alertas",
    "voi-ventas-netas": "Ventas netas",
}
# En modo auditoría Voi se acota a auditoría de ventas y alertas.
HABILIDADES_AUDITOR = {"voi-ayuda-plataforma", "voi-auditoria-de-ventas", "voi-ventas-netas", "voi-supervision-y-alertas",
                       "voi-analisis-de-datos"}


def huella(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()[:16]


def _frontmatter(texto: str) -> tuple[dict[str, Any], str]:
    if not texto.startswith("---"):
        return {}, texto
    _, cabecera, cuerpo = texto.split("---", 2)
    return yaml.safe_load(cabecera) or {}, cuerpo.strip()


@dataclass(frozen=True)
class Habilidad:
    nombre: str
    titulo: str
    descripcion: str
    archivos: tuple[tuple[str, bytes], ...]      # (ruta dentro de la carpeta de la habilidad, contenido)

    @property
    def huella(self) -> str:
        return hashlib.sha256(b"".join(n.encode() + c for n, c in self.archivos)).hexdigest()[:16]


@lru_cache(maxsize=1)
def habilidades() -> tuple[Habilidad, ...]:
    out = []
    for d in sorted(p for p in (CARPETA / "skills").iterdir() if (p / "SKILL.md").is_file()):
        meta, _ = _frontmatter((d / "SKILL.md").read_text(encoding="utf-8"))
        archivos = tuple((str(f.relative_to(d)), f.read_bytes()) for f in sorted(d.rglob("*")) if f.is_file())
        out.append(Habilidad(nombre=d.name, titulo=TITULOS_HABILIDAD.get(d.name, str(meta.get("name") or d.name)),
                             descripcion=str(meta.get("description") or ""), archivos=archivos))
    return tuple(out)


@lru_cache(maxsize=1)
def entorno() -> dict[str, Any]:
    return yaml.safe_load((CARPETA / "environments" / "voi.yaml").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _agente_archivo() -> tuple[dict[str, Any], str]:
    return _frontmatter((CARPETA / "agents" / "voi.md").read_text(encoding="utf-8"))


def toolset() -> list[dict[str, Any]]:
    """Las herramientas del espacio de trabajo tal como están en voi.md."""
    meta, _ = _agente_archivo()
    return list(meta.get("tools") or [])


def modelo() -> dict[str, Any]:
    meta, _ = _agente_archivo()
    m = meta.get("model") or {}
    m = {"id": m} if isinstance(m, str) else dict(m)
    if settings.asistente_modelo:
        m["id"] = settings.asistente_modelo
    return m


def agente(skills: list[dict[str, Any]]) -> dict[str, Any]:
    """Los parámetros de `agents.create/update`: el archivo + las herramientas de la plataforma + las habilidades."""
    meta, cuerpo = _agente_archivo()
    herramientas = [h.definicion() for h in sorted(REGISTRO.values(), key=lambda h: h.nombre)]
    return {
        "name": meta.get("name", "Voi"),
        "description": meta.get("description", ""),
        "model": modelo(),
        "system": cuerpo,
        "tools": [*toolset(), *herramientas],
        "skills": skills,
        "metadata": {k: str(v) for k, v in (meta.get("metadata") or {}).items()},
    }
