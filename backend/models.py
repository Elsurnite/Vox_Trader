# Vox Trader Backend - Models
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    name: Optional[str] = None
    demo_balance: float = 10000.0
    demo_mode: bool = False
    balance: float = 0.0  # AI kullanım bakiyesi (USD)
    created_at: datetime

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class BinanceKeysUpdate(BaseModel):
    api_key: str
    api_secret: str


class BinanceKeysResponse(BaseModel):
    has_keys: bool
    api_key_masked: str | None = None
