"""Pydantic schemas used for request / response validation."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── Auth ──────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class UserInfo(BaseModel):
    username: str
    role: str
    expiresAt: str  # ISO-8601


class LoginResponse(BaseModel):
    success: bool
    user: UserInfo


class AuthStatusResponse(BaseModel):
    authenticated: bool
    user: Optional[UserInfo] = None


# ── Admin – User Management ──────────────────────────────────────────────────

class CreateUserRequest(BaseModel):
    username: str
    password: str
    durationMinutes: int = Field(ge=1, description="Access duration in minutes")


class UserOut(BaseModel):
    id: str
    username: str
    role: str
    createdAt: str
    expiresAt: str
    isActive: bool
    lastLoginAt: Optional[str] = None


class UserStats(BaseModel):
    total: int
    active: int
    expired: int
    expiringSoon: int  # expiring within 24 h


class ListUsersResponse(BaseModel):
    users: List[UserOut]
    stats: UserStats


class UpdateUserRequest(BaseModel):
    password: Optional[str] = None
    extendMinutes: Optional[int] = None


# ── API Tokens ────────────────────────────────────────────────────────────────

class CreateTokenRequest(BaseModel):
    username: str
    name: Optional[str] = None
    expireDays: int = Field(default=30, ge=1, le=365, description="Token lifetime in days")


# ── Layout ────────────────────────────────────────────────────────────────────

class SaveLayoutRequest(BaseModel):
    key: str
    style: Dict[str, Any]


class LayoutResponse(BaseModel):
    ok: bool
    style: Optional[Dict[str, Any]] = None
