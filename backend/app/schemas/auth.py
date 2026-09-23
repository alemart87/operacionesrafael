from typing import List, Optional

from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_email: str
    user_role: str
    user_name: str
    user_photo_url: Optional[str] = None
    user_allowed_modules: Optional[List[str]] = None


class TokenRefresh(BaseModel):
    refresh_token: str
