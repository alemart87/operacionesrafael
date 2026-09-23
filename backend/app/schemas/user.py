from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


ROLE_PATTERN = "^(analyst|viewer)$"


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=255)
    role: str = Field(default="analyst", pattern=ROLE_PATTERN)
    # Solo aplica a lectores; null = acceso total
    allowed_modules: Optional[List[str]] = None


class UserUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=255)
    is_active: Optional[bool] = None
    role: Optional[str] = Field(default=None, pattern=ROLE_PATTERN)
    allowed_modules: Optional[List[str]] = None


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
    allowed_modules: Optional[List[str]] = None
    created_at: datetime
    last_login_at: Optional[datetime] = None
