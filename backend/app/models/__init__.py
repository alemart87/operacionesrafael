"""Modelos de la plataforma. Importar todos acá para que `Base.metadata.create_all` los registre.

Los modelos de cada operativa viven en `operativas/<slug>/` y se registran al
importar el paquete `operativas` (ver main.py).
"""
from .agent import AgentConversation, AgentMessage  # noqa: F401
from .audit import AuditLog  # noqa: F401
from .profile import Profile  # noqa: F401
from .user import User  # noqa: F401
