"""Simulador de Claude Managed Agents para pruebas y demostraciones (`ASISTENTE_SIMULADOR=true`).

Imita lo que Voi usa del SDK oficial (`anthropic`): entornos, habilidades, agentes con versiones, memory stores,
sesiones y sus eventos (enviar, stream con vista previa del texto y lista), con la misma forma de datos. Un «agente» de
reglas simples decide por palabras clave qué herramienta de la plataforma pedir, espera el resultado (o la confirmación
del usuario) y responde. Nunca llama a Anthropic ni a internet. No es para producción: ahí responde Claude.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import unicodedata
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Optional

from .config import PRECIOS, ahora_local

log = logging.getLogger("asistente.simulador")

AVISO = "_(Respuesta del simulador de Voi para pruebas. Con la clave de Anthropic responde Claude.)_"
EVENTOS_USUARIO = {"user.message", "user.interrupt", "user.custom_tool_result", "user.tool_confirmation",
                   "system.message", "user.define_outcome"}


def _id(prefijo: str) -> str:
    return f"{prefijo}_{uuid.uuid4().hex[:24]}"


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


def _iso(d: datetime) -> str:
    return d.isoformat().replace("+00:00", "Z")


def _norm(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", t or "") if unicodedata.category(c) != "Mn").lower()


def _texto(content: Any) -> str:
    return "".join(b.get("text", "") for b in (content or []) if isinstance(b, dict) and b.get("type") == "text"
                   and not str(b.get("text", "")).startswith("<contexto_plataforma>"))


class ErrorSimulado(Exception):
    def __init__(self, status_code: int, mensaje: str):
        super().__init__(mensaje)
        self.status_code = status_code


class _Iter:
    """Iterador asíncrono sobre una lista (como los paginadores del SDK)."""

    def __init__(self, items: list[Any]):
        self._it = iter(list(items))

    def __aiter__(self) -> "_Iter":
        return self

    async def __anext__(self) -> Any:
        try:
            return next(self._it)
        except StopIteration as exc:
            raise StopAsyncIteration from exc


# ------------------------------------------------------------------ recursos simples
class _Entornos:
    def __init__(self, sim: "ClienteSimulado"):
        self.sim = sim

    async def create(self, *, name: str, config: Any = None, description: Any = None, **_: Any) -> SimpleNamespace:
        if any(e.name == name for e in self.sim.entornos.values()):
            raise ErrorSimulado(409, f"409 environment name already exists: {name}")
        e = SimpleNamespace(id=_id("env"), name=name, config=config, description=description)
        self.sim.entornos[e.id] = e
        return e

    async def update(self, environment_id: str, **kw: Any) -> SimpleNamespace:
        e = self.retrieve_sync(environment_id)
        for k, v in kw.items():
            setattr(e, k, v)
        return e

    def retrieve_sync(self, environment_id: str) -> SimpleNamespace:
        if environment_id not in self.sim.entornos:
            raise ErrorSimulado(404, "environment not found")
        return self.sim.entornos[environment_id]

    async def retrieve(self, environment_id: str, **_: Any) -> SimpleNamespace:
        return self.retrieve_sync(environment_id)

    def list(self, **_: Any) -> _Iter:
        return _Iter(list(self.sim.entornos.values()))


class _VersionesHabilidad:
    def __init__(self, sim: "ClienteSimulado"):
        self.sim = sim

    async def create(self, skill_id: str, *, files: Any, **_: Any) -> SimpleNamespace:
        h = self.sim.habilidades.get(skill_id)
        if h is None:
            raise ErrorSimulado(404, "skill not found")
        h.version += 1
        return SimpleNamespace(id=_id("skillver"), skill_id=skill_id, version=h.version)


class _Habilidades:
    def __init__(self, sim: "ClienteSimulado"):
        self.sim = sim
        self.versions = _VersionesHabilidad(sim)

    async def create(self, *, files: Any, display_name: Optional[str] = None, **_: Any) -> SimpleNamespace:
        h = SimpleNamespace(id=_id("skill"), display_name=display_name, version=1, archivos=len(list(files or [])))
        self.sim.habilidades[h.id] = h
        return h

    async def retrieve(self, skill_id: str, **_: Any) -> SimpleNamespace:
        if skill_id not in self.sim.habilidades:
            raise ErrorSimulado(404, "skill not found")
        return self.sim.habilidades[skill_id]


class _Agentes:
    def __init__(self, sim: "ClienteSimulado"):
        self.sim = sim

    async def create(self, **params: Any) -> SimpleNamespace:
        a = SimpleNamespace(id=_id("agent"), version=1, **{k: v for k, v in params.items() if k not in ("betas",)})
        self.sim.agentes[a.id] = a
        return a

    async def update(self, agent_id: str, **params: Any) -> SimpleNamespace:
        a = await self.retrieve(agent_id)
        for k, v in params.items():
            if k not in ("betas", "version"):
                setattr(a, k, v)
        a.version += 1
        return a

    async def retrieve(self, agent_id: str, **_: Any) -> SimpleNamespace:
        if agent_id not in self.sim.agentes:
            raise ErrorSimulado(404, "agent not found")
        return self.sim.agentes[agent_id]


class _Memorias:
    def __init__(self, sim: "ClienteSimulado"):
        self.sim = sim

    def list(self, memory_store_id: str, *, view: str = "basic", limit: int = 20, **_: Any) -> _Iter:
        if view == "full" and limit > 20:          # como la API: con view=full el máximo por página es 20
            raise ErrorSimulado(400, "limit must be at most 20 when view=full")
        return _Iter(list(self.sim.memorias.get(memory_store_id, {}).values()))

    async def delete(self, memory_id: str, *, memory_store_id: str, **_: Any) -> SimpleNamespace:
        if self.sim.memorias.get(memory_store_id, {}).pop(memory_id, None) is None:
            raise ErrorSimulado(404, "memory not found")
        return SimpleNamespace(id=memory_id, type="memory_deleted")


class _MemoryStores:
    def __init__(self, sim: "ClienteSimulado"):
        self.sim = sim
        self.memories = _Memorias(sim)

    async def create(self, *, name: str, description: str = "", metadata: Any = None, **_: Any) -> SimpleNamespace:
        m = SimpleNamespace(id=_id("memstore"), name=name, description=description, metadata=metadata or {})
        self.sim.memorias[m.id] = {}
        return m

    async def retrieve(self, memory_store_id: str, **_: Any) -> SimpleNamespace:
        if memory_store_id not in self.sim.memorias:
            raise ErrorSimulado(404, "memory store not found")
        return SimpleNamespace(id=memory_store_id)


# ------------------------------------------------------------------ sesiones
@dataclass
class _Sesion:
    id: str
    herramientas: set[str]
    memoria_id: Optional[str]
    tope: Optional[int]
    metadata: dict[str, Any]
    estado: str = "idle"
    log: list[tuple[datetime, dict[str, Any]]] = field(default_factory=list)
    subs: set[Any] = field(default_factory=set)
    cola: Optional[asyncio.Queue] = None
    tarea: Optional[asyncio.Task] = None
    turno: Optional[dict[str, Any]] = None
    uso: dict[str, float] = field(default_factory=lambda: {"input_tokens": 0, "output_tokens": 0,
                                                           "cache_read_input_tokens": 0, "active_seconds": 0.0})
    costo: int = 0
    contexto: str = ""                      # el último system.message (p. ej. «MODO AUDITOR ACTIVO»)


class _Stream:
    def __init__(self, s: _Sesion, deltas: bool):
        self.s, self.deltas, self.cola, self.cerrado = s, deltas, asyncio.Queue(), False
        s.subs.add(self)

    def __aiter__(self) -> "_Stream":
        return self

    async def __anext__(self) -> dict[str, Any]:
        if self.cerrado:
            raise StopAsyncIteration
        ev = await self.cola.get()
        if ev is None:
            raise StopAsyncIteration
        return ev

    async def close(self) -> None:
        self.cerrado = True
        self.s.subs.discard(self)
        self.cola.put_nowait(None)


class _Eventos:
    def __init__(self, sim: "ClienteSimulado"):
        self.sim = sim

    async def send(self, session_id: str, *, events: Any, **_: Any) -> SimpleNamespace:
        s = self.sim.sesion(session_id)
        evs = list(events)
        for e in evs:
            if e.get("type") not in EVENTOS_USUARIO:
                raise ErrorSimulado(400, f"invalid event type: {e.get('type')}")
        if s.cola is None:
            s.cola = asyncio.Queue()
        enviados = []
        for e in evs:
            ev = self.sim.emitir(s, {**e})
            enviados.append(ev)
            if e["type"] == "system.message":
                s.contexto = " ".join(b.get("text", "") for b in e.get("content") or [] if isinstance(b, dict))
            if e["type"] == "user.message":
                s.cola.put_nowait(("mensaje", ev))
            elif e["type"] == "user.custom_tool_result":
                s.cola.put_nowait(("resultado", ev))
            elif e["type"] == "user.interrupt":
                s.cola.put_nowait(("interrupcion", ev))
        if s.tarea is None or s.tarea.done():
            s.tarea = asyncio.create_task(self.sim.trabajar(s))
        return SimpleNamespace(data=enviados)

    async def stream(self, session_id: str, *, event_deltas: Any = None, **_: Any) -> _Stream:
        return _Stream(self.sim.sesion(session_id), bool(event_deltas))

    def list(self, session_id: str, *, created_at_gte: Any = None, **_: Any) -> _Iter:
        s = self.sim.sesion(session_id)
        desde = None
        if created_at_gte:
            desde = datetime.fromisoformat(str(created_at_gte).replace("Z", "+00:00"))
        return _Iter([ev for t, ev in s.log if desde is None or t >= desde])


class _Sesiones:
    def __init__(self, sim: "ClienteSimulado"):
        self.sim = sim
        self.events = _Eventos(sim)

    async def create(self, *, agent: Any, environment_id: str, resources: Any = None, budget: Any = None,
                     metadata: Any = None, title: Any = None, betas: Any = None, **_: Any) -> SimpleNamespace:
        if betas and any(str(b).startswith("agent-memory-") for b in betas):
            # Como la API: el SDK ya manda «managed-agents-…» y no se puede combinar con el de memoria.
            raise ErrorSimulado(400, "anthropic-beta header cannot combine 'agent-memory-2026-07-22' with "
                                     "'managed-agents-*' values. Use only one.")
        if environment_id not in self.sim.entornos:
            raise ErrorSimulado(404, "environment not found")
        ag = agent if isinstance(agent, dict) else {"id": agent}
        if ag.get("id") not in self.sim.agentes:
            raise ErrorSimulado(404, "agent not found")
        tools = ag.get("tools") if "tools" in ag else getattr(self.sim.agentes[ag["id"]], "tools", [])
        nombres = {t["name"] for t in tools or [] if t.get("type") == "custom"}
        memoria = next((r["memory_store_id"] for r in resources or [] if r.get("type") == "memory_store"), None)
        if memoria and memoria not in self.sim.memorias:
            raise ErrorSimulado(404, "memory store not found")
        tope = int((budget or {}).get("max_list_cost", {}).get("amount") or 0) or None
        s = _Sesion(id=_id("sesn"), herramientas=nombres, memoria_id=memoria, tope=tope, metadata=metadata or {})
        self.sim.sesiones[s.id] = s
        return SimpleNamespace(id=s.id, status="idle", title=title)

    async def retrieve(self, session_id: str, **_: Any) -> SimpleNamespace:
        s = self.sim.sesion(session_id)
        return SimpleNamespace(id=s.id, status=s.estado)

    async def delete(self, session_id: str, **_: Any) -> SimpleNamespace:
        s = self.sim.sesion(session_id)
        s.estado = "terminated"
        self.sim.emitir(s, {"type": "session.deleted"})
        self.sim.sesiones.pop(session_id, None)
        return SimpleNamespace(id=session_id, type="session_deleted")


# ------------------------------------------------------------------ el cliente
class ClienteSimulado:
    def __init__(self) -> None:
        self.demora = float(os.environ.get("ASISTENTE_SIMULADOR_DEMORA", "0.35"))
        self.entornos: dict[str, Any] = {}
        self.habilidades: dict[str, Any] = {}
        self.agentes: dict[str, Any] = {}
        self.memorias: dict[str, dict[str, Any]] = {}
        self.sesiones: dict[str, _Sesion] = {}
        self.skills = _Habilidades(self)
        self.beta = SimpleNamespace(environments=_Entornos(self), agents=_Agentes(self), skills=self.skills,
                                    memory_stores=_MemoryStores(self), sessions=_Sesiones(self))

    def sesion(self, session_id: str) -> _Sesion:
        s = self.sesiones.get(session_id)
        if s is None:
            raise ErrorSimulado(404, "session not found")
        return s

    # ---------------------------------------------------------------- eventos
    def emitir(self, s: _Sesion, ev: dict[str, Any]) -> dict[str, Any]:
        ahora = _ahora()
        ev.setdefault("id", _id("sevt"))
        ev.setdefault("processed_at", _iso(ahora))
        s.log.append((ahora, ev))
        for sub in list(s.subs):
            sub.cola.put_nowait(ev)
        return ev

    def _vista_previa(self, s: _Sesion, ev: dict[str, Any]) -> None:
        for sub in list(s.subs):
            if sub.deltas:
                sub.cola.put_nowait(ev)

    async def _pausa(self, factor: float = 1.0) -> None:
        if self.demora > 0:
            await asyncio.sleep(self.demora * factor)

    async def trabajar(self, s: _Sesion) -> None:
        while True:
            try:
                tipo, ev = await asyncio.wait_for(s.cola.get(), timeout=30)
            except asyncio.TimeoutError:
                if s.cola.empty():
                    s.tarea = None
                    return
                continue
            try:
                if tipo == "mensaje":
                    await self._mensaje(s, ev)
                elif tipo == "resultado":
                    await self._resultado(s, ev)
                elif tipo == "interrupcion":
                    s.turno = None
                    await self._fin(s)
            except Exception as exc:  # noqa: BLE001
                log.exception("Simulador: error en la sesión %s", s.id)
                self.emitir(s, {"type": "session.error", "error": {"type": "unknown_error", "message": str(exc)[:300],
                                                                    "retry_status": {"type": "terminal"}}})
                s.turno = None
                await self._fin(s)

    async def _mensaje(self, s: _Sesion, ev: dict[str, Any]) -> None:
        if s.tope and s.costo >= s.tope:
            s.estado = "idle"
            self.emitir(s, {"type": "session.status_idle", "stop_reason": {"type": "budget_reached"}, "stop_details": None})
            return
        texto = _texto(ev.get("content"))
        s.estado = "running"
        self.emitir(s, {"type": "session.status_running"})
        await self._pausa(0.6)
        self.emitir(s, {"type": "agent.thinking"})
        s.turno = {"texto": texto, "pasos": self._plan(texto, s), "i": 0, "resultados": [], "espera": {}, "salida": 0,
                   "t0": _ahora()}
        s.uso["input_tokens"] += 1800 + len(texto) // 3
        s.uso["cache_read_input_tokens"] += 6500
        await self._avanzar(s)

    async def _resultado(self, s: _Sesion, ev: dict[str, Any]) -> None:
        t = s.turno
        uid = ev.get("custom_tool_use_id")
        if not t or uid not in t["espera"]:
            return
        nombre = t["espera"].pop(uid)
        texto = _texto(ev.get("content"))
        t["resultados"].append({"nombre": nombre, "texto": texto, "error": bool(ev.get("is_error"))})
        s.uso["input_tokens"] += min(len(texto) // 3, 8000)
        if t["espera"]:
            return
        s.estado = "running"
        self.emitir(s, {"type": "session.status_running"})
        await self._pausa(0.6)
        await self._avanzar(s)

    async def _avanzar(self, s: _Sesion) -> None:
        t = s.turno
        while t and t["i"] < len(t["pasos"]):
            paso = t["pasos"][t["i"]]
            t["i"] += 1
            if paso[0] == "herramienta":
                entrada = paso[2](t["resultados"]) if callable(paso[2]) else paso[2]
                if entrada is None:
                    await self._decir(s, "No encontré los datos que necesitaba para eso (por ejemplo, a quién o qué "
                                         "alerta). Decime el nombre completo y lo intento de nuevo.")
                    break
                if t["resultados"] and t["resultados"][-1]["error"]:
                    break                                   # el paso anterior falló: se explica al final
                eid = _id("sevt")
                t["espera"][eid] = paso[1]
                self.emitir(s, {"id": eid, "type": "agent.custom_tool_use", "name": paso[1], "input": entrada,
                                "session_thread_id": None})
                s.estado = "idle"
                self.emitir(s, {"type": "session.status_idle", "stop_reason": {"type": "requires_action",
                                                                               "event_ids": [eid]}, "stop_details": None})
                return
            if paso[0] == "memoria":
                await self._memoria(s, paso[1], paso[2])
            elif paso[0] == "mensaje":
                await self._decir(s, paso[1](t["resultados"]) if callable(paso[1]) else paso[1])
        await self._fin(s)

    async def _memoria(self, s: _Sesion, ruta: str, contenido: str) -> None:
        eid = _id("sevt")
        self.emitir(s, {"id": eid, "type": "agent.tool_use", "name": "write",
                        "input": {"file_path": ruta, "content": contenido}, "evaluated_permission": "allow"})
        await self._pausa(0.4)
        if s.memoria_id is not None:
            store = self.memorias.setdefault(s.memoria_id, {})
            previa = next((m for m in store.values() if m.path == ruta), None)
            if previa:
                previa.content = (previa.content + "\n" + contenido).strip()
                previa.updated_at = _iso(_ahora())
            else:
                m = SimpleNamespace(id=_id("mem"), type="memory", path=ruta, content=contenido, updated_at=_iso(_ahora()))
                store[m.id] = m
        self.emitir(s, {"type": "agent.tool_result", "tool_use_id": eid, "is_error": s.memoria_id is None,
                        "content": [{"type": "text", "text": "ok" if s.memoria_id else "sin memoria montada"}]})

    async def _decir(self, s: _Sesion, texto: str) -> None:
        eid = _id("sevt")
        texto = f"{texto}\n\n{AVISO}"
        if any(sub.deltas for sub in s.subs):
            self._vista_previa(s, {"type": "event_start", "event": {"type": "agent.message", "id": eid}})
            partes = re.findall(r"\S+\s*", texto)
            paso = max(1, len(partes) // 12)
            for i in range(0, len(partes), paso):
                await self._pausa(0.12)
                self._vista_previa(s, {"type": "event_delta", "event_id": eid, "delta": {
                    "type": "content_delta", "index": 0, "content": {"type": "text", "text": "".join(partes[i:i + paso])}}})
        self.emitir(s, {"id": eid, "type": "agent.message", "content": [{"type": "text", "text": texto}]})
        if s.turno is not None:
            s.turno["salida"] += len(texto)

    async def _fin(self, s: _Sesion) -> None:
        t = s.turno or {"salida": 0, "t0": _ahora()}
        s.uso["output_tokens"] += 180 + t["salida"] // 3
        s.uso["active_seconds"] += max(0.5, (_ahora() - t["t0"]).total_seconds())
        usd = (s.uso["input_tokens"] * PRECIOS["entrada"] + s.uso["output_tokens"] * PRECIOS["salida"]
               + s.uso["cache_read_input_tokens"] * PRECIOS["cache_lectura"]) / 1_000_000 + s.uso["active_seconds"] * 0.08 / 3600
        s.costo = max(1, round(usd * 100))
        self.emitir(s, {"type": "span.model_request_end"})
        self.emitir(s, {"type": "session.usage", "usage": {
            "input_tokens": int(s.uso["input_tokens"]), "output_tokens": int(s.uso["output_tokens"]),
            "cache_read_input_tokens": int(s.uso["cache_read_input_tokens"]),
            "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0},
            "active_seconds": round(s.uso["active_seconds"], 2),
            "list_cost": {"amount": str(s.costo), "currency": "USD"}}})
        s.turno = None
        s.estado = "idle"
        motivo = "budget_reached" if s.tope and s.costo >= s.tope else "end_turn"
        self.emitir(s, {"type": "session.status_idle", "stop_reason": {"type": motivo}, "stop_details": None})

    # ---------------------------------------------------------------- el «agente» de reglas
    def _plan(self, texto: str, s: _Sesion) -> list[tuple]:
        n = _norm(texto)
        h = s.herramientas
        m = re.search(r"\b(recorda|acordate|recuerda|anota|guarda en (tu|la) memoria)\b[:,]?\s*(que\s+)?(.*)", n)
        if m:
            nota = texto[m.start(4):].strip() or texto.strip()
            return [("memoria", "/mnt/memory/voi/preferencias.md", f"- {nota[:300]}"),
                    ("mensaje", f"Listo, lo anoté en mi memoria: «{nota[:200]}». Lo voy a tener en cuenta en las "
                                "próximas conversaciones.")]
        # Fuera del modo auditor, si el usuario está investigando, Voi le ofrece activarlo (tarjeta Activar / Ahora no).
        if "Modo auditor: disponible pero apagado" in s.contexto and "proponer_modo_auditor" in h \
                and "modo auditor" not in n and RE_INVESTIGA.search(n):
            return [("herramienta", "proponer_modo_auditor",
                     {"motivo": "Estás revisando alertas y riesgos: en modo auditor busco lo que no cierra y armamos la "
                                "evidencia del informe."}),
                    ("mensaje", _final_modo)]
        plan = self._plan_fase2(texto, n, h, "MODO AUDITOR ACTIVO" in s.contexto)
        if plan:
            return plan
        if "ticket" in n and re.search(r"\b(envi|mand|cre|abr|gener|deriv)", n) and \
                {"buscar_personas", "enviar_ticket_revision"} <= h:
            quien = _nombre_propio(texto) or "a"
            return [("herramienta", "buscar_personas", {"texto": quien}),
                    ("herramienta", "enviar_ticket_revision", lambda rs: _entrada_ticket(rs, texto)),
                    ("mensaje", _final)]
        if "alerta" in n and re.search(r"\b(descart|tom|deriv)", n) and {"centro_de_comandos", "gestionar_alerta"} <= h:
            accion = "descartar" if "descart" in n else "derivar" if "deriv" in n else "tomar"
            return [("herramienta", "centro_de_comandos", {}),
                    ("herramienta", "gestionar_alerta", lambda rs: _entrada_alerta(rs, accion, texto)),
                    ("mensaje", _final)]
        if ("informe" in n or "borrador" in n) and "preparar_informe_diario" in h:
            return [("herramienta", "preparar_informe_diario", {
                "resumen": "Borrador preparado por Voi con los datos cargados del día: revisalo y completalo antes de firmar.",
                "importar": ["llamadas", "cargas"]}), ("mensaje", _final)]
        for claves, nombre, entrada in REGLAS:
            if nombre in h and any(k in n for k in claves):
                if nombre in HERRAMIENTAS_CON_FECHA:
                    hoy = ahora_local().date()
                    entrada = {**entrada, "fecha": (hoy - timedelta(days=1) if "ayer" in n else hoy).isoformat()}
                return [("herramienta", nombre, entrada), ("mensaje", _final)]
        return [("mensaje", _ayuda(h))]


    def _plan_fase2(self, texto: str, n: str, h: set[str], auditor: bool = False) -> Optional[list[tuple]]:
        """Modo auditor, lienzo, documentos con citas, facturación y las acciones de seguimiento."""
        numero = re.search(r"\b(\d{1,6})\b", n)
        if "modo_auditor" in h and re.search(r"modo auditor|investigaci", n):
            if re.search(r"\b(sal|desactiv|termin|cerr)", n):
                return [("herramienta", "modo_auditor", {"accion": "desactivar"}), ("mensaje", _final)]
            codigo = re.search(r"aud-\d{4}-\d{1,4}", n)
            entrada = {"accion": "activar", **({"auditoria": codigo.group(0).upper()} if codigo else {})}
            return [("herramienta", "modo_auditor", entrada), ("mensaje", _final)]
        # Seguimiento de un ticket ya enviado (antes que «enviar ticket»: «reabrí» contiene «abr»).
        if "ticket" in n and numero and "seguimiento_ticket" in h and re.search(r"\b(coment|reabr|cancel|reasign)", n):
            accion = next(a for k, a in (("reabr", "reabrir"), ("cancel", "cancelar"), ("reasign", "reasignar"),
                                         ("coment", "comentar")) if re.search(rf"\b{k}", n))
            return [("herramienta", "seguimiento_ticket", {"ticket": numero.group(1), "accion": accion,
                                                           "texto": f"Desde Voi: {texto.strip()[:300]}".ljust(12, ".")}),
                    ("mensaje", _final)]
        if "informe" in n and re.search(r"\bcoment", n) and "comentar_informe_diario" in h:
            consulta = "seguimiento_informes_diarios" if "seguimiento_informes_diarios" in h else "informes_diarios"
            if consulta in h:
                return [("herramienta", consulta, {}),
                        ("herramienta", "comentar_informe_diario", lambda rs: _entrada_comentario(rs, texto)),
                        ("mensaje", _final)]
        if "auditor" in n and re.search(r"\b(prepar|cre|arm|nuev|gener)", n) and "preparar_auditoria" in h:
            meses = re.findall(r"\b(20\d\d-\d\d)\b", n) or [ahora_local().strftime("%Y-%m")]
            return [("herramienta", "preparar_auditoria", {"titulo": f"Auditoría de ventas {', '.join(meses)}",
                                                           "meses": meses}), ("mensaje", _final)]
        if "hallazgo" in n and re.search(r"\b(agreg|sum|carg|anot)", n) and {"auditorias_de_ventas", "agregar_hallazgo"} <= h:
            return [("herramienta", "auditorias_de_ventas", {}),
                    ("herramienta", "agregar_hallazgo", lambda rs: _entrada_hallazgo(rs, texto)), ("mensaje", _final)]
        # Documentos de la base de conocimiento, con citas.
        if "buscar_en_documentos" in h and any(k in n for k in ("documento", "manual", "politica", "procedimiento",
                                                                  "segun", "que dice", "norma", "reglamento")):
            return [("herramienta", "buscar_en_documentos", {"consulta": texto.strip()[:300]}),
                    ("mensaje", _final_documentos)]
        # Facturación (solo si la sesión tiene esas herramientas).
        if "facturacion_liquidacion" in h and any(k in n for k in ("factur", "liquidac", "comision", "simul", "chargeback",
                                                                   "bono")):
            negocio = "gpon" if "gpon" in n else "pospago"
            if "simul" in n:
                cambios = {"ventas": int(numero.group(1))} if numero else {}
                return [("herramienta", "facturacion_simular", {"negocio": negocio, "cambios": cambios}),
                        ("mensaje", _final)]
            if any(k in n for k in ("criterio", "regla", "chargeback", "como se paga", "cuota")):
                return [("herramienta", "facturacion_criterios", {"negocio": negocio}), ("mensaje", _final)]
            if any(k in n for k in ("compar", "variac", "cambio", "evolucion")):
                return [("herramienta", "facturacion_comparar", {}), ("mensaje", _final)]
            if "calidad" in n:
                return [("herramienta", "facturacion_calidad_por_fecha", {}), ("mensaje", _final)]
            if any(k in n for k in ("liquidaciones", "que meses", "cargad")):
                return [("herramienta", "facturacion_liquidaciones", {}), ("mensaje", _final)]
            return [("herramienta", "facturacion_liquidacion", {"referencia": "ultimo"}), ("mensaje", _final)]
        # Lienzo: consulta los datos y los muestra.
        if "mostrar_en_lienzo" in h and any(k in n for k in ("grafic", "lienzo", "tablero", "visualiz", "dashboard")):
            fuente = next(((nombre, entrada) for claves, nombre, entrada in REGLAS
                           if nombre in h and any(k in n for k in claves)), None)
            fuente = fuente or next(((nombre, {}) for nombre in ("ventas_del_mes", "supervision_del_mes",
                                                                 "productividad_del_dia") if nombre in h), None)
            if fuente:
                nombre, entrada = fuente
                if nombre in HERRAMIENTAS_CON_FECHA:
                    entrada = {**entrada, "fecha": ahora_local().date().isoformat()}
                if (mes := re.search(r"\b(20\d\d-\d\d)\b", n)) and nombre in HERRAMIENTAS_CON_MES:
                    entrada = {**entrada, "mes": mes.group(1)}
                armar = _spec_tablero if "tablero" in n else _spec_lienzo
                pasos = [("herramienta", nombre, entrada),
                         ("herramienta", "mostrar_en_lienzo", lambda rs: armar(rs))]
                if auditor and "proponer_evidencia" in h:
                    # En modo auditor: después de mostrar, pregunta qué sumar al informe (la tarjeta con casillas).
                    pasos.append(("herramienta", "proponer_evidencia", lambda rs: _entrada_evidencia(rs)))
                    return [*pasos, ("mensaje", _final_evidencia)]
                return [*pasos, ("mensaje", _final_lienzo)]
        return None


HERRAMIENTAS_CON_FECHA = {"productividad_del_dia", "ventas_del_dia", "coaching_del_dia"}
RE_INVESTIGA = re.compile(r"investig|sospech|irregular|anomal|dudos|no cierra|que esta mal|revisa (las|los) (alertas|vendedores|ventas)")
HERRAMIENTAS_CON_MES = {"ventas_del_mes", "supervision_del_mes"}
REGLAS: list[tuple[tuple[str, ...], str, dict[str, Any]]] = [     # de lo más específico a lo más general
    (("auditor",), "auditorias_de_ventas", {}),
    (("ticket",), "tickets_de_revision", {"vista": "abiertos"}),
    (("sph",), "sph", {}),
    (("coaching",), "coaching_del_dia", {}),
    (("productividad", "llamada", "aht", "conexion"), "productividad_del_dia", {}),
    (("objetivo", "proyeccion", "supervision"), "supervision_del_mes", {}),
    (("sin uso", "netas", "venta"), "ventas_del_mes", {}),
    (("comando", "alerta", "prioridad"), "centro_de_comandos", {}),
    (("dato", "cargad", "disponible"), "estado_de_los_datos", {}),
]


def _nombre_propio(texto: str) -> Optional[str]:
    """La primera secuencia de palabras con mayúscula que no sea el comienzo de la frase."""
    palabras = re.findall(r"[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+", texto)
    comunes = {"Enviá", "Envia", "Mandá", "Manda", "Creá", "Crea", "Abrí", "Abri", "Generá", "Genera", "Derivá", "Deriva",
               "Ticket", "Voi", "Por", "Un", "Una", "El", "La", "Hola", "Necesito", "Quiero"}
    candidatos = [p for p in palabras if p not in comunes]
    return " ".join(candidatos[:2]) or None


def _datos(r: dict[str, Any]) -> Any:
    try:
        return json.loads(r["texto"])
    except (TypeError, ValueError):
        return None


def _entrada_ticket(rs: list[dict[str, Any]], texto: str) -> Optional[dict[str, Any]]:
    d = _datos(rs[-1]) if rs else None
    asesores = (d or {}).get("asesores") or []
    if not asesores or not isinstance(asesores[0], dict) or not asesores[0].get("id"):
        return None
    return {"tipo": "calidad", "prioridad": "media", "operador_id": asesores[0]["id"],
            "fecha_caso": ahora_local().date().isoformat(), "descripcion": f"Pedido desde Voi: {texto.strip()[:300]}"}


def _entrada_alerta(rs: list[dict[str, Any]], accion: str, texto: str) -> Optional[dict[str, Any]]:
    d = _datos(rs[-1]) if rs else None
    alertas = [a for a in (d or {}).get("alertas") or [] if isinstance(a, dict) and a.get("id")]
    if accion == "derivar":
        alertas = [a for a in alertas if a.get("puede_revision")]
    if not alertas:
        return None
    entrada: dict[str, Any] = {"alerta_id": alertas[0]["id"], "accion": accion,
                               "texto": f"Desde Voi: {texto.strip()[:200]}".ljust(12, ".")}
    if accion == "derivar":
        entrada["prioridad"] = "media"
    return entrada


def _entrada_comentario(rs: list[dict[str, Any]], texto: str) -> Optional[dict[str, Any]]:
    d = _datos(rs[-1]) if rs else None
    informes = [i for i in (d or {}).get("informes") or [] if isinstance(i, dict) and i.get("id")
                and i.get("estado") == "firmado"]
    if not informes:
        return None
    return {"informe_id": informes[0]["id"], "texto": f"Desde Voi: {texto.strip()[:300]}"}


def _entrada_hallazgo(rs: list[dict[str, Any]], texto: str) -> Optional[dict[str, Any]]:
    d = _datos(rs[-1]) if rs else None
    items = (d or {}).get("items") or []
    editables = [a for a in items if isinstance(a, dict) and a.get("id") and a.get("status") in ("borrador", "en_revision")]
    if not editables:
        return None
    return {"auditoria": editables[0]["id"], "titulo": "Hallazgo agregado desde Voi", "severidad": "media",
            "categoria": "otro", "descripcion": texto.strip()[:500]}


def _entrada_evidencia(rs: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    d = _datos(rs[-1]) if rs else None
    if not isinstance(d, dict) or not d.get("artefacto_id"):
        return None
    return {"piezas": [{"artefacto_id": d["artefacto_id"], "titulo": "Lo que muestra el lienzo",
                        "nota": "Lectura del auditor sugerida por Voi (simulador)."}]}


def _numero(v: Any) -> Optional[float]:
    from .herramientas.lienzo import _num
    return _num(v)


def _buscar(d: Any, prueba, prof: int = 0) -> Any:
    """Lo primero (en profundidad, hasta 3 niveles) que cumple la prueba."""
    if prueba(d):
        return d
    if prof >= 3:
        return None
    hijos = d.values() if isinstance(d, dict) else d if isinstance(d, list) else []
    for v in hijos:
        if isinstance(v, (dict, list)):
            r = _buscar(v, prueba, prof + 1)
            if r is not None:
                return r
    return None


def _es_tabla(v: Any) -> bool:
    if not (isinstance(v, list) and v and all(isinstance(f, dict) for f in v[:5])):
        return False
    f = v[0]
    return any(isinstance(x, str) and _numero(x) is None for x in f.values()) and \
        any(_numero(x) is not None and not isinstance(x, bool) for x in f.values())


def _spec_lienzo(rs: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Arma una pieza simple con lo que trajo la consulta: barras con la primera tabla, o indicadores."""
    d = _datos(rs[-1]) if rs else None
    if not isinstance(d, (dict, list)):
        return None
    tabla = _buscar(d, _es_tabla)
    if tabla:
        fila = tabla[0]
        x = next(k for k, v in fila.items() if isinstance(v, str) and _numero(v) is None)
        campos = [k for k, v in fila.items() if k != x and _numero(v) is not None and not isinstance(v, bool)][:2]
        if campos:
            datos = [{x: f.get(x), **{c: _numero(f.get(c)) for c in campos}} for f in tabla[:31] if isinstance(f, dict)]
            series = [{"campo": c, "nombre": c.replace("_", " ").capitalize()} for c in campos]
            if all(re.match(r"^(\d{4}-\d{2}(-\d{2})?|\d{1,2}/\d{1,2})", str(f.get(x) or "")) for f in datos):
                return {"tipo": "lineas", "titulo": "Así viene la evolución", "x": x, "x_nombre": "Fecha", "series": series,
                        "datos": sorted(datos, key=lambda f: str(f.get(x))), "nota": "Datos de la plataforma (simulador)"}
            return {"tipo": "barras", "titulo": "Lo que encontré, en un gráfico", "x": x, "orden": "desc",
                    "series": series[:1], "datos": datos[:20], "nota": "Datos de la plataforma (simulador)"}
    indicadores = _buscar(d, lambda v: isinstance(v, list) and v and all(
        isinstance(k, dict) and (k.get("label") or k.get("titulo")) and _numero(k.get("valor")) is not None for k in v[:4]))
    if indicadores:
        kpis = [{"titulo": str(k.get("label") or k.get("titulo"))[:60], "valor": _numero(k.get("valor"))}
                for k in indicadores[:4]]
    else:
        plano = _buscar(d, lambda v: isinstance(v, dict) and sum(
            isinstance(x, (int, float)) and not isinstance(x, bool) for x in v.values()) >= 2)
        kpis = [{"titulo": k.replace("_", " ").capitalize(), "valor": v} for k, v in (plano or {}).items()
                if isinstance(v, (int, float)) and not isinstance(v, bool)][:4]
    if not kpis:
        return None
    return {"tipo": "kpis", "titulo": "Indicadores principales", "kpis": kpis}


