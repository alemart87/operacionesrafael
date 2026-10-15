"""Quién usa a Voi y con qué alcance. Voi nunca ve más que el usuario: corre con sus permisos, releídos siempre."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from ..api.deps import CurrentUser, effective_permissions, load_role_permissions
from ..core.config import settings
from ..core.operativas import ALL_PERMISSIONS, OPERATIVA_SLUGS, asignables
from ..models.user import User
from .config import UTILIDAD


def puede_usar(user: CurrentUser) -> bool:
    """El superadmin siempre; los demás, si su perfil tiene la utilidad «Asistente IA» en alguna operativa."""
    return user.is_superadmin or any(p.rsplit(".", 1)[-1] == UTILIDAD for p in user.permissions)


def modo(user: CurrentUser) -> str:
    """superadmin: todo. gestion: lo que permita su perfil (el auditor también: ve todos sus módulos; Facturación e
    Integraciones no se le pueden dar, ver core/operativas). El «modo auditor» es de la conversación, no del perfil."""
    return "superadmin" if user.is_superadmin else "gestion"


def permiso_valido(user: CurrentUser, perm: str) -> bool:
    """Tiene el permiso Y su perfil lo puede tener: aunque figurara en la base, un perfil restringido no lo usa."""
    return user.is_superadmin or (user.has_perm(perm) and perm in asignables(user.role))


async def usuario(db: AsyncSession, user_id: str) -> CurrentUser | None:
    """El usuario con sus permisos de este momento (para ejecutar herramientas fuera de un pedido HTTP)."""
    if user_id == "superadmin":
        return CurrentUser(id="superadmin", email=settings.superadmin_email, role="superadmin",
                           full_name=settings.superadmin_name, operativas=sorted(OPERATIVA_SLUGS),
                           permissions=set(ALL_PERMISSIONS))
    u = await db.get(User, user_id)
    if not u or not u.is_active:
        return None
    perms = effective_permissions(await load_role_permissions(db, u.role), u.operativas, u.role)
    return CurrentUser(id=u.id, email=u.email, role=u.role, full_name=u.full_name, photo_url=u.photo_url,
                       operativas=list(u.operativas or []), permissions=perms)
