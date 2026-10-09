"""Plazos (SLA) de los tickets de revisión, en horas hábiles de la operación (cuentas puras).

- Horario de atención: una franja por día de la semana (inicio y fin, hora de Asunción), cargada en el
  calendario de Supervisión. Los feriados y los días no laborables del calendario no cuentan.
- Un «día hábil» de plazo es la jornada completa de un día de semana (la más larga de lunes a viernes).
- Plazos por prioridad (guía del modelo): alta 2 h para la primera respuesta y 1 día para resolver;
  media 8 h y 2 días; baja 1 día y 5 días.
- Primera respuesta: desde que se crea hasta que el supervisor responde, pide datos o resuelve.
  Resolución: el reloj corre mientras el ticket está nuevo o en gestión; se detiene mientras espera
  datos de quien lo pidió y mientras está resuelto (si se reabre, sigue desde donde estaba).
- Estado del plazo: en plazo, por vencer (desde el 75% del plazo) o vencido; pausado mientras espera datos.
"""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo

ZONA = ZoneInfo("America/Asuncion")

HORARIO_DEFECTO: dict[str, list[str] | None] = {
    "0": ["07:00", "19:00"], "1": ["07:00", "19:00"], "2": ["07:00", "19:00"], "3": ["07:00", "19:00"],
    "4": ["07:00", "19:00"], "5": ["08:00", "12:00"], "6": None,
}
PLAZOS: dict[str, tuple[str, str]] = {"alta": ("2h", "1d"), "media": ("8h", "2d"), "baja": ("1d", "5d")}
POR_VENCER = 0.75
DIAS_ESPERA = 2      # sin respuesta de quien lo pidió en 2 días hábiles, el ticket se cierra solo
DIAS_REABRIR = 5     # un ticket resuelto se puede reabrir durante 5 días hábiles


def _min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def validar_horario(franjas: dict[str, Any]) -> dict[str, list[str] | None]:
    """Normaliza el horario: siete días, cada uno [inicio, fin] (inicio < fin) o None. Error con un mensaje claro."""
    out: dict[str, list[str] | None] = {}
    for d in range(7):
        f = franjas.get(str(d))
        if not f:
            out[str(d)] = None
            continue
        try:
            ini, fin = str(f[0]), str(f[1])
            a, b = _min(ini), _min(fin)
        except (ValueError, IndexError, TypeError) as exc:
            raise ValueError("Cada día lleva una hora de inicio y una de fin (HH:MM)") from exc
        if not (0 <= a < b <= 24 * 60):
            raise ValueError("La hora de fin tiene que ser posterior a la de inicio")
        out[str(d)] = [f"{a // 60:02d}:{a % 60:02d}", f"{b // 60:02d}:{b % 60:02d}"]
    if not any(out.values()):
        raise ValueError("Al menos un día tiene que tener horario de atención")
    return out


class Horario:
    """Horario de atención de la operación: cuenta y suma minutos hábiles."""

    def __init__(self, franjas: dict[str, Any] | None = None, feriados: Iterable[str] = ()):
        franjas = franjas or HORARIO_DEFECTO
        self.franjas = {int(k): (_min(v[0]), _min(v[1])) for k, v in franjas.items() if v}
        self.feriados = set(feriados)

    def dia_completo(self) -> int:
        """Minutos de un día hábil de plazo: la jornada más larga de lunes a viernes (o de la semana)."""
        semana = [b - a for d, (a, b) in self.franjas.items() if d < 5]
        return max(semana or [b - a for a, b in self.franjas.values()] or [60])

    def _franja(self, d: date) -> tuple[datetime, datetime] | None:
        if d.isoformat() in self.feriados or d.weekday() not in self.franjas:
            return None
        a, b = self.franjas[d.weekday()]
        base = datetime(d.year, d.month, d.day, tzinfo=ZONA)
        return base + timedelta(minutes=a), base + timedelta(minutes=b)

    def habiles(self, desde: datetime, hasta: datetime) -> float:
        """Minutos hábiles entre dos momentos."""
        if hasta <= desde:
            return 0.0
        a, b = desde.astimezone(ZONA), hasta.astimezone(ZONA)
        total, d = 0.0, a.date()
        while d <= b.date():
            f = self._franja(d)
            if f:
                ini, fin = max(f[0], a), min(f[1], b)
                if fin > ini:
                    total += (fin - ini).total_seconds() / 60
            d += timedelta(days=1)
        return total

    def sumar(self, desde: datetime, minutos: float) -> datetime:
        """El momento en que se cumplen `minutos` hábiles desde `desde` (en UTC)."""
        a = desde.astimezone(ZONA)
        d, resto = a.date(), max(minutos, 0.0)
        for _ in range(800):
            f = self._franja(d)
            if f:
                ini = max(f[0], a)
                if f[1] > ini:
                    disponible = (f[1] - ini).total_seconds() / 60
                    if resto <= disponible:
                        return (ini + timedelta(minutes=resto)).astimezone(timezone.utc)
                    resto -= disponible
            d += timedelta(days=1)
        return (a + timedelta(days=800)).astimezone(timezone.utc)

    def a_minutos(self, plazo: str) -> int:
        """'2h' → 120; '1d' → un día hábil completo."""
        n, unidad = float(plazo[:-1]), plazo[-1]
        return int(round(n * (self.dia_completo() if unidad == "d" else 60)))


