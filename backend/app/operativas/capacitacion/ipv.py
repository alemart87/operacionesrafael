"""Corrección automática del IPV — Capacitación y Mentoría.

**IPV** (87 ítems, `ipv_datos.py`): cada escala suma 1 por cada respuesta que coincide con su clave y el puntaje directo
se convierte a **decatipo** (1 a 10) con su baremo. Nivel: 1 a 3 inferior, 4 a 7 término medio, 8 a 10 superior.

- Escalas: DGV (disposición general para la venta), I comprensión, II adaptabilidad, III control de sí mismo,
  IV tolerancia a la frustración, V combatividad, VI dominancia, VII seguridad, VIII actividad, IX sociabilidad.
- Receptividad = I + II + III + IV y agresividad = V + VI + VII + VIII (con sus propios baremos).
- Tolerancia a la frustración: la clave marca las respuestas de baja tolerancia, así que el puntaje es 8 menos las
  coincidencias. (La planilla tenía `8-O4+O5+…`: restaba solo el primer ítem y sumaba los demás.)
- También se corrigen otros errores de la planilla: los ítems 56 y 86 leían la respuesta del ítem anterior (acá cada
  respuesta es la de su ítem) y en «IPV_DIGITAL» varios baremos estaban incompletos (se usan los de «Correccion_IPV»).
- Señales de calidad de la aplicación: si terminó muy rápido o si casi todas las respuestas son la misma letra.
"""
from __future__ import annotations

from collections import Counter
from typing import Any

from .ipv_datos import BAREMOS, CLAVE, PREGUNTAS

VERSION = 1
TOTAL = len(PREGUNTAS)
OPCIONES = {n: tuple(ops) for n, _, ops in PREGUNTAS}
MIN_SEGUNDOS = 6 * 60          # menos que esto para 87 ítems: probablemente contestó sin leer
MAX_MISMA_LETRA = 0.7          # más del 70% con la misma letra: patrón de respuesta

ESCALAS: list[dict[str, Any]] = [
    {"clave": "DGV", "nombre": "Disposición general para la venta", "romano": None, "grupo": "general",
     "descripcion": "Visión global de la aptitud y la motivación para vender: combina la receptividad hacia el cliente y la "
                    "capacidad de influir en él."},
    {"clave": "receptividad", "nombre": "Receptividad", "romano": None, "grupo": "general",
     "descripcion": "Mide la cualidad empática de las personas y el nivel de adaptación a situaciones y personas diferentes."},
    {"clave": "agresividad", "nombre": "Agresividad comercial", "romano": None, "grupo": "general",
     "descripcion": "Evalúa la capacidad para soportar situaciones conflictivas o provocarlas con el deseo de ganar. Implica "
                    "también una actitud dominante o de ascendencia."},
    {"clave": "comprension", "nombre": "Comprensión", "romano": "I", "grupo": "receptividad",
     "descripcion": "Nivel de empatía y objetividad en las relaciones humanas: capacidad de integrar un suceso en su contexto."},
    {"clave": "adaptabilidad", "nombre": "Adaptabilidad", "romano": "II", "grupo": "receptividad",
     "descripcion": "Capacidad de adaptarse a situaciones y personas diferentes."},
    {"clave": "control", "nombre": "Control de sí mismo", "romano": "III", "grupo": "receptividad",
     "descripcion": "Capacidad de administrar su potencial intelectual, psicológico o físico: organizado, perseverante y hábil "
                    "para manejar sus emociones."},
    {"clave": "tolerancia", "nombre": "Tolerancia a la frustración", "romano": "IV", "grupo": "receptividad",
     "descripcion": "Capacidad de comprender los fracasos y de no personalizar demasiado las situaciones en las que se ve "
                    "implicado."},
    {"clave": "combatividad", "nombre": "Combatividad", "romano": "V", "grupo": "agresividad",
     "descripcion": "Capacidad de entrar en conflicto y soportar desacuerdos: persona porfiada y polémica."},
    {"clave": "dominancia", "nombre": "Dominancia", "romano": "VI", "grupo": "agresividad",
     "descripcion": "Capacidad de ganar o influir en los demás: persona persuasiva, con ascendencia en su entorno."},
    {"clave": "seguridad", "nombre": "Seguridad", "romano": "VII", "grupo": "agresividad",
     "descripcion": "Persona segura de sí misma, a la que le gustan las situaciones nuevas o inesperadas y capaz de enfrentar "
                    "riesgos."},
    {"clave": "actividad", "nombre": "Actividad", "romano": "VIII", "grupo": "agresividad",
     "descripcion": "Personas activas y dinámicas en el sentido físico. Puntajes bajos: personas poco deportivas."},
    {"clave": "sociabilidad", "nombre": "Sociabilidad", "romano": "IX", "grupo": "agresividad",
     "descripcion": "Persona extravertida, capaz de crear nuevos contactos, que prefiere la compañía a la soledad y es sensible a "
                    "las relaciones humanas."},
]
NOMBRE = {e["clave"]: e["nombre"] for e in ESCALAS}
NIVELES_IPV = {"inferior": "Inferior", "termino_medio": "Término medio", "superior": "Superior"}
RECEPTIVIDAD = ("comprension", "adaptabilidad", "control", "tolerancia")
AGRESIVIDAD = ("combatividad", "dominancia", "seguridad", "actividad")


