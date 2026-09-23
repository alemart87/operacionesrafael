"""Importar todos los modelos acá para que `Base.metadata.create_all` los registre."""
from .audit import AuditLog  # noqa: F401
from .profile import Profile  # noqa: F401
from .user import User  # noqa: F401
