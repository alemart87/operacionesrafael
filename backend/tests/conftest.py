"""Configura el entorno ANTES de importar la app."""
import os
from pathlib import Path

_DB = Path(__file__).resolve().parent.parent / "test_smoke.db"
if _DB.exists():
    _DB.unlink()

os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_DB.as_posix()}"
os.environ["SUPERADMIN_EMAIL"] = "admin@voicenter.com.py"
os.environ["SUPERADMIN_PASSWORD"] = "Test1234!"
os.environ["SUPERADMIN_PASSWORD_HASH"] = ""
os.environ["UPLOAD_DIR"] = "./test_uploads"
os.environ["SECRET_KEY"] = "test-secret-key-1234567890"
os.environ["LOGIN_MAX_ATTEMPTS"] = "3"
os.environ["OPENAI_API_KEY"] = ""  # los tests nunca llaman a OpenAI
# Política permisiva para los tests generales; test_seguridad prueba la política real vía API.
os.environ["SECURITY_DEFAULTS"] = (
    '{"contrasenas": {"min_largo": 8, "mayus_minus": false, "numero": false, "cambio_primer_ingreso": false},'
    ' "bloqueo": {"max_intentos": 20}}'
)
