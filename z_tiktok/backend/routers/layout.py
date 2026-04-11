"""Layout persistence router – save / load per-user layout configs."""

import json

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session as SASession

from database import get_db
from dependencies import get_current_user
from models import Layout, User

router = APIRouter()


# ── POST /api/layout ─────────────────────────────────────────────────────────

@router.post("")
def save_layout(
    body: dict,
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    key = body.get("key", user.username)
    style = body.get("style", {})

    existing = (
        db.query(Layout)
        .filter(Layout.user_id == user.id, Layout.layout_key == key)
        .first()
    )

    if existing:
        existing.style_data = json.dumps(style)
        db.commit()
    else:
        layout = Layout(
            user_id=user.id,
            layout_key=key,
            style_data=json.dumps(style),
        )
        db.add(layout)
        db.commit()

    return {"ok": True}


# ── GET /api/layout?key=... ──────────────────────────────────────────────────

@router.get("")
def load_layout(
    key: str = Query(...),
    db: SASession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    layout = (
        db.query(Layout)
        .filter(Layout.user_id == user.id, Layout.layout_key == key)
        .first()
    )

    if not layout:
        return {"ok": False}

    return {"ok": True, "style": json.loads(layout.style_data)}
