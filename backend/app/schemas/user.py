from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from ..core.perfiles import PERFIL_PATTERN


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=255)
    role: str = Field(pattern=PERFIL_PATTERN)
    operativas: List[str] = Field(default_factory=list)


class UserUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    is_active: Optional[bool] = None
    role: Optional[str] = Field(default=None, pattern=PERFIL_PATTERN)
    operativas: Optional[List[str]] = None


class PasswordReset(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    full_name: str
    role: str
    is_active: bool
    photo_url: Optional[str] = None
    operativas: List[str] = Field(default_factory=list)
    created_at: datetime
    last_login_at: Optional[datetime] = None


class ProfilePermissionsUpdate(BaseModel):
    permissions: List[str]