class RespuestasInvalidas(ValueError):
    pass


def validar(respuestas: dict[int, str], *, completas: bool = True) -> dict[int, str]:
    """Respuestas limpias {ítem: letra}. Con `completas`, exige los 87 ítems."""
    out: dict[int, str] = {}
    for k, v in (respuestas or {}).items():
        n = int(k)
        letra = str(v or "").strip().upper()
        if n not in OPCIONES:
            raise RespuestasInvalidas(f"El ítem {n} no existe")
        if letra not in OPCIONES[n]:
            raise RespuestasInvalidas(f"La respuesta del ítem {n} tiene que ser {', '.join(OPCIONES[n])}")
        out[n] = letra
    if completas and len(out) < TOTAL:
        faltan = [n for n in OPCIONES if n not in out]
        raise RespuestasInvalidas(f"Faltan {len(faltan)} respuestas (por ejemplo, el ítem {faltan[0]})")
    return out


def nivel_ipv(decatipo: int) -> str:
    return "superior" if decatipo >= 8 else "termino_medio" if decatipo >= 4 else "inferior"


def decatipo(escala: str, directo: int) -> int:
    tabla = BAREMOS[escala]
    return tabla[max(0, min(directo, max(tabla)))]


def corregir(respuestas: dict[int, str], *, segundos: float | None = None) -> dict[str, Any]:
    """El resultado del IPV: puntaje directo, decatipo y nivel de cada escala, fortalezas, aspectos a trabajar y las
    señales de calidad de la aplicación."""
    r = validar(respuestas)
    directo: dict[str, int] = {}
    for esc, items in CLAVE.items():
        coincide = sum(1 for n, letra in items if r.get(n) == letra)
        directo[esc] = 8 - coincide if esc == "tolerancia" else coincide
    directo["receptividad"] = sum(directo[e] for e in RECEPTIVIDAD)
    directo["agresividad"] = sum(directo[e] for e in AGRESIVIDAD)
    escalas = []
    for e in ESCALAS:
        d = decatipo(e["clave"], directo[e["clave"]])
        escalas.append({"clave": e["clave"], "nombre": e["nombre"], "romano": e["romano"], "grupo": e["grupo"],
                        "directo": directo[e["clave"]], "maximo": max(BAREMOS[e["clave"]]), "decatipo": d, "nivel": nivel_ipv(d)})
    factores = [x for x in escalas if x["romano"]]
    fortalezas = [x["nombre"] for x in sorted(factores, key=lambda x: -x["decatipo"]) if x["decatipo"] >= 8]
    a_trabajar = [x["nombre"] for x in sorted(factores, key=lambda x: x["decatipo"]) if x["decatipo"] <= 3]
    letras = Counter(r.values())
    senales = []
    if segundos is not None and segundos < MIN_SEGUNDOS:
        minutos = "menos de 1 minuto" if segundos < 60 else f"{round(segundos / 60)} minutos"
        senales.append(f"Lo completó en {minutos}: muy rápido para 87 situaciones (conviene revisar con la persona).")
    letra, veces = letras.most_common(1)[0]
    if veces / TOTAL > MAX_MISMA_LETRA:
        senales.append(f"El {round(veces / TOTAL * 100)}% de las respuestas es «{letra}»: puede ser un patrón de respuesta.")
    dgv = escalas[0]
    return {
        "version": VERSION, "escalas": escalas, "fortalezas": fortalezas[:4], "a_trabajar": a_trabajar[:4], "senales": senales,
        "resumen": (f"Disposición general para la venta {NIVELES_IPV[dgv['nivel']].lower()} (decatipo {dgv['decatipo']}): "
                    f"receptividad {NIVELES_IPV[escalas[1]['nivel']].lower()} y agresividad comercial "
                    f"{NIVELES_IPV[escalas[2]['nivel']].lower()}."),
        "letras": dict(letras), "segundos": round(segundos) if segundos is not None else None,
    }


def cuestionario() -> list[dict[str, Any]]:
    """Los ítems tal como los ve el postulante (sin la clave)."""
    return [{"n": n, "texto": t, "opciones": [{"letra": k, "texto": v} for k, v in ops.items()]} for n, t, ops in PREGUNTAS]
