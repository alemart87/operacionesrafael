"""Coaching y bitácora del supervisor: reglas del registro, la foto al registrar y el impacto medido.

Reglas (las de la guía del modelo Líder Coach Comercial):
- La hora de registro la pone el servidor. La fecha del coaching puede ser de este mes o de los últimos
  2 días; con más de 48 h de atraso (más de 2 días) cuenta igual, pero queda «fuera de término».
- El supervisor registra solo para los asesores que tenía en su equipo ese día (lo controla el servidor).
- Se edita (o se anula, si se cargó por error) durante 24 h. Después solo se agregan el seguimiento y
  aclaraciones; cada versión queda en el historial (`sup_coaching_eventos`).
- El seguimiento se registra desde el día siguiente al coaching; el sistema mide el impacto con los
  datos y lo guarda con el seguimiento (mejoró, igual, empeoró o sin datos).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .alertas import dia_local
from .calculo import _fecha, limites, mes_anterior, mes_de, mes_siguiente
from .datos import productividad_del_mes, ventas_del_mes
from .impacto import (
    DIAS_ATRAS, DIAS_MADURACION, histograma, impacto_conversacion, impacto_uso, impacto_ventas, sin_medicion,
)
from .models import OPERATIVA, BitacoraNota, Coaching, CoachingEvento, Operador, SupParametros

HORAS_EDICION = 24
DIAS_TERMINO = 2            # más de 48 h de atraso: fuera de término
DIAS_SEGUIMIENTO_MAX = 45
DIAS_ATRASO_MES_ANTERIOR = 2  # del mes anterior solo se cargan los de los últimos 2 días
TIPOS = ("diario", "semanal", "mensual")
SEGUIMIENTO_SUGERIDO = {"diario": 3, "semanal": 7, "mensual": 30}  # días hasta el seguimiento (sugerencia)
TIPOS_NOTA = ("novedad", "ausencia", "incidencia", "reconocimiento", "otro")
MIN_TEXTO, MAX_TEXTO = 10, 2000
PRODUCTO = {"pospago": "Pospago", "gpon": "GPON"}


class ReglaInvalida(ValueError):
    """El registro no cumple una regla del modelo (el mensaje es para el usuario)."""


# ------------------------------------------------------------------ reglas
def ahora() -> datetime:
    return datetime.now(timezone.utc)


def validar_fecha(fecha: date, hoy: date) -> bool:
    """La fecha del registro: de este mes o de los últimos 2 días, nunca futura. Devuelve si está fuera de término."""
    if fecha > hoy:
        raise ReglaInvalida("La fecha no puede ser futura")
    if fecha < limites(mes_de(hoy))[0] and (hoy - fecha).days > DIAS_ATRASO_MES_ANTERIOR:
        raise ReglaInvalida("La fecha tiene que ser de este mes (o de los últimos 2 días)")
    return (hoy - fecha).days > DIAS_TERMINO


def validar_seguimiento(fecha: date, seguimiento: date, hoy: date) -> None:
    if seguimiento <= fecha:
        raise ReglaInvalida("El seguimiento tiene que ser después del coaching")
    if seguimiento < hoy:
        raise ReglaInvalida("La fecha de seguimiento no puede ser pasada")
    if seguimiento > fecha + timedelta(days=DIAS_SEGUIMIENTO_MAX):
        raise ReglaInvalida(f"El seguimiento tiene que ser dentro de los {DIAS_SEGUIMIENTO_MAX} días del coaching")


def texto(valor: str | None, campo: str, minimo: int = MIN_TEXTO, maximo: int = MAX_TEXTO) -> str:
    t = (valor or "").strip()
    if len(t) < minimo:
        raise ReglaInvalida(f"Escribí {campo} (al menos {minimo} caracteres)")
    if len(t) > maximo:
        raise ReglaInvalida(f"{campo.capitalize()}: hasta {maximo} caracteres")
    return t


def editable(c: Coaching, momento: datetime) -> bool:
    creado = c.created_at if c.created_at.tzinfo else c.created_at.replace(tzinfo=timezone.utc)
    return c.estado == "abierto" and momento - creado <= timedelta(hours=HORAS_EDICION)


def estado_seguimiento(c: Coaching, hoy: date) -> str | None:
    """a_tiempo | tarde (registrado) · vencido | hoy | proximo (sin registrar) · None si está anulado."""
    if c.estado == "anulado":
        return None
    limite = c.seguimiento_fecha + timedelta(days=1)
    dia = dia_local(c.seguimiento_at)
    if dia is not None:
        return "a_tiempo" if dia <= limite else "tarde"
    if limite < hoy:
        return "vencido"
    return "hoy" if c.seguimiento_fecha <= hoy else "proximo"


async def inicio_gestion(db: AsyncSession) -> date | None:
    row = await db.get(SupParametros, OPERATIVA)
    v = ((row.data if row else None) or {}).get("gestion_desde")
    return date.fromisoformat(v) if v else None


# ------------------------------------------------------------------ lecturas
async def para_scoring_del_mes(db: AsyncSession, periodo: str) -> list[Coaching]:
    """Los que pesan en la gestión del mes: con fecha en el mes (o hasta 14 días después, para el foco de las
    alertas de fin de mes) o con el seguimiento en el mes. Sin los anulados."""
    primero, ultimo = limites(periodo)
    q = select(Coaching).where(
        Coaching.operativa == OPERATIVA, Coaching.estado != "anulado",
        or_(and_(Coaching.fecha >= primero, Coaching.fecha <= ultimo + timedelta(days=14)),
            and_(Coaching.seguimiento_fecha >= primero, Coaching.seguimiento_fecha <= ultimo)))
    return list((await db.execute(q)).scalars().all())


def para_scoring(cs: list[Coaching]) -> list[dict[str, Any]]:
    return [{"operador_id": c.operador_id, "supervisor_id": c.supervisor_id, "metrica": c.metrica, "fecha": c.fecha,
             "seguimiento_fecha": c.seguimiento_fecha, "seguimiento_dia": dia_local(c.seguimiento_at)}
            for c in cs if c.estado != "anulado"]


async def del_supervisor(db: AsyncSession, supervisor_id: str, periodo: str) -> list[Coaching]:
    """Los coachings del supervisor con fecha en el mes (con los anulados, que se muestran tachados)."""
    primero, ultimo = limites(periodo)
    q = select(Coaching).where(Coaching.operativa == OPERATIVA, Coaching.supervisor_id == supervisor_id,
                               Coaching.fecha >= primero, Coaching.fecha <= ultimo
                               ).order_by(Coaching.fecha.desc(), Coaching.created_at.desc())
    return list((await db.execute(q)).scalars().all())


async def abiertos(db: AsyncSession, supervisor_id: str) -> list[Coaching]:
    """Los compromisos del supervisor que esperan su seguimiento (de cualquier mes)."""
    q = select(Coaching).where(Coaching.operativa == OPERATIVA, Coaching.supervisor_id == supervisor_id,
                               Coaching.estado == "abierto").order_by(Coaching.seguimiento_fecha, Coaching.fecha)
    return list((await db.execute(q)).scalars().all())


async def notas(db: AsyncSession, supervisor_id: str, periodo: str) -> list[BitacoraNota]:
    primero, ultimo = limites(periodo)
    q = select(BitacoraNota).where(BitacoraNota.operativa == OPERATIVA, BitacoraNota.supervisor_id == supervisor_id,
                                   BitacoraNota.fecha >= primero, BitacoraNota.fecha <= ultimo
                                   ).order_by(BitacoraNota.fecha.desc(), BitacoraNota.created_at.desc())
    return list((await db.execute(q)).scalars().all())


async def eventos(db: AsyncSession, coaching_id: str) -> list[CoachingEvento]:
    q = select(CoachingEvento).where(CoachingEvento.coaching_id == coaching_id).order_by(CoachingEvento.at)
    return list((await db.execute(q)).scalars().all())


def evento(db: AsyncSession, c: Coaching, tipo: str, por: str, /, **datos: Any) -> None:
    db.add(CoachingEvento(coaching_id=c.id, tipo=tipo, por=por, datos=_json(datos)))


def _json(x: Any) -> Any:
    if isinstance(x, dict):
        return {k: _json(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_json(v) for v in x]
    if isinstance(x, (date, datetime)):
        return x.isoformat()
    return x


# ------------------------------------------------------------------ foto al registrar
_CLAVES_COMP = ("clave", "valor", "rel", "netas", "esperado", "evaluables", "sin_uso", "horas", "sobre_meta")


def _edad_y_uso(ln: dict[str, Any]) -> tuple[int | None, bool]:
    return ln.get("dias"), bool(ln["sin_uso"])


def _dia_venta(ln: dict[str, Any]) -> date | None:
    return ln["venta"] or _fecha(ln.get("fecha_activacion"))


async def foto(db: AsyncSession, op: Operador, fecha: date, scoring_asesor: dict[str, Any] | None) -> dict[str, Any]:
    """Cómo estaba el asesor al registrar: sus componentes del scoring y sus Pospago vendidas antes del coaching
    por antigüedad (con eso se mide después el uso con la misma antigüedad)."""
    out: dict[str, Any] = {"registrado": ahora().isoformat()}
    if scoring_asesor:
        out["score"] = scoring_asesor.get("total")
        out["componentes"] = [{k: c.get(k) for k in _CLAVES_COMP if k in c} for c in scoring_asesor.get("componentes", [])]
    if op.vendedor:
        lineas, cortes = [], []
        for per in (mes_anterior(mes_de(fecha)), mes_de(fecha)):
            r, lns = await ventas_del_mes(db, per)
            if not r:
                continue
            cortes.append(r.fecha_dato.isoformat() if r.fecha_dato else None)
            lineas += [_edad_y_uso(ln) for ln in lns if ln["vendedor"] == op.vendedor and ln["producto"] == "Pospago"
                       and (_dia_venta(ln) or fecha) < fecha]
        out["uso"] = {"edades": histograma(lineas), "corte": max((c for c in cortes if c), default=None)}
    return out


# ------------------------------------------------------------------ impacto medido
class Medidor:
    """Mide el impacto de los coachings con los informes de Productividad y Ventas Netas (los lee una vez)."""

    def __init__(self, db: AsyncSession, hoy: date):
        self.db, self.hoy = db, hoy
        self._prod: dict[str, dict[str, list[tuple[date, int, int]]]] = {}
        self._vn: dict[str, tuple[Any, list[dict[str, Any]]]] = {}

    async def _prod_mes(self, periodo: str) -> dict[str, list[tuple[date, int, int]]]:
        if periodo not in self._prod:
            self._prod[periodo] = (await productividad_del_mes(self.db, periodo))[0]
        return self._prod[periodo]

    async def _vn_mes(self, periodo: str) -> tuple[Any, list[dict[str, Any]]]:
        if periodo not in self._vn:
            self._vn[periodo] = await ventas_del_mes(self.db, periodo)
        return self._vn[periodo]

    def _meses(self, desde: date, hasta: date) -> list[str]:
        out, m, tope = [], mes_de(desde), min(mes_de(hasta), mes_de(self.hoy))
        while m <= tope:
            out.append(m)
            m = mes_siguiente(m)
        return out

    async def _filas(self, clave: str, desde: date, hasta: date) -> list[tuple[date, int, int]]:
        out = []
        for m in self._meses(desde, hasta):
            out += [f for f in (await self._prod_mes(m)).get(clave, []) if desde <= f[0] <= hasta]
        return out

    async def _netas(self, vendedor: str, producto: str, desde: date, hasta: date) -> tuple[dict[date, int], date | None]:
        """Netas por día de venta y hasta qué día se conocen las activaciones (informes de meses seguidos)."""
        netas: dict[date, int] = {}
        activaciones = None
        meses = self._meses(desde, limites(mes_siguiente(mes_de(hasta)))[0])
        for m in meses:
            r, lns = await self._vn_mes(m)
            if not r or not r.fecha_dato:
                break
            for ln in lns:
                d = ln["venta"]
                if ln["vendedor"] == vendedor and ln["producto"] == producto and d and desde <= d <= hasta:
                    netas[d] = netas.get(d, 0) + 1
            activaciones = r.fecha_dato
            if r.fecha_dato < limites(m)[1]:
                break  # ese informe no llega a fin de mes: de ahí en adelante no se sabe
        return netas, activaciones

    async def _uso_despues(self, vendedor: str, fecha: date) -> tuple[dict[str, list[int]], int, str | None]:
        lineas, corte = [], None
        for m in self._meses(fecha, self.hoy):
            r, lns = await self._vn_mes(m)
            if not r or not r.fecha_dato:
                continue
            corte = max(corte, r.fecha_dato) if corte else r.fecha_dato
            lineas += [_edad_y_uso(ln) for ln in lns if ln["vendedor"] == vendedor and ln["producto"] == "Pospago"
                       and (_dia_venta(ln) or fecha) > fecha]
        edad_max = (corte - (fecha + timedelta(days=1))).days if corte else -1
        return histograma(lineas), edad_max, corte.isoformat() if corte else None

    async def medir(self, c: Coaching, op: Operador | None) -> dict[str, Any]:
        hasta = self.hoy - timedelta(days=1)  # el día de hoy todavía no terminó
        m = c.metrica
        if m == "otra":
            return sin_medicion()
        if op is None:
            return sin_medicion(m, "El asesor ya no está en el maestro de operadores.")
        ventana = (c.fecha - timedelta(days=DIAS_ATRAS), min(hasta, c.fecha + timedelta(days=DIAS_ATRAS)))
        if m == "conversacion":
            if not op.agente_clave:
                return sin_medicion(m, "Sin nombre en la plataforma de llamadas: no hay datos de conversación.")
            return impacto_conversacion(await self._filas(op.agente_clave, *ventana), c.fecha, hasta)
        if m in PRODUCTO:
            if not op.vendedor:
                return sin_medicion(m, "Sin nombre de vendedor: sus netas no se pueden medir.")
            if not op.agente_clave:
                return sin_medicion(m, "Sin nombre en la plataforma de llamadas: no hay horas conectadas.")
            netas, activaciones = await self._netas(op.vendedor, PRODUCTO[m], *ventana)
            maduras = activaciones - timedelta(days=DIAS_MADURACION) if activaciones else None
            return impacto_ventas(m, await self._filas(op.agente_clave, *ventana), netas, c.fecha, hasta, maduras)
        if m == "uso":
            if not op.vendedor:
                return sin_medicion(m, "Sin nombre de vendedor: sus líneas no se pueden medir.")
            base = (c.base or {}).get("uso")
            despues, edad_max, corte = await self._uso_despues(op.vendedor, c.fecha)
            return impacto_uso(base["edades"] if base else None, despues, edad_max, base.get("corte") if base else None, corte)
        return sin_medicion(m)


# ------------------------------------------------------------------ salida
def a_dict(c: Coaching, *, nombres: dict[str, str], ops: dict[str, Operador], hoy: date,
           impacto: dict[str, Any] | None = None, momento: datetime | None = None, mio: bool = False) -> dict[str, Any]:
    o = ops.get(c.operador_id)
    return {
        "id": c.id, "supervisor_id": c.supervisor_id, "supervisor": nombres.get(c.supervisor_id, c.supervisor_id),
        "operador_id": c.operador_id, "operador": o.nombre if o else "—", "agente": o.agente_nombre if o else None,
        "vendedor": o.vendedor if o else None,
        "fecha": c.fecha.isoformat(), "tipo": c.tipo, "metrica": c.metrica, "diagnostico": c.diagnostico,
        "compromiso": c.compromiso, "seguimiento_fecha": c.seguimiento_fecha.isoformat(), "estado": c.estado,
        "seguimiento": estado_seguimiento(c, hoy),
        "seguimiento_at": _iso(c.seguimiento_at), "seguimiento_comentario": c.seguimiento_comentario,
        "resultado": c.resultado, "impacto": impacto if impacto is not None else (c.impacto or None),
        "impacto_guardado": c.estado == "cerrado", "base": {k: v for k, v in (c.base or {}).items() if k != "uso"},
        "fuera_de_termino": c.fuera_de_termino, "anterior_id": c.anterior_id,
        "created_at": _iso(c.created_at), "updated_at": _iso(c.updated_at),
        "editable": bool(mio and momento and editable(c, momento)),
    }


def nota_dict(x: BitacoraNota, ops: dict[str, Operador]) -> dict[str, Any]:
    o = ops.get(x.operador_id or "")
    return {"id": x.id, "fecha": x.fecha.isoformat(), "tipo": x.tipo, "texto": x.texto, "operador_id": x.operador_id,
            "operador": o.nombre if o else None, "fuera_de_termino": x.fuera_de_termino, "created_at": _iso(x.created_at)}


def evento_dict(e: CoachingEvento, nombres: dict[str, str]) -> dict[str, Any]:
    return {"id": e.id, "tipo": e.tipo, "at": _iso(e.at), "por": nombres.get(e.por, e.por), "datos": e.datos or {}}


def _iso(d: datetime | None) -> str | None:
    if d is None:
        return None
    return (d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d).isoformat()
