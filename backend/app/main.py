"""FastAPI app entrypoint."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from . import models  # noqa: F401  (registra los modelos en Base.metadata)
from . import operativas as modulos_operativas  # routers, workers y modelos de cada operativa
from .api.v1 import audit, auth, operativas, perfiles, users
from .core.config import APP_NAME, settings
from .core.database import AsyncSessionLocal, Base, engine
from .core.logging import configure_logging, logger
from .core.operativas import filter_permissions
from .core.perfiles import DEFAULT_PERMISSIONS, PERFILES
from .models.profile import Profile


# Migraciones idempotentes (DDL/DML) que corren en cada boot, DESPUÉS de create_all.
# create_all crea tablas nuevas pero NO agrega columnas a tablas existentes:
# cada columna nueva en un modelo existente va acá como
#   "ALTER TABLE <tabla> ADD COLUMN IF NOT EXISTS <col> <tipo>"
# Solo se ejecutan en PostgreSQL (SQLite local/tests usa create_all y listo).
MIGRATIONS_IDEMPOTENT: list[str] = [
    # v0.2 · operativas y perfiles: operativas asignadas por usuario
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS operativas JSON NOT NULL DEFAULT '[]'::json",
    # v0.2 · roles del esqueleto → perfiles nuevos
    "UPDATE users SET role = 'analista' WHERE role = 'analyst'",
    "UPDATE users SET role = 'cliente' WHERE role = 'viewer'",
    # v0.4 · ventas netas: datos leídos del corte guardados en la base (recalcular sin el archivo)
    "ALTER TABLE ventas_netas_uploads ADD COLUMN IF NOT EXISTS parsed_gz BYTEA",
]


async def _run_migrations() -> dict[str, list[str]]:
    ok: list[str] = []
    skipped: list[str] = []
    if engine.dialect.name != "postgresql":
        return {"ok": ok, "skipped": MIGRATIONS_IDEMPOTENT[:]}
    for stmt in MIGRATIONS_IDEMPOTENT:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
            ok.append(stmt)
        except Exception as exc:  # una migración fallida no debe tumbar el boot
            logger.error(f"[migration] {stmt} -> {exc}")
            skipped.append(stmt)
    return {"ok": ok, "skipped": skipped}


async def _seed_profiles() -> int:
    """Crea los perfiles que falten con sus permisos iniciales. Nunca pisa los existentes."""
    created = 0
    async with AsyncSessionLocal() as db:
        for p in PERFILES:
            if await db.get(Profile, p["slug"]) is None:
                db.add(Profile(slug=p["slug"], permissions=filter_permissions(DEFAULT_PERMISSIONS.get(p["slug"], []))))
                created += 1
        await db.commit()
    return created


def _check_upload_dir() -> None:
    """Deja en los logs dónde se guardan los archivos y avisa si en producción no parece un disco persistente.

    En Render el disco se monta en la ruta elegida al crearlo (p. ej. /var/data): UPLOAD_DIR
    tiene que estar DENTRO de esa ruta o los archivos se pierden en cada despliegue.
    """
    path = settings.upload_path.resolve()
    try:
        probe = path / ".write-test"
        probe.write_text("ok")
        probe.unlink()
        escribible = True
    except OSError:
        escribible = False
    logger.info(f"Boot: UPLOAD_DIR={path} escribible={escribible}")
    if not escribible:
        logger.error(f"UPLOAD_DIR={path} no es escribible: las cargas van a fallar.")
    elif settings.env == "production" and not path.is_mount() and not any(p.is_mount() for p in path.parents):
        logger.error(
            f"UPLOAD_DIR={path} no está en un disco montado: en Render los archivos se pierden en cada "
            "despliegue. Configurá UPLOAD_DIR dentro del mount path del disco (p. ej. /var/data/uploads)."
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    logger.info("Boot: ensuring DB schema (create_all)")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    result = await _run_migrations()
    logger.info(f"Boot: migrations ok={len(result['ok'])} skipped={len(result['skipped'])}")
    logger.info(f"Boot: perfiles sembrados={await _seed_profiles()}")
    _check_upload_dir()
    if settings.env == "production" and settings.secret_key in ("change-me", ""):
        logger.error("SECRET_KEY no configurada en producción: los tokens son inseguros.")

    # Workers de las operativas, supervisados: si uno muere por cualquier
    # excepción se loguea y se relanza solo (nunca queda una cola muerta).
    async def _supervisar(nombre, factory):
        while True:
            try:
                await factory()
                logger.error(f"[supervisor] worker {nombre} terminó inesperadamente; relanzando en 10s")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception(f"[supervisor] worker {nombre} murió ({exc}); relanzando en 10s")
            await asyncio.sleep(10)

    tasks = [asyncio.create_task(_supervisar(n, f)) for n, f in modulos_operativas.WORKERS.items()]
    logger.info(f"Boot: workers iniciados: {', '.join(modulos_operativas.WORKERS) or 'ninguno'}")
    yield
    for t in tasks:
        t.cancel()
    logger.info("Shutdown")


app = FastAPI(
    title=APP_NAME,
    version="0.1.0",
    description="Plataforma de la Gerencia Expansión RM. Operado por Voicenter S.A.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
@app.get("/api/v1/health")  # vía el proxy de Next (puerto público): valida front + back
async def health() -> dict[str, str]:
    return {"status": "ok", "env": settings.env}


@app.post("/api/v1/admin/migrate")
async def trigger_migrations(token: str | None = None) -> dict:
    """Emergencia: re-corre las migraciones idempotentes. Auth: ?token=<SECRET_KEY>."""
    if not token or token != settings.secret_key:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Token inválido")
    return await _run_migrations()


app.include_router(auth.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(audit.router, prefix="/api/v1")
app.include_router(perfiles.router, prefix="/api/v1")
app.include_router(operativas.router, prefix="/api/v1")

# --- Operativas (módulos independientes, ver app/operativas/) ---
for r in modulos_operativas.ROUTERS:
    app.include_router(r, prefix="/api/v1")
