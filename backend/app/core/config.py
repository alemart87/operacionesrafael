"""Application settings loaded from environment."""
from __future__ import annotations

from pathlib import Path
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent.parent.parent

APP_NAME = "Operaciones Voicenter · Gerencia Expansión RM"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: str = "development"
    secret_key: str = "change-me"

    database_url: str = "sqlite+aiosqlite:///./local.db"

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, v: str) -> str:
        """Render entrega `postgresql://` → convertir a `postgresql+asyncpg://` para SQLAlchemy async."""
        if v.startswith("postgres://"):
            v = v.replace("postgres://", "postgresql://", 1)
        if v.startswith("postgresql://"):
            v = v.replace("postgresql://", "postgresql+asyncpg://", 1)
        # Render incluye `?sslmode=require`, que asyncpg no entiende.
        if "?sslmode=" in v and "+asyncpg" in v:
            v = v.split("?sslmode=")[0]
        return v

    # Superadmin: SIEMPRE desde env, nunca en DB.
    superadmin_email: str = "admin@voicenter.com.py"
    superadmin_password: str = ""        # opción simple: password en plano
    superadmin_password_hash: str = ""   # opción avanzada: hash bcrypt
    superadmin_name: str = "Administrador Voicenter"

    jwt_algorithm: str = "HS256"
    jwt_access_expire_minutes: int = 60
    jwt_refresh_expire_days: int = 7

    # Protección básica contra fuerza bruta en /auth/login (por IP + email).
    login_max_attempts: int = 8
    login_window_minutes: int = 15

    upload_dir: str = "./uploads"
    max_upload_size_mb: int = 20

    log_level: str = "INFO"
    audit_retention_days: int = 365

    cors_origins: str = "http://localhost:3000,http://localhost:8080"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def upload_path(self) -> Path:
        path = Path(self.upload_dir)
        path.mkdir(parents=True, exist_ok=True)
        return path


settings = Settings()
