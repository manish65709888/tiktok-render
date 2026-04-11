"""Shared FastAPI dependencies – mainly auth helpers."""

from datetime import datetime
from typing import Optional

from fastapi import Cookie, Depends, HTTPException, Request
from sqlalchemy.orm import Session as SASession

from database import get_db
from models import ApiToken, Session as DBSession, User


def _get_bearer_token(request: Request) -> Optional[str]:
    """Extract Bearer token from Authorization header."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


def get_current_user(
    request: Request,
    session_id: Optional[str] = Cookie(None),
    db: SASession = Depends(get_db),
) -> User:
    """Authenticate via Bearer API token OR session cookie. Raise 401 otherwise."""
    now = datetime.utcnow()

    # 1) Try Bearer token first
    bearer = _get_bearer_token(request)
    if bearer:
        api_token = (
            db.query(ApiToken)
            .filter(ApiToken.token == bearer, ApiToken.is_active == True)
            .first()
        )
        if not api_token or now > api_token.expires_at:
            raise HTTPException(status_code=401, detail="Invalid or expired API token")
        user = db.query(User).filter(User.id == api_token.user_id).first()
        if not user or now > user.expires_at:
            raise HTTPException(status_code=401, detail="User expired")
        # Tag the request so CSRF middleware can skip it
        request.state.token_auth = True
        return user

    # 2) Fall back to session cookie
    if not session_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    sess = db.query(DBSession).filter(DBSession.session_id == session_id).first()
    if not sess or now > sess.expires_at:
        raise HTTPException(status_code=401, detail="Session expired")
    user = db.query(User).filter(User.id == sess.user_id).first()
    if not user or now > user.expires_at:
        raise HTTPException(status_code=401, detail="Session expired")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Require the authenticated user to have the admin role."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
