"""Reglas de Capacitación y Mentoría: quién ve y hace qué en cada grupo, los estados posibles de un postulante, el embudo,
la efectividad, la duración, el resumen del IPV, los conteos de feedback y las estadísticas por sexo y edad.

Visibilidad:
- `capacitacion.total` (gerente, sub gerente, Gerencia de RRHH) y el superadmin: todos los grupos, y pueden actuar en
  cualquiera («gestión»).
- `capacitacion.capacitar`: los grupos donde es el capacitador.
- `capacitacion.mentoria`: los grupos donde es mentor.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from statistics import mean
from typing import Any, Iterable, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...api.deps import CurrentUser, effective_permissions
from ...models.profile import Profile
from ...models.user import User
from . import ipv
from .models import (DE_CAPACITADOR, ESTADOS_GRUPO, ESTADOS_POSTULANTE, CapComentario, CapEnlace, CapEvento, CapGrupo,
                     CapPostulante)

ZONA = ZoneInfo("America/Asuncion")
OPERATIVA = "capacitacion"
PERM_VER = f"{OPERATIVA}.ver"
PERM_CAPACITAR = f"{OPERATIVA}.capacitar"
PERM_MENTORIA = f"{OPERATIVA}.mentoria"
PERM_TOTAL = f"{OPERATIVA}.total"

ESTADO_NOMBRE = {
    "en_capacitacion": "En capacitación", "aprobo_escrita": "Aprobó prueba escrita", "aprobo_mentoria": "Aprobó mentoría y OJT",
    "alta_operativa": "Alta operativa", "abandono": "Abandonó", "baja": "Dado de baja",
}
GRUPO_NOMBRE = {"en_curso": "En curso", "finalizada": "Finalizada", "cancelada": "Cancelada"}
SEXO_NOMBRE = {"F": "Femenino", "M": "Masculino", "X": "Otro / prefiere no decir"}
SALIDAS = ("abandono", "baja")
# Etapa del embudo de cada estado activo, y el estado que corresponde a cada etapa (para volver de una salida).
ETAPA = {"en_capacitacion": 0, "aprobo_escrita": 1, "aprobo_mentoria": 2, "alta_operativa": 3}
ESTADO_DE_ETAPA = {v: k for k, v in ETAPA.items()}
BANDAS_EDAD = [("menos_18", "Menos de 18", 0, 17), ("18_24", "18 a 24", 18, 24), ("25_34", "25 a 34", 25, 34),
               ("35_44", "35 a 44", 35, 44), ("45_mas", "45 o más", 45, 200)]
TIPOS_COMENTARIO = ("feedback", "oportunidad", "postulante")


def ahora() -> datetime:
    return datetime.now(timezone.utc)


def hoy() -> date:
    return datetime.now(ZONA).date()


def iso(d: datetime | date | None) -> str | None:
    if d is None:
        return None
    if isinstance(d, datetime):
        return (d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d).isoformat()
    return d.isoformat()


def utc(d: datetime | None) -> datetime | None:
    return None if d is None else (d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d)


# ------------------------------------------------------------------ quién es quién
def es_gestion(user: CurrentUser) -> bool:
    return user.is_superadmin or user.has_perm(PERM_TOTAL)


def roles_en(g: CapGrupo, user: CurrentUser) -> set[str]:
    """Los papeles del usuario en ese grupo: capacitador, mentor y/o gestión (vista completa)."""
    r: set[str] = set()
    if es_gestion(user):
        r.add("gestion")
    if user.has_perm(PERM_CAPACITAR) and g.capacitador_id == user.id:
        r.add("capacitador")
    if user.has_perm(PERM_MENTORIA) and user.id in (g.mentores or []):
        r.add("mentor")
    return r


def rol_principal(roles: set[str]) -> str:
    return next(r for r in ("capacitador", "mentor", "gestion") if r in roles)


def visible(g: CapGrupo, user: CurrentUser) -> bool:
    return bool(roles_en(g, user))


async def grupos_visibles(db: AsyncSession, user: CurrentUser) -> list[CapGrupo]:
    filas = (await db.execute(select(CapGrupo).order_by(CapGrupo.fecha_inicio.desc(), CapGrupo.created_at.desc()))).scalars().all()
    return [g for g in filas if visible(g, user)]


async def personas(db: AsyncSession) -> dict[str, list[dict[str, str]]]:
    """Los usuarios activos que pueden ser capacitadores o mentores (para elegirlos en un grupo)."""
    perfiles = {p.slug: p.permissions for p in (await db.execute(select(Profile))).scalars().all()}
    caps: list[dict[str, str]] = []
    ments: list[dict[str, str]] = []
    for u in (await db.execute(select(User).where(User.is_active.is_(True)).order_by(User.full_name))).scalars().all():
        if OPERATIVA not in (u.operativas or []):
            continue
        perms = effective_permissions(perfiles.get(u.role), u.operativas, u.role)
        fila = {"id": u.id, "nombre": u.full_name, "perfil": u.role}
        if PERM_CAPACITAR in perms:
            caps.append(fila)
        if PERM_MENTORIA in perms:
            ments.append(fila)
    return {"capacitadores": caps, "mentores": ments}


async def nombres(db: AsyncSession, ids: Iterable[str | None]) -> dict[str, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    filas = (await db.execute(select(User.id, User.full_name).where(User.id.in_(ids)))).all()
    return {i: n for i, n in filas}


# ------------------------------------------------------------------ estados
def destinos(p: CapPostulante, roles: set[str], g: CapGrupo) -> list[str]:
    """Los estados a los que ese usuario puede pasar al postulante. El capacitador carga los de la sala (y la salida); el
    mentor, los del piso una vez que aprobó la escrita; la gestión, cualquiera. Un grupo cancelado queda de solo lectura."""
    if g.estado == "cancelada":
        return []
    actual = p.estado
    out: set[str] = set()
    if "gestion" in roles:
        out = set(ESTADOS_POSTULANTE)
    if "capacitador" in roles and actual in DE_CAPACITADOR:
        out |= set(DE_CAPACITADOR)
    if "mentor" in roles:
        if actual in ("aprobo_escrita", "aprobo_mentoria", "alta_operativa"):
            out |= {"aprobo_mentoria", "abandono", "baja"}
            if actual != "aprobo_escrita":
                out.add("alta_operativa")
        elif actual in SALIDAS and (p.etapa_max or 0) >= 1:
            out.add(ESTADO_DE_ETAPA[p.etapa_max])      # deshacer la salida: vuelve a donde estaba
    out.discard(actual)
    return [e for e in ESTADOS_POSTULANTE if e in out]


def aplicar_estado(p: CapPostulante, nuevo: str, motivo: Optional[str], por: str) -> None:
    p.estado, p.estado_at, p.estado_por = nuevo, ahora(), por
    p.motivo = motivo if nuevo in SALIDAS else None
    if nuevo in ETAPA:
        p.etapa_max = ETAPA[nuevo]       # corregir hacia atrás también baja la etapa


def destinos_grupo(g: CapGrupo, roles: set[str]) -> list[str]:
    if not ({"capacitador", "gestion"} & roles):
        return []
    return [e for e in ESTADOS_GRUPO if e != g.estado and (g.estado == "en_curso" or e == "en_curso")]


def duracion_dias(g: CapGrupo) -> int:
    fin = g.fecha_fin or hoy()
    return max(0, (fin - g.fecha_inicio).days + 1)


def evento(db: AsyncSession, *, grupo_id: str, tipo: str, por: Optional[str], postulante_id: Optional[str] = None,
           de: Optional[str] = None, a: Optional[str] = None, **datos: Any) -> None:
    db.add(CapEvento(grupo_id=grupo_id, postulante_id=postulante_id, tipo=tipo, de=de, a=a, por=por, at=ahora(), datos=datos))


# ------------------------------------------------------------------ datos de varios grupos de una vez
class Datos:
    """Postulantes, enlaces y conteos de comentarios de un conjunto de grupos."""

    def __init__(self) -> None:
        self.postulantes: dict[str, list[CapPostulante]] = defaultdict(list)
        self.enlaces: dict[str, CapEnlace] = {}
        self.comentarios: dict[str, Counter] = defaultdict(Counter)

    def todos(self) -> list[CapPostulante]:
        return [p for ps in self.postulantes.values() for p in ps]


async def cargar(db: AsyncSession, grupo_ids: list[str]) -> Datos:
    d = Datos()
    if not grupo_ids:
        return d
    ps = (await db.execute(select(CapPostulante).where(CapPostulante.grupo_id.in_(grupo_ids))
                           .order_by(CapPostulante.apellido, CapPostulante.nombre))).scalars().all()
    for p in ps:
        d.postulantes[p.grupo_id].append(p)
    pids = [p.id for p in ps]
    if pids:
        for e in (await db.execute(select(CapEnlace).where(CapEnlace.postulante_id.in_(pids)))).scalars().all():
            d.enlaces[e.postulante_id] = e
        filas = (await db.execute(select(CapComentario.postulante_id, CapComentario.tipo)
                                  .where(CapComentario.grupo_id.in_(grupo_ids)))).all()
        for pid, tipo in filas:
            d.comentarios[pid][tipo] += 1
    return d


def ipv_de(e: CapEnlace | None) -> dict[str, Any]:
    """Cómo va el IPV del postulante (sin los puntajes: solo el DGV, para la tabla)."""
    if e is None:
        return {"estado": "sin_link", "respondidas": 0, "total": ipv.TOTAL, "dgv": None, "terminado_at": None}
    dgv = None
    if e.ipv_estado == "terminado" and e.resultado:
        x = e.resultado["escalas"][0]
        dgv = {"decatipo": x["decatipo"], "nivel": x["nivel"]}
    return {"estado": e.ipv_estado, "respondidas": len(e.respuestas or {}), "total": ipv.TOTAL, "dgv": dgv,
            "terminado_at": iso(e.terminado_at), "link_activo": bool(e.activo and utc(e.vence_at) > ahora())}


def conteo(c: Counter) -> dict[str, int]:
    return {"feedback": c.get("feedback", 0), "oportunidad": c.get("oportunidad", 0), "postulante": c.get("postulante", 0),
            "total": sum(c.values())}


def postulante_fila(p: CapPostulante, d: Datos, g: CapGrupo, roles: set[str]) -> dict[str, Any]:
    return {"id": p.id, "grupo_id": p.grupo_id, "nombre": p.nombre, "apellido": p.apellido, "ci": p.ci, "edad": p.edad,
            "sexo": p.sexo, "estado": p.estado, "estado_nombre": ESTADO_NOMBRE[p.estado], "estado_at": iso(p.estado_at),
            "motivo": p.motivo, "etapa_max": p.etapa_max, "en_piso": p.estado in ("aprobo_escrita", "aprobo_mentoria"),
            "ipv": ipv_de(d.enlaces.get(p.id)), "comentarios": conteo(d.comentarios[p.id]),
            "puede": destinos(p, roles, g)}


# ------------------------------------------------------------------ embudo, IPV y estadísticas
def embudo(ps: list[CapPostulante]) -> dict[str, Any]:
    total = len(ps)
    cuenta = Counter(p.estado for p in ps)
    salidas = cuenta["abandono"] + cuenta["baja"]
    altas = cuenta["alta_operativa"]
    llegaron = {n: sum(1 for p in ps if (p.etapa_max or 0) >= n) for n in (1, 2, 3)}
    pct = (lambda n: round(n / total * 100, 1) if total else None)
    return {
        "total": total, "estados": {e: cuenta.get(e, 0) for e in ESTADOS_POSTULANTE}, "activos": total - salidas,
        "en_sala": cuenta["en_capacitacion"], "en_piso": cuenta["aprobo_escrita"] + cuenta["aprobo_mentoria"],
        "aprobaron_escrita": llegaron[1], "aprobaron_mentoria": llegaron[2], "altas": altas, "salidas": salidas,
        "efectividad": pct(altas), "desercion": pct(salidas),
        "etapas": [
            {"clave": "ingresaron", "nombre": "Ingresaron", "n": total, "pct": pct(total)},
            {"clave": "aprobo_escrita", "nombre": "Aprobaron la escrita", "n": llegaron[1], "pct": pct(llegaron[1])},
            {"clave": "aprobo_mentoria", "nombre": "Aprobaron mentoría y OJT", "n": llegaron[2], "pct": pct(llegaron[2])},
            {"clave": "alta_operativa", "nombre": "Alta operativa", "n": altas, "pct": pct(altas)},
        ],
    }


def resumen_ipv(ps: list[CapPostulante], d: Datos) -> dict[str, Any]:
    total = len(ps)
    estados = Counter(ipv_de(d.enlaces.get(p.id))["estado"] for p in ps)
    resultados = [d.enlaces[p.id].resultado for p in ps
                  if p.id in d.enlaces and d.enlaces[p.id].ipv_estado == "terminado" and d.enlaces[p.id].resultado]
    promedios = []
    for e in ipv.ESCALAS:
        vals = [x["decatipo"] for r in resultados for x in r["escalas"] if x["clave"] == e["clave"]]
        promedios.append({"clave": e["clave"], "nombre": e["nombre"], "romano": e["romano"], "grupo": e["grupo"],
                          "decatipo": round(mean(vals), 1) if vals else None})
    niveles = Counter(r["escalas"][0]["nivel"] for r in resultados)
    return {"realizados": estados["terminado"], "en_curso": estados["en_curso"], "pendientes": estados["pendiente"],
            "sin_link": estados["sin_link"], "total": total,
            "porcentaje": round(estados["terminado"] / total * 100, 1) if total else None,
            "dgv": {k: niveles.get(k, 0) for k in ipv.NIVELES_IPV}, "promedios": promedios}


def _dgv(p: CapPostulante, d: Datos) -> int | None:
    x = ipv_de(d.enlaces.get(p.id))["dgv"]
    return x["decatipo"] if x else None


def _fila_demo(clave: str, nombre: str, ps: list[CapPostulante], d: Datos) -> dict[str, Any]:
    n = len(ps)
    altas = sum(1 for p in ps if p.estado == "alta_operativa")
    salidas = sum(1 for p in ps if p.estado in SALIDAS)
    dgvs = [x for x in (_dgv(p, d) for p in ps) if x is not None]
    return {"clave": clave, "nombre": nombre, "total": n, "altas": altas, "salidas": salidas,
            "efectividad": round(altas / n * 100, 1) if n else None, "ipv": len(dgvs),
            "dgv_promedio": round(mean(dgvs), 1) if dgvs else None,
            "edad_promedio": round(mean(p.edad for p in ps), 1) if ps else None}


def banda_edad(edad: int) -> tuple[str, str]:
    return next((c, n) for c, n, lo, hi in BANDAS_EDAD if lo <= edad <= hi)


def estadisticas(ps: list[CapPostulante], d: Datos) -> dict[str, Any]:
    """Por sexo y por franja de edad: cuántos, altas, salidas, efectividad, IPV hechos y DGV promedio."""
    por_sexo: dict[str, list[CapPostulante]] = defaultdict(list)
    por_edad: dict[str, list[CapPostulante]] = defaultdict(list)
    for p in ps:
        por_sexo[p.sexo].append(p)
        por_edad[banda_edad(p.edad)[0]].append(p)
    sexo = [_fila_demo(k, SEXO_NOMBRE[k], por_sexo[k], d) for k in SEXO_NOMBRE if por_sexo[k] or k != "X"]
    edad = [_fila_demo(c, n, por_edad[c], d) for c, n, _, _ in BANDAS_EDAD if por_edad[c] or c != "menos_18"]
    return {"sexo": sexo, "edad": edad, "edad_promedio": round(mean(p.edad for p in ps), 1) if ps else None}


def feedback_total(ps: list[CapPostulante], d: Datos) -> dict[str, Any]:
    c: Counter = Counter()
    for p in ps:
        c.update(d.comentarios[p.id])
    n = len(ps)
    out = conteo(c)
    out["promedio"] = round(out["total"] / n, 1) if n else None
    out["sin_feedback"] = sum(1 for p in ps if not (d.comentarios[p.id]["feedback"] + d.comentarios[p.id]["oportunidad"]))
    return out


def grupo_dict(g: CapGrupo, ps: list[CapPostulante], d: Datos, user: CurrentUser, quien: dict[str, str]) -> dict[str, Any]:
    roles = roles_en(g, user)
    e = embudo(ps)
    r = resumen_ipv(ps, d)
    return {
        "id": g.id, "nombre": g.nombre, "operacion": g.operacion, "estado": g.estado, "estado_nombre": GRUPO_NOMBRE[g.estado],
        "fecha_inicio": iso(g.fecha_inicio), "fin_previsto": iso(g.fin_previsto), "fecha_fin": iso(g.fecha_fin),
        "duracion_dias": duracion_dias(g), "motivo": g.motivo,
        "capacitador": {"id": g.capacitador_id, "nombre": quien.get(g.capacitador_id, "—")},
        "mentores": [{"id": m, "nombre": quien.get(m, "—")} for m in (g.mentores or [])],
        "embudo": e, "efectividad": e["efectividad"], "ipv": {k: r[k] for k in ("realizados", "total", "porcentaje")},
        "feedback": feedback_total(ps, d)["total"],
        "roles": sorted(roles), "puede": {"estados": destinos_grupo(g, roles), "editar": bool({"capacitador", "gestion"} & roles),
                                          "postulantes": g.estado == "en_curso" and bool({"capacitador", "gestion"} & roles)},
    }
