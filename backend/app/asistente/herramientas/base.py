"""Base del puente de herramientas: cómo se declara una herramienta, quién la puede usar y cómo se ejecuta.

Las herramientas son las «custom tools» del agente: Claude decide usarlas, la sesión de Managed Agents queda esperando y
esta plataforma las ejecuta con la identidad y los permisos de quien es dueño de la conversación (releídos en cada
llamada: si el superadmin le saca un permiso, deja de valer al instante). Nunca se toma al usuario de lo que dice el
modelo. Por dentro llaman a los mismos servicios que las pantallas, así respetan las mismas reglas (por ejemplo: quien no
tiene «Gestión» solo ve informes publicados).

Niveles de autonomía:
1. Consultar: corre sola.
2. Lo propio (borradores, cosas del usuario): corre sola y queda registrada (configurable: puede pedir confirmación).
3. Afecta a otros o a datos oficiales: la plataforma muestra una tarjeta y espera la confirmación del usuario.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Awaitable, Callable, Iterable, Optional

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from ...api.deps import CurrentUser

CONSULTAR, PROPIO, CONFIRMAR = 1, 2, 3
MODOS = frozenset({"superadmin", "gestion", "auditor"})
TC = "televentas_claro"


class ErrorHerramienta(Exception):
    """Lo que no se pudo hacer, explicado para que el modelo lo entienda y lo cuente (no es un error del sistema)."""


@dataclass(frozen=True)
class Herramienta:
    nombre: str
    etiqueta: str                               # lo que ve el usuario mientras corre («Consultando productividad»)
    descripcion: str                            # para el modelo: qué hace y CUÁNDO usarla
    esquema: dict[str, Any]
    fn: Callable[["Ctx", dict[str, Any]], Awaitable[Any]]
    nivel: int = CONSULTAR
    permisos: tuple[str, ...] = ()              # alcanza con uno
    todos: tuple[str, ...] = ()                 # además, todos estos
    modos: frozenset[str] = MODOS
    # Para la tarjeta de confirmación: qué va a hacer, en palabras del usuario (puede leer nombres de la base).
    resumen: Optional[Callable[["Ctx", dict[str, Any]], Awaitable[str]]] = None
    # Al crear la sesión: la descripción para esta persona (p. ej. con los documentos que puede consultar) o None para
    # no darle la herramienta (no hay nada que consultar).
    preparar: Optional[Callable[[AsyncSession, CurrentUser], Awaitable[Optional[str]]]] = None
    # Para acciones con elección (nivel 3): lo que muestra la tarjeta además del resumen (p. ej. las piezas propuestas)…
    tarjeta: Optional[Callable[[dict[str, Any]], dict[str, Any]]] = None
    # …y cómo se aplica lo que el usuario eligió en ella al confirmar (devuelve la entrada final, o None si no eligió
    # nada). Solo puede achicar o retocar lo propuesto; ErrorHerramienta si lo elegido no es válido.
    ajustar: Optional[Callable[[dict[str, Any], dict[str, Any]], Optional[dict[str, Any]]]] = None
    # Consultas cuyo resultado la conversación necesita después (p. ej. la guía que se mostró): se guarda en la acción.
    guardar_resultado: bool = False

    def disponible(self, user: CurrentUser, modo: str) -> bool:
        return (modo in self.modos
                and (not self.permisos or any(user.has_perm(p) for p in self.permisos))
                and all(user.has_perm(p) for p in self.todos))

    def definicion(self) -> dict[str, Any]:
        return {"type": "custom", "name": self.nombre, "description": self.descripcion, "input_schema": self.esquema}


@dataclass
class Ctx:
    db: AsyncSession
    user: CurrentUser
    conversacion_id: str
    extra: dict[str, Any] = field(default_factory=dict)

    def request(self) -> Request:
        """Un pedido mínimo para los servicios que auditan la IP y el navegador: queda marcado como Voi."""
        return Request({"type": "http", "method": "POST", "path": "/asistente", "query_string": b"",
                        "headers": [(b"user-agent", b"Voi (asistente de la plataforma)")], "client": ("asistente", 0)})


REGISTRO: dict[str, Herramienta] = {}


def registrar(h: Herramienta) -> Herramienta:
    if h.nombre in REGISTRO:
        raise ValueError(f"Herramienta repetida: {h.nombre}")
    REGISTRO[h.nombre] = h
    return h


def para_usuario(user: CurrentUser, modo: str) -> list[Herramienta]:
    """Las herramientas que esta persona puede usar, en orden fijo (el orden estable ayuda a la caché del modelo)."""
    return sorted((h for h in REGISTRO.values() if h.disponible(user, modo)), key=lambda h: h.nombre)


def esquema(propiedades: dict[str, Any] | None = None, requeridas: Iterable[str] = ()) -> dict[str, Any]:
    return {"type": "object", "properties": propiedades or {}, "required": list(requeridas), "additionalProperties": False}


# ------------------------------------------------------------------ llamadas a los servicios de la plataforma
async def llamar(fn, **kw) -> Any:
    """Llama a un endpoint de la plataforma como lo haría la pantalla. Un rechazo de negocio (4xx) vuelve como
    ErrorHerramienta con el mismo mensaje que vería el usuario."""
    try:
        return await fn(**kw)
    except HTTPException as exc:
        detalle = exc.detail
        if isinstance(detalle, dict):
            detalle = detalle.get("message") or detalle.get("detail") or json.dumps(detalle, ensure_ascii=False)
        raise ErrorHerramienta(str(detalle)) from exc


def fecha(valor: Any, nombre: str = "fecha", defecto: date | None = None) -> date:
    if valor in (None, ""):
        if defecto is None:
            raise ErrorHerramienta(f"Falta {nombre} (AAAA-MM-DD)")
        return defecto
    try:
        return date.fromisoformat(str(valor)[:10])
    except ValueError as exc:
        raise ErrorHerramienta(f"{nombre} inválida: usá el formato AAAA-MM-DD") from exc


def periodo(valor: Any, defecto: str | None = None) -> str:
    if valor in (None, ""):
        if defecto is None:
            raise ErrorHerramienta("Falta el mes (AAAA-MM)")
        return defecto
    v = str(valor)[:7]
    try:
        datetime.strptime(v, "%Y-%m")
    except ValueError as exc:
        raise ErrorHerramienta("Mes inválido: usá el formato AAAA-MM") from exc
    return v


def texto(valor: Any, nombre: str, minimo: int = 0, maximo: int = 2000) -> str:
    v = (str(valor) if valor is not None else "").strip()
    if len(v) < minimo:
        raise ErrorHerramienta(f"Falta {nombre}" if not v else f"{nombre} es muy corto (mínimo {minimo} caracteres)")
    return v[:maximo]


# ------------------------------------------------------------------ resultados compactos para el modelo
def compactar(obj: Any, *, max_lista: int = 25, prof: int = 0, max_prof: int = 6) -> Any:
    """Achica lo que vuelve al modelo: listas largas con «y N más», números redondeados, textos acotados."""
    if prof > max_prof:
        return "…"
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return round(obj, 2)
    if isinstance(obj, str):
        return obj if len(obj) <= 600 else obj[:600] + "…"
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: compactar(v, max_lista=max_lista, prof=prof + 1, max_prof=max_prof) for k, v in obj.items()
                if v is not None and k not in _OMITIR}
    if isinstance(obj, (list, tuple)):
        items = [compactar(v, max_lista=max_lista, prof=prof + 1, max_prof=max_prof) for v in list(obj)[:max_lista]]
        if len(obj) > max_lista:
            items.append(f"… y {len(obj) - max_lista} más")
        return items
    if hasattr(obj, "model_dump"):
        return compactar(obj.model_dump(mode="json"), max_lista=max_lista, prof=prof, max_prof=max_prof)
    return obj


# Datos de pantalla que no le sirven al modelo (permisos de botones, listas de nombres de usuarios, etc.).
_OMITIR = frozenset({"usuarios", "puede_gestionar", "puede_actuar", "puede_derivar", "puede_enviar", "tipos_ticket",
                     "tipo_revision", "plazos", "es_superadmin"})


def seleccionar(d: dict[str, Any], claves: Iterable[str]) -> dict[str, Any]:
    return {k: d[k] for k in claves if k in d}


def horas(segundos: Any) -> float | None:
    return None if segundos is None else round(float(segundos) / 3600, 1)
