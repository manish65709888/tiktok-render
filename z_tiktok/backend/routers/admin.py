"""Admin router – user CRUD, stats, expired-user cleanup, API tokens."""

import re
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from passlib.context import CryptContext
from sqlalchemy.orm import Session as SASession

from database import get_db
from dependencies import require_admin
from models import ApiToken, User
from schemas import CreateTokenRequest, CreateUserRequest, UpdateUserRequest

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Only allow alphanumeric, underscores, hyphens, dots (1–50 chars)
_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_\-.]{1,50}$")
_MIN_PASSWORD_LENGTH = 6


def _user_to_dict(u: User) -> dict:
    return {
        "id": u.id,
        "username": u.username,
        "role": u.role,
        "createdAt": u.created_at.isoformat() if u.created_at else None,
        "expiresAt": u.expires_at.isoformat() if u.expires_at else None,
        "isActive": u.is_active and (datetime.utcnow() < u.expires_at),
        "lastLoginAt": u.last_login_at.isoformat() if u.last_login_at else None,
    }


# ── POST /api/admin/users ────────────────────────────────────────────────────

@router.post("/users")
def create_user(
    body: CreateUserRequest,
    db: SASession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    # Validate username format
    if not _USERNAME_RE.match(body.username):
        raise HTTPException(
            status_code=400,
            detail="Username must be 1–50 characters: letters, numbers, _ - . only",
        )

    # Validate password strength
    if len(body.password) < _MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {_MIN_PASSWORD_LENGTH} characters",
        )

    # Check for duplicate username
    existing = db.query(User).filter(User.username == body.username).first()
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")

    now = datetime.utcnow()
    user = User(
        username=body.username,
        password_hash=pwd_context.hash(body.password),
        role="user",
        created_at=now,
        expires_at=now + timedelta(minutes=body.durationMinutes),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {"success": True, "user": _user_to_dict(user)}


# ── GET /api/admin/users ─────────────────────────────────────────────────────

@router.get("/users")
def list_users(
    search: str = Query(None, max_length=100),
    db: SASession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    q = db.query(User).filter(User.role != "admin")
    if search:
        # Sanitize: strip SQL wildcards and only allow safe characters
        safe_search = re.sub(r"[^\w\s\-_.@]", "", search).strip()
        if safe_search:
            q = q.filter(User.username.ilike(f"%{safe_search}%"))
    users = q.order_by(User.created_at.desc()).all()

    now = datetime.utcnow()
    soon = now + timedelta(hours=24)

    total = len(users)
    active = sum(1 for u in users if u.is_active and now < u.expires_at)
    expired = sum(1 for u in users if now >= u.expires_at)
    expiring_soon = sum(1 for u in users if now < u.expires_at <= soon)

    return {
        "users": [_user_to_dict(u) for u in users],
        "stats": {
            "total": total,
            "active": active,
            "expired": expired,
            "expiringSoon": expiring_soon,
        },
    }


# ── PUT /api/admin/users/{userId} ────────────────────────────────────────────

@router.put("/users/{user_id}")
def update_user(
    user_id: str,
    body: UpdateUserRequest,
    db: SASession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.password:
        if len(body.password) < _MIN_PASSWORD_LENGTH:
            raise HTTPException(
                status_code=400,
                detail=f"Password must be at least {_MIN_PASSWORD_LENGTH} characters",
            )
        user.password_hash = pwd_context.hash(body.password)
    if body.extendMinutes:
        # Extend from the later of now or current expiry
        base = max(datetime.utcnow(), user.expires_at)
        user.expires_at = base + timedelta(minutes=body.extendMinutes)

    db.commit()
    db.refresh(user)
    return {"success": True, "user": _user_to_dict(user)}


# ── DELETE /api/admin/users/{userId} ─────────────────────────────────────────

@router.delete("/users/{user_id}")
def delete_user(
    user_id: str,
    db: SASession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
    return {"success": True}


# ── DELETE /api/admin/users/expired ──────────────────────────────────────────

@router.delete("/users/expired")
def delete_expired_users(
    db: SASession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    now = datetime.utcnow()
    count = db.query(User).filter(User.expires_at < now, User.role != "admin").delete()
    db.commit()
    return {"success": True, "deleted": count}


# ── POST /api/admin/tokens ───────────────────────────────────────────────────

@router.post("/tokens")
def create_api_token(
    body: CreateTokenRequest,
    db: SASession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Create an API token for a given user (by username)."""
    user = db.query(User).filter(User.username == body.username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    now = datetime.utcnow()
    raw_token = secrets.token_urlsafe(48)

    api_token = ApiToken(
        token=raw_token,
        user_id=user.id,
        name=body.name or f"token-{user.username}",
        expires_at=now + timedelta(days=body.expireDays),
    )
    db.add(api_token)
    db.commit()
    db.refresh(api_token)

    return {
        "success": True,
        "token": raw_token,
        "tokenId": api_token.id,
        "name": api_token.name,
        "username": user.username,
        "expiresAt": api_token.expires_at.isoformat(),
    }


# ── GET /api/admin/tokens ────────────────────────────────────────────────────

@router.get("/tokens")
def list_api_tokens(
    db: SASession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    tokens = (
        db.query(ApiToken)
        .order_by(ApiToken.created_at.desc())
        .all()
    )
    now = datetime.utcnow()
    result = []
    for t in tokens:
        user = db.query(User).filter(User.id == t.user_id).first()
        result.append({
            "id": t.id,
            "name": t.name,
            "username": user.username if user else "(deleted)",
            "tokenPrefix": t.token[:8] + "...",
            "createdAt": t.created_at.isoformat() if t.created_at else None,
            "expiresAt": t.expires_at.isoformat(),
            "isActive": t.is_active and now < t.expires_at,
        })
    return {"tokens": result}


# ── DELETE /api/admin/tokens/{token_id} ──────────────────────────────────────

@router.delete("/tokens/{token_id}")
def revoke_api_token(
    token_id: str,
    db: SASession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    token = db.query(ApiToken).filter(ApiToken.id == token_id).first()
    if not token:
        raise HTTPException(status_code=404, detail="Token not found")
    token.is_active = False
    db.commit()
    return {"success": True}