def plazos(prioridad: str, horario: Horario) -> tuple[int, int]:
    """Minutos hábiles para la primera respuesta y para la resolución según la prioridad."""
    r, s = PLAZOS[prioridad]
    return horario.a_minutos(r), horario.a_minutos(s)


def _aware(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=timezone.utc) if d is not None and d.tzinfo is None else d


def estado(t: Any, horario: Horario, ahora: datetime) -> dict[str, Any]:
    """Cómo va un ticket contra sus plazos. `t` tiene: estado, created_at, respuesta_at, respuesta_min,
    consumido_min, corriendo_desde, sla_respuesta_min, sla_resolucion_min, motivo_cierre."""
    creado, corriendo = _aware(t.created_at), _aware(t.corriendo_desde)
    sla_r, sla_s = t.sla_respuesta_min, t.sla_resolucion_min
    if t.respuesta_at is not None:
        resp = t.respuesta_min if t.respuesta_min is not None else horario.habiles(creado, _aware(t.respuesta_at))
        resp_ok: bool | None = resp <= sla_r
        resp_vence = None
    else:
        resp = horario.habiles(creado, ahora)
        resp_ok = False if resp > sla_r else None
        resp_vence = horario.sumar(creado, sla_r).isoformat() if resp_ok is None else None
    consumido = (t.consumido_min or 0.0) + (horario.habiles(corriendo, ahora) if corriendo else 0.0)
    if t.estado == "resuelto":
        res_ok: bool | None = consumido <= sla_s
    else:
        res_ok = False if consumido > sla_s else None
    res_vence = horario.sumar(ahora, sla_s - consumido).isoformat() if corriendo and res_ok is None else None

    cancelado = t.estado == "cerrado"
    if cancelado:
        cumple = None  # cerrado sin resolver (lo cancelaron o no contestaron los datos): no cuenta
    elif resp_ok is False or res_ok is False:
        cumple = False
    elif t.estado == "resuelto":
        cumple = bool(resp_ok) and bool(res_ok)
    else:
        cumple = None

    pct_r = resp / sla_r if sla_r else 0.0
    pct_s = consumido / sla_s if sla_s else 0.0
    if cancelado:
        situacion = "cerrado"
    elif t.estado == "resuelto":
        situacion = "cumplido" if cumple else "fuera_de_plazo"
    elif cumple is False:
        situacion = "vencido"
    elif t.estado == "esperando":
        situacion = "pausado"
    elif max(pct_r if t.respuesta_at is None else 0.0, pct_s) >= POR_VENCER:
        situacion = "por_vencer"
    else:
        situacion = "en_plazo"
    return {
        "situacion": situacion, "cumple": cumple,
        "respuesta": {"min": round(resp, 1), "plazo": sla_r, "pct": round(pct_r * 100, 1), "cumplio": resp_ok,
                      "vence": resp_vence},
        "resolucion": {"min": round(consumido, 1), "plazo": sla_s, "pct": round(pct_s * 100, 1), "cumplio": res_ok,
                       "vence": res_vence, "corre": bool(corriendo)},
    }


def percentil(valores: Iterable[float], p: float) -> float | None:
    """Percentil por rango más cercano: el valor que no supera el p% de los casos (mediana = 50)."""
    xs = sorted(valores)
    if not xs:
        return None
    k = max(math.ceil(p / 100 * len(xs)) - 1, 0)
    return round(xs[k], 1)
