"""Dónde quedan los datos: la base (PostgreSQL) y los archivos (`UPLOAD_DIR`, en el disco persistente).

- La base guarda todas las tablas, los informes y lo necesario para recalcularlos: Ventas Netas guarda los
  datos leídos de cada planilla (`parsed_gz`), Productividad el archivo de cada corte (`contenido_gz`) y
  Facturación una copia de cada liquidación (`contenido_gz`). Así, recalcular no depende del disco.
- El disco guarda los archivos originales y las fotos de perfil. En Render se monta en la ruta que se eligió
  al crearlo (p. ej. `/var/data` o `/persistent`): `UPLOAD_DIR` tiene que quedar DENTRO de esa ruta o los
  archivos se pierden en cada despliegue. Si en producción quedó afuera y hay un solo disco montado, se usa
  `<disco>/uploads` (y queda avisado).
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.database import engine
from ..core.logging import logger

_SISTEMA = ("/proc", "/sys", "/dev", "/run", "/etc", "/boot", "/snap", "/usr", "/var/lib/docker")
_TIPOS_SISTEMA = {"proc", "sysfs", "tmpfs", "devpts", "cgroup", "cgroup2", "overlay", "squashfs", "mqueue", "nsfs",
                  "securityfs", "debugfs", "tracefs", "fusectl", "configfs", "pstore", "bpf", "autofs", "binfmt_misc"}

# Qué se resolvió al arrancar (lo muestra el diagnóstico).
ESTADO: dict[str, Any] = {"configurado": None, "efectivo": None, "ajustado": False, "disco": None}


def discos_montados() -> list[str]:
    """Puntos de montaje de discos de datos (sin el raíz ni los del sistema)."""
    puntos: list[str] = []
    try:
        for linea in Path("/proc/mounts").read_text().splitlines():
            partes = linea.split()
            if len(partes) < 3:
                continue
            punto, tipo = partes[1].replace("\\040", " "), partes[2]
            if punto == "/" or punto.startswith(_SISTEMA) or tipo in _TIPOS_SISTEMA:
                continue
            puntos.append(punto)
    except OSError:
        pass
    return sorted(set(puntos))


def disco_de(path: Path) -> str | None:
    """El disco montado que contiene la ruta (el raíz no cuenta: es el del contenedor)."""
    for p in [path, *path.parents]:
        if str(p) != "/" and p.is_mount():
            return str(p)
    return None


def resolver_upload_dir() -> dict[str, Any]:
    """Al arrancar: dónde se guardan los archivos. En producción, si `UPLOAD_DIR` no está en un disco montado y hay
    uno solo, se usa `<disco>/uploads`. Deja todo en los logs y en `ESTADO`."""
    configurado = Path(settings.upload_dir).resolve()
    ESTADO.update(configurado=str(configurado), efectivo=str(configurado), ajustado=False, disco=None)
    disco = disco_de(configurado)
    discos = discos_montados()
    if settings.env == "production" and not disco and len(discos) == 1:
        nuevo = Path(discos[0]) / "uploads"
        try:
            nuevo.mkdir(parents=True, exist_ok=True)
            settings.upload_dir = str(nuevo)
            ESTADO.update(efectivo=str(nuevo), ajustado=True)
            disco = discos[0]
            logger.warning(
                f"UPLOAD_DIR={configurado} no está en el disco persistente: se usa {nuevo} (disco montado en {discos[0]}). "
                f"Para dejarlo explícito, configurá UPLOAD_DIR={nuevo} en Render."
            )
        except OSError as exc:
            logger.error(f"No se pudo usar {nuevo} en el disco {discos[0]}: {exc}")
    ESTADO["disco"] = disco
    path = settings.upload_path.resolve()
    try:
        probe = path / ".write-test"
        probe.write_text("ok")
        probe.unlink()
        escribible = True
    except OSError:
        escribible = False
    ESTADO["escribible"] = escribible
    logger.info(f"Boot: UPLOAD_DIR={path} escribible={escribible} disco={disco or '—'}")
    if not escribible:
        logger.error(f"UPLOAD_DIR={path} no es escribible: las cargas van a fallar.")
    elif settings.env == "production" and not disco:
        logger.error(
            f"UPLOAD_DIR={path} NO está dentro de un disco montado: los archivos se pierden en cada despliegue. "
            f"Discos montados detectados: {', '.join(discos) or 'ninguno'}. "
            "Configurá la variable UPLOAD_DIR dentro del mount path del disco (p. ej. <mount path>/uploads)."
        )
    return dict(ESTADO)


def _carpetas(raiz: Path) -> list[dict[str, Any]]:
    """Archivos y bytes por carpeta de primer nivel (ventas_netas, facturacion, photos…)."""
    out: list[dict[str, Any]] = []
    if not raiz.is_dir():
        return out
    for hijo in sorted(raiz.iterdir()):
        if not hijo.is_dir():
            continue
        n = b = 0
        for base, _, archivos in os.walk(hijo):
            for a in archivos:
                try:
                    b += (Path(base) / a).stat().st_size
                    n += 1
                except OSError:
                    pass
        out.append({"carpeta": hijo.name, "archivos": n, "bytes": b})
    return out


def _existe(p: str | None) -> bool:
    try:
        return bool(p) and Path(p).is_file()
    except OSError:
        return False


async def _base(db: AsyncSession) -> dict[str, Any]:
    motor = engine.dialect.name
    out: dict[str, Any] = {"motor": motor, "version": None, "bytes": None}
    try:
        if motor == "postgresql":
            out["version"] = (await db.execute(text("SHOW server_version"))).scalar()
            out["bytes"] = (await db.execute(text("SELECT pg_database_size(current_database())"))).scalar()
            out["persistente"] = True  # un servicio aparte: no depende del disco del web service
        else:
            ruta = Path(engine.url.database or "").resolve()
            out["bytes"] = ruta.stat().st_size if ruta.is_file() else None
            # SQLite (desarrollo): persiste solo si el archivo está en un disco montado.
            out["persistente"] = settings.env != "production" or bool(disco_de(ruta))
    except Exception as exc:  # noqa: BLE001 — el diagnóstico no se cae por una consulta
        out["error"] = str(exc)[:200]
    return out


async def diagnostico(db: AsyncSession) -> dict[str, Any]:
    """Estado del almacenamiento para el superadmin: base, disco, archivos y qué se puede recalcular sin el disco."""
    from ..models.user import User
    from ..operativas.televentas_claro.facturacion.models.upload import FacturacionUpload
    from ..operativas.televentas_claro.productividad.models import ProdCorte
    from ..operativas.televentas_claro.ventas_netas.models import VentasNetasUpload

    raiz = settings.upload_path.resolve()
    disco = disco_de(raiz)
    try:
        uso = shutil.disk_usage(raiz)
        espacio = {"total": uso.total, "usado": uso.used, "libre": uso.free}
    except OSError:
        espacio = None

    # Ventas Netas: con los datos leídos en la base se recalcula sin el archivo.
    vn = (await db.execute(select(VentasNetasUpload.id, VentasNetasUpload.file_path, VentasNetasUpload.status,
                                  VentasNetasUpload.parsed_gz.isnot(None)))).all()
    vn_base = sum(1 for *_, en_base in vn if en_base)
    vn_perdidos = sum(1 for _, fp, st, en_base in vn if not en_base and st == "completed" and not _existe(fp))
    vn_archivo = sum(1 for _, fp, *_ in vn if _existe(fp))
    # Productividad: cada corte guarda su archivo en la base.
    cortes = (await db.execute(select(func.count(ProdCorte.id)))).scalar() or 0
    # Facturación: copia de cada liquidación en la base (desde esta versión) y el archivo en el disco.
    fac = (await db.execute(select(FacturacionUpload.id, FacturacionUpload.file_path,
                                   FacturacionUpload.contenido_gz.isnot(None)))).all()
    fac_base = sum(1 for *_, en_base in fac if en_base)
    fac_archivo = sum(1 for _, fp, _ in fac if _existe(fp))
    fac_perdidos = sum(1 for _, fp, en_base in fac if not en_base and not _existe(fp))
    # Fotos de perfil: solo en el disco.
    fotos = [u for (u,) in (await db.execute(select(User.photo_url).where(User.photo_url.isnot(None)))).all() if u]
    fotos_faltan = sum(1 for u in fotos if not (raiz / "photos" / u.rsplit("/", 1)[-1]).is_file())

    base = await _base(db)
    modulos = [
        {"modulo": "Ventas Netas", "total": len(vn), "en_base": vn_base, "en_disco": vn_archivo, "sin_respaldo": vn_perdidos,
         "que": "Datos leídos de cada planilla", "recalcula": "Con lo guardado en la base"},
        {"modulo": "Productividad", "total": cortes, "en_base": cortes, "en_disco": None, "sin_respaldo": 0,
         "que": "Archivo de cada corte de llamadas", "recalcula": "Con lo guardado en la base"},
        {"modulo": "Facturación", "total": len(fac), "en_base": fac_base, "en_disco": fac_archivo, "sin_respaldo": fac_perdidos,
         "que": "Liquidación original (.txt)", "recalcula": "Con la copia en la base o el archivo"},
        {"modulo": "Fotos de perfil", "total": len(fotos), "en_base": None, "en_disco": len(fotos) - fotos_faltan,
         "sin_respaldo": fotos_faltan, "que": "Imagen de cada usuario", "recalcula": "No aplica: se vuelven a subir"},
    ]

    mensajes: list[dict[str, str]] = []
    produccion = settings.env == "production"
    if not base.get("persistente", True):
        mensajes.append({"nivel": "riesgo", "texto": "La base es un archivo SQLite fuera de un disco persistente: se pierde en cada despliegue. "
                                                      "En producción usá PostgreSQL (DATABASE_URL)."})
    if produccion and not disco:
        detectados = discos_montados()
        mensajes.append({"nivel": "riesgo", "texto": f"Los archivos se guardan en {raiz}, que no está en un disco persistente: se pierden en cada "
                                                      "despliegue. En Render, agregá un disco al servicio y configurá UPLOAD_DIR=<mount path>/uploads."
                                                      + (f" Discos montados detectados: {', '.join(detectados)}." if detectados else "")})
    if ESTADO.get("ajustado"):
        mensajes.append({"nivel": "aviso", "texto": f"UPLOAD_DIR estaba configurado en {ESTADO['configurado']}, fuera del disco: se usa {ESTADO['efectivo']}. "
                                                     f"Para dejarlo explícito, configurá UPLOAD_DIR={ESTADO['efectivo']} en Render."})
    if vn_perdidos:
        mensajes.append({"nivel": "aviso", "texto": f"{vn_perdidos} carga(s) de Ventas Netas son anteriores a guardar los datos en la base y ya no tienen "
                                                     "el archivo: no se pueden recalcular. Si hace falta, subí esas planillas de nuevo."})
    if fac_perdidos:
        mensajes.append({"nivel": "aviso", "texto": f"{fac_perdidos} liquidación(es) de Facturación no tienen copia ni archivo: su informe queda, pero no "
                                                     "se pueden reprocesar sin subirlas de nuevo."})
    if fotos_faltan:
        mensajes.append({"nivel": "aviso", "texto": f"{fotos_faltan} foto(s) de perfil ya no están en el disco: se ven las iniciales hasta que se vuelvan a subir."})
    if espacio and espacio["total"] and espacio["libre"] / espacio["total"] < 0.1:
        mensajes.append({"nivel": "riesgo", "texto": "Queda menos del 10% de espacio en el disco de archivos: ampliá el disco en Render."})

    return {
        "entorno": settings.env,
        "estado": "riesgo" if any(m["nivel"] == "riesgo" for m in mensajes) else "ok",
        "base": base,
        "archivos": {
            "ruta": str(raiz), "configurado": ESTADO.get("configurado") or str(raiz), "ajustado": bool(ESTADO.get("ajustado")),
            "disco": disco, "discos": discos_montados(), "espacio": espacio, "carpetas": _carpetas(raiz),
        },
        "modulos": modulos,
        "mensajes": mensajes,
    }