def _spec_tablero(rs: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Un tablero con lo que trajo la consulta: indicadores (si hay) y el gráfico."""
    grafico = _spec_lienzo(rs)
    if not grafico:
        return None
    widgets = [grafico]
    d = _datos(rs[-1]) if rs else None
    plano = _buscar(d, lambda v: isinstance(v, dict) and sum(
        isinstance(x, (int, float)) and not isinstance(x, bool) for x in v.values()) >= 2)
    kpis = [{"titulo": k.replace("_", " ").capitalize(), "valor": v} for k, v in (plano or {}).items()
            if isinstance(v, (int, float)) and not isinstance(v, bool)][:4]
    if kpis and grafico["tipo"] != "kpis":
        widgets.insert(0, {"tipo": "kpis", "titulo": "Indicadores principales", "kpis": kpis})
    return {"tipo": "tablero", "titulo": "Tablero de la consulta", "widgets": widgets}


def _final_evidencia(rs: list[dict[str, Any]]) -> str:
    """Después de la tarjeta de evidencia: qué figuras quedaron en el informe (o que no se sumó nada)."""
    r = rs[-1] if rs else None
    if not r or r["error"]:
        return _final(rs)
    d = _datos(r) or {}
    figuras = d.get("agregadas") or []
    if not figuras:
        return d.get("mensaje") or "No se sumó nada nuevo al informe."
    lista = "\n".join(f"- **Figura {f.get('figura')}** · {f.get('titulo')}" for f in figuras)
    return (f"Listo: {d.get('mensaje')}\n\n{lista}\n\nEl informe {d.get('informe')} tiene ahora {d.get('total_figuras')} "
            f"figuras. [Ver la evidencia del informe]({d.get('pantalla')})")


def _final_modo(rs: list[dict[str, Any]]) -> str:
    """Después de la tarjeta «¿Activamos el modo auditor?»."""
    r = rs[-1] if rs else None
    if not r or r["error"]:
        return "Entendido, seguimos sin el modo auditor. Si después lo querés, activalo desde el panel."
    d = _datos(r) or {}
    destino = (d.get("informe_destino") or {}).get("codigo")
    return (f"Listo, activé el **modo auditor**{f' con el informe {destino}' if destino else ''}. Desde ahora busco "
            "alertas por mi cuenta, separo hechos de hipótesis y cada gráfico que te muestre te lo ofrezco como figura "
            "del informe. ¿Empiezo por los vendedores críticos, las líneas sin uso o Sali Hablando?")


def _final_lienzo(rs: list[dict[str, Any]]) -> str:
    r = rs[-1] if rs else None
    if not r or r["error"]:
        return _final(rs)
    return ("Listo: te lo dejé en el **lienzo**, al lado del chat (en el celular, tocá «Ver en el lienzo»). Ahí podés ver "
            "la tabla de datos y descargarlo.")


def _final_documentos(rs: list[dict[str, Any]]) -> str:
    d = _datos(rs[-1]) if rs else None
    resultados = (d or {}).get("resultados") or []
    if not resultados:
        return "No lo encontré en los documentos de la base de conocimiento. Si querés, lo busco con otras palabras."
    partes = ["Esto es lo que dicen los documentos:", ""]
    for r in resultados[:2]:
        extracto = re.sub(r"\s+", " ", r.get("texto") or "")[:260].rstrip()
        partes.append(f"- {extracto}… {r.get('cita', '')}")
    return "\n".join(partes)


def _valor(v: Any) -> str:
    if isinstance(v, float):
        return f"{v:,.2f}".replace(",", "§").replace(".", ",").replace("§", ".")
    if isinstance(v, int) and not isinstance(v, bool):
        return f"{v:,}".replace(",", ".")
    if isinstance(v, bool):
        return "sí" if v else "no"
    return str(v)[:80]


def _final(rs: list[dict[str, Any]]) -> str:
    from .herramientas import obtener
    if not rs:
        return "Listo."
    r = rs[-1]
    h = obtener(r["nombre"])
    etiqueta = (h.etiqueta if h else r["nombre"]).lower()
    if r["error"]:
        if any(k in r["texto"].lower() for k in ("cancel", "no realizada", "no eligió")):
            return "Entendido: no lo hice. Si querés, lo vemos de otra manera."
        return f"No pude completar eso ({etiqueta}): {r['texto'][:400]}"
    d = _datos(r)
    if not isinstance(d, dict):
        return f"Listo ({etiqueta}): {r['texto'][:400]}"
    lineas = [f"Esto es lo que encontré ({etiqueta}):", ""]
    escalares = [(k, v) for k, v in d.items() if not isinstance(v, (dict, list)) and v not in (None, "")
                 and k not in ("pantalla", "importante")]
    for k, v in escalares[:6]:
        lineas.append(f"- **{k.replace('_', ' ').capitalize()}:** {_valor(v)}")
    tabla = next((v for v in d.values() if isinstance(v, list) and v and isinstance(v[0], dict)), None)
    if tabla:
        cols = [k for k, v in tabla[0].items() if not isinstance(v, (dict, list))][:4]
        if cols:
            lineas += ["", "| " + " | ".join(c.replace("_", " ").capitalize() for c in cols) + " |",
                       "|" + "---|" * len(cols)]
            for fila in tabla[:6]:
                lineas.append("| " + " | ".join(_valor(fila.get(c, "")) for c in cols) + " |")
            if len(tabla) > 6:
                lineas.append(f"\n…y {len(tabla) - 6} más.")
    if len(lineas) == 2:
        lineas.append("- No hay datos para mostrar todavía.")
    if d.get("importante"):
        lineas += ["", f"> {d['importante']}"]
    if d.get("pantalla"):
        lineas += ["", f"[Abrir en la plataforma]({d['pantalla']})"]
    return "\n".join(lineas)


def _ayuda(h: set[str]) -> str:
    from .herramientas import obtener
    puedo = [obtener(n).etiqueta.lower() for n in sorted(h) if obtener(n)]
    lista = "\n".join(f"- {p}" for p in puedo[:10]) or "- (en tu perfil no hay herramientas habilitadas)"
    return ("¡Hola! Soy **Voi**, el agente de la plataforma. Con tus permisos puedo ayudarte con:\n\n" + lista +
            "\n\nTambién te explico cómo usar cada pantalla y recuerdo tus preferencias. Probá, por ejemplo: "
            "«¿Cómo vino la productividad ayer?».")


__all__ = ["ClienteSimulado", "ErrorSimulado"]
