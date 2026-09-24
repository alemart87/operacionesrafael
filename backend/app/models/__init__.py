"""Importar todos los modelos acá para que `Base.metadata.create_all` los registre."""
from .agent import AgentConversation, AgentMessage  # noqa: F401
from .audit import AuditLog  # noqa: F401
from .facturacion_report import FacturacionReport  # noqa: F401
from .facturacion_simulacion import FacturacionSimulacion  # noqa: F401
from .facturacion_upload import FacturacionUpload  # noqa: F401
from .profile import Profile  # noqa: F401
from .user import User  # noqa: F401
