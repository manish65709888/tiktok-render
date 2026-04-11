"""WebSocket router – room-based message broadcasting with auth."""

import json
import logging
from datetime import datetime
from typing import Dict, Set

from fastapi import APIRouter, Cookie, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session as SASession

from database import SessionLocal
from models import Session as DBSession, User

logger = logging.getLogger(__name__)

router = APIRouter()

# room_id -> set of connected WebSockets
rooms: Dict[str, Set[WebSocket]] = {}

_MAX_MESSAGE_SIZE = 16_384  # 16 KB max per message
_MAX_ROOM_CLIENTS = 20


def _validate_session(session_id: str | None) -> bool:
    """Verify the WebSocket connection has a valid session cookie."""
    if not session_id:
        return False
    db: SASession = SessionLocal()
    try:
        sess = db.query(DBSession).filter(DBSession.session_id == session_id).first()
        if not sess or datetime.utcnow() > sess.expires_at:
            return False
        user = db.query(User).filter(User.id == sess.user_id).first()
        if not user or datetime.utcnow() > user.expires_at:
            return False
        return True
    finally:
        db.close()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, room: str = "default"):
    # Validate session cookie before accepting
    session_id = websocket.cookies.get("session_id")
    if not _validate_session(session_id):
        await websocket.close(code=4001, reason="Unauthorized")
        return

    # Limit room name length
    if len(room) > 100:
        await websocket.close(code=4002, reason="Room name too long")
        return

    # Limit concurrent clients per room
    if room in rooms and len(rooms[room]) >= _MAX_ROOM_CLIENTS:
        await websocket.close(code=4003, reason="Room is full")
        return

    await websocket.accept()

    if room not in rooms:
        rooms[room] = set()
    rooms[room].add(websocket)

    try:
        while True:
            raw = await websocket.receive_text()

            # Enforce message size limit
            if len(raw) > _MAX_MESSAGE_SIZE:
                logger.warning("WebSocket message too large (%d bytes), dropping", len(raw))
                continue

            # Broadcast to every client in the same room
            disconnected: Set[WebSocket] = set()
            for client in rooms[room]:
                try:
                    await client.send_text(raw)
                except Exception:
                    disconnected.add(client)

            rooms[room] -= disconnected
    except WebSocketDisconnect:
        rooms[room].discard(websocket)
        if not rooms[room]:
            del rooms[room]
