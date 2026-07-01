"""Authentication router – login / status / logout with cookie-based sessions."""

import secrets
import time
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from passlib.context import CryptContext
from sqlalchemy.orm import Session as SASession

from config import settings
from database import get_db
from models import Session as DBSession, User
from schemas import LoginRequest

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ── Simple in-memory rate limiter for login ───────────────────────────────────
_login_attempts: dict[str, list[float]] = defaultdict(list)
_MAX_LOGIN_ATTEMPTS = 5
_LOGIN_WINDOW_SECONDS = 300  # 5 minutes


def _check_rate_limit(client_ip: str):
    """Raise 429 if too many login attempts from this IP."""
    now = time.time()
    window_start = now - _LOGIN_WINDOW_SECONDS
    # Prune old entries
    _login_attempts[client_ip] = [
        t for t in _login_attempts[client_ip] if t > window_start
    ]
    if len(_login_attempts[client_ip]) >= _MAX_LOGIN_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Try again later.",
        )
    _login_attempts[client_ip].append(now)


def _create_session(db: SASession, user_id: str) -> str:
    session_id = secrets.token_urlsafe(48)
    expires_at = datetime.utcnow() + timedelta(hours=settings.SESSION_EXPIRE_HOURS)
    db_session = DBSession(
        session_id=session_id,
        user_id=user_id,
        expires_at=expires_at,
    )
    db.add(db_session)
    db.commit()
    return session_id


def _set_csrf_cookie(response: Response):
    """Set a CSRF double-submit cookie."""
    csrf_token = secrets.token_urlsafe(32)
    response.set_cookie(
        key="csrf_token",
        value=csrf_token,
        httponly=False,  # JS must read this to send in header
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        max_age=settings.SESSION_EXPIRE_HOURS * 3600,
    )
    return csrf_token


# ── POST /api/auth/login ─────────────────────────────────────────────────────

@router.post("/login")
def login(body: LoginRequest, request: Request, response: Response, db: SASession = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    user = db.query(User).filter(User.username == body.username).first()

    if not user or not pwd_context.verify(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if datetime.utcnow() > user.expires_at:
        raise HTTPException(status_code=403, detail="Account expired")

    # Update last login timestamp
    user.last_login_at = datetime.utcnow()
    db.commit()

    # Create session
    session_id = _create_session(db, user.id)

    # Set httpOnly cookie
    response.set_cookie(
        key="session_id",
        value=session_id,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        max_age=settings.SESSION_EXPIRE_HOURS * 3600,
        path="/",
    )

    # Set CSRF double-submit cookie
    csrf = _set_csrf_cookie(response)

    return {
        "success": True,
        "user": {
            "username": user.username,
            "role": user.role,
            "expiresAt": user.expires_at.isoformat(),
        },
        "csrfToken": csrf,
    }


# ── GET /api/auth/status ─────────────────────────────────────────────────────

@router.get("/status")
def auth_status(response: Response, session_id: str = Cookie(None), db: SASession = Depends(get_db)):
    if not session_id:
        return {"authenticated": False}

    session = db.query(DBSession).filter(DBSession.session_id == session_id).first()
    if not session or datetime.utcnow() > session.expires_at:
        return {"authenticated": False}

    user = db.query(User).filter(User.id == session.user_id).first()
    if not user or datetime.utcnow() > user.expires_at:
        return {"authenticated": False}

    # Refresh CSRF cookie on status checks
    csrf = _set_csrf_cookie(response)

    return {
        "authenticated": True,
        "user": {
            "username": user.username,
            "role": user.role,
            "expiresAt": user.expires_at.isoformat(),
        },
        "csrfToken": csrf,
    }


# ── POST /api/auth/logout ────────────────────────────────────────────────────

@router.post("/logout")
def logout(response: Response, session_id: str = Cookie(None), db: SASession = Depends(get_db)):
    if session_id:
        db.query(DBSession).filter(DBSession.session_id == session_id).delete()
        db.commit()
    response.delete_cookie("session_id", path="/")
    response.delete_cookie("csrf_token", path="/")
    return {"success": True}
