"""FastAPI app entrypoint."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from . import models  # noqa: F401  (registra los modelos en Base.metadata)
from .api.v1 import audit, auth, operativas, perfiles, televentas_claro, users
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    logger.info("Boot: ensuring DB schema (create_all)")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    result = await _run_migrations()
    logger.info(f"Boot: migrations ok={len(result['ok'])} skipped={len(result['skipped'])}")
    logger.info(f"Boot: perfiles sembrados={await _seed_profiles()}")
    if settings.env == "production" and settings.secret_key in ("change-me", ""):
        logger.error("SECRET_KEY no configurada en producción: los tokens son inseguros.")
    yield
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

# --- Operativas (módulos independientes) ---
app.include_router(televentas_claro.router, prefix="/api/v1")
