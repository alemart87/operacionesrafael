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

    # Creación rápida de usuarios: vigencia del link y del QR, y cupo máximo de registros por link.
    invitacion_minutos: int = 30
    invitacion_max_usos: int = 100

    upload_dir: str = "./uploads"
    max_upload_size_mb: int = 20

    # Procesamiento aislado de archivos subidos (subproceso con límites): un
    # archivo malo NUNCA puede tumbar la API.
    upload_proc_timeout_s: int = 180   # mata el subproceso si tarda más
    # Tope de memoria del subproceso (MB). 0 = sin tope (recomendado): RLIMIT_AS
    # mide memoria virtual y en hosts multi-core da falsos MemoryError.
    upload_proc_mem_mb: int = 0

    # --- Agentes IA (OpenAI Agents SDK). Sin API key el agente se ve pero avisa. ---
    openai_api_key: str = ""
    agent_model: str = "gpt-5.4"
    agent_reasoning_effort: str = "medium"   # minimal | low | medium | high
    agent_reasoning_summary: str = "auto"    # auto | detailed | "" (desactivado)
    agent_max_history: int = 20              # mensajes de contexto por conversación
    agent_max_tool_turns: int = 30           # iteraciones máximas de tools por respuesta
    # Precios del modelo (USD por 1M tokens) para el costo de cada respuesta.
    agent_price_input_per_mtok: float = 2.50
    agent_price_cached_input_per_mtok: float = 0.25
    agent_price_output_per_mtok: float = 15.00

    @property
    def agent_enabled(self) -> bool:
        return bool(self.openai_api_key)

    # --- Transcripción de los audios del coaching (OpenAI, con la misma OPENAI_API_KEY). ---
    # gpt-transcribe (US$ 0,0045/min) es el vigente; gpt-4o-mini-transcribe es más barato pero sale de la API el 26/02/2027.
    transcripcion_modelo: str = "gpt-transcribe"
    transcripcion_max_segundos: int = 300          # por audio
    transcripcion_max_mb: int = 15                 # por audio (OpenAI acepta hasta 25 MB)
    transcripcion_minutos_dia: int = 90            # por usuario y por día: tope de costo
    transcripcion_retencion_dias: int = 365        # después se borra el archivo; quedan el texto y la huella
    # Solo pruebas y demostración: transcribe con un texto fijo sin llamar a OpenAI (nunca en producción).
    transcripcion_simulador: bool = False
    transcripcion_simulador_demora: float = 0.0

    # --- Entrenamientos con IA de Capacitación (OpenAI Responses API, con la misma OPENAI_API_KEY). ---
    # GPT Luna: el modelo rápido y económico de OpenAI; el cliente simulado responde con poco razonamiento (rápido) y el
    # evaluador con más.
    entrenamiento_modelo: str = "gpt-6-luna"
    entrenamiento_esfuerzo_chat: str = "low"           # none | low | medium | high
    entrenamiento_esfuerzo_eval: str = "medium"
    entrenamiento_respuestas_dia: int = 300            # respuestas del cliente por postulante y por día: tope de costo
    entrenamiento_meta_postulante: int = 15            # mínimo por postulante (guía, no tope: pueden hacer más)
    capacitacion_registro_minutos: int = 20           # el link de creación rápida de postulantes de un grupo
    capacitacion_registro_max: int = 60               # cuántos se pueden registrar con un mismo link
    ipv_minutos: int = 75                             # tiempo del test IPV (1 h 15 min) desde que empieza; vencido, se reinicia completo
    # Precio (US$ por 1M tokens) para el costo estimado de cada conversación; confirmalo en la consola de OpenAI.
    entrenamiento_precio_entrada_mtok: float = 0.10
    entrenamiento_precio_salida_mtok: float = 0.50
    # Solo pruebas y demostración: un cliente y un evaluador simulados, sin llamar a OpenAI (nunca en producción).
    entrenamiento_simulador: bool = False
    entrenamiento_simulador_demora: float = 0.0

    # --- Voi, el agente de la plataforma (Claude Managed Agents). Sin API key se ve, pero avisa. ---
    anthropic_api_key: str = ""
    # Secreto `whsec_…` del webhook registrado en la consola de Anthropic (Manage → Webhooks).
    anthropic_webhook_signing_key: str = ""
    asistente_modelo: str = "claude-sonnet-5-5"
    # Solo pruebas y demostración: un motor simulado que no llama a Anthropic (nunca en producción).
    asistente_simulador: bool = False

    # --- Analizador semántico de coaching: informes con Claude (Haiku), con la misma ANTHROPIC_API_KEY. ---
    analisis_modelo: str = "claude-haiku-5-5"
    analisis_esfuerzo: str = "medium"             # low | medium | high
    analisis_max_coachings: int = 300             # por informe (los más recientes del rango)
    analisis_informes_dia: int = 20               # por usuario y por día: tope de costo
    # Solo pruebas y demostración: arma el informe con las estadísticas, sin llamar a Anthropic (nunca en producción).
    analisis_simulador: bool = False
    # --- Clima del equipo: de noche, Claude (Haiku) relee los textos del día (sin nombres) y afina el ánimo. ---
    clima_ia: bool = True                         # con ANTHROPIC_API_KEY (o el simulador del analizador)
    clima_ia_hora: int = 21                       # hora local desde la que se analiza el día
    clima_ia_dias: int = 14                       # días hacia atrás que se completan si faltan (historia)

    log_level: str = "INFO"
    audit_retention_days: int = 365
    # Política de seguridad inicial (JSON parcial) hasta que el superadmin la cambie desde Seguridad.
    security_defaults: str = ""

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
