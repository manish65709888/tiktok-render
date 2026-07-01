"""FastAPI application entry-point.

Serves the TikTok Live backend API **and** the static front-end files
(portal.html, mode1.html, mode2.html, images, fonts, etc.).
"""

import logging
import mimetypes
import secrets
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from config import settings
from database import Base, engine
from routers import admin, auth, layout, tiktok, websocket

# ── Bootstrap ─────────────────────────────────────────────────────────────────

# Register custom MIME types so StaticFiles serves them correctly
mimetypes.add_type("model/gltf-binary", ".vrm")
mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("model/gltf+json", ".gltf")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="TikTok Live Backend",
    version="1.0.0",
)

# ── Global exception handler ──────────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled error on %s %s: %s", request.method, request.url.path, exc, exc_info=True)
    return JSONResponse({"detail": str(exc)}, status_code=500)

# ── CORS ──────────────────────────────────────────────────────────────────────

origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token", "Authorization"],
)


# ── Security headers middleware ───────────────────────────────────────────────

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "camera=(self), microphone=(self), geolocation=()"
        )
        # Don't add CSP here — static HTML may include CDN scripts
        return response

app.add_middleware(SecurityHeadersMiddleware)


# ── CSRF protection middleware ────────────────────────────────────────────────

_CSRF_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
_CSRF_EXEMPT_PATHS = {"/api/auth/login", "/api/auth/logout"}


class CSRFMiddleware(BaseHTTPMiddleware):
    """Validate X-CSRF-Token header on state-changing requests.

    The token is set as a cookie during login / status check and must be
    echoed back in the X-CSRF-Token header.  Because cookies are SameSite
    and the token must be read with JS, a cross-origin attacker cannot
    forge the header (double-submit cookie pattern).
    """

    async def dispatch(self, request: Request, call_next):
        # Skip CSRF for safe methods, exempt paths, websockets, and Bearer token auth
        if (
            request.method in _CSRF_SAFE_METHODS
            or request.url.path in _CSRF_EXEMPT_PATHS
            or request.url.path.startswith("/ws")
        ):
            return await call_next(request)

        # Bearer token auth does not need CSRF protection
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            return await call_next(request)

        cookie_token = request.cookies.get("csrf_token")
        header_token = request.headers.get("x-csrf-token")

        if not cookie_token or not header_token or cookie_token != header_token:
            return JSONResponse(
                {"detail": "CSRF token missing or invalid"},
                status_code=403,
            )

        return await call_next(request)

app.add_middleware(CSRFMiddleware)

# ── API Routers ───────────────────────────────────────────────────────────────

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(layout.router, prefix="/api/layout", tags=["layout"])
app.include_router(tiktok.router, prefix="/api/tiktok", tags=["tiktok"])
app.include_router(websocket.router, tags=["websocket"])

# ── Static file serving ──────────────────────────────────────────────────────

# Resolve static root — serve from the same directory as main.py (backend/)
STATIC_ROOT = Path(__file__).resolve().parent
logger.info("Serving static files from %s", STATIC_ROOT)

# Mount known asset directories if they exist
_image_dir = STATIC_ROOT / "image"
if _image_dir.is_dir():
    app.mount("/image", StaticFiles(directory=str(_image_dir)), name="images")

_font_dir = STATIC_ROOT / "TikTok_Sans"
if _font_dir.is_dir():
    app.mount("/TikTok_Sans", StaticFiles(directory=str(_font_dir)), name="fonts")

_vrm_dir = STATIC_ROOT / "vrm"
if _vrm_dir.is_dir():
    app.mount("/vrm", StaticFiles(directory=str(_vrm_dir)), name="vrm")

_css_dir = STATIC_ROOT / "css"
if _css_dir.is_dir():
    app.mount("/css", StaticFiles(directory=str(_css_dir)), name="css")

_js_dir = STATIC_ROOT / "js"
if _js_dir.is_dir():
    app.mount("/js", StaticFiles(directory=str(_js_dir)), name="js")


# ── HTML / JSON / JS catch-all routes ────────────────────────────────────────

@app.get("/", response_class=FileResponse)
def root():
    """Serve portal.html as the landing page."""
    path = STATIC_ROOT / "portal.html"
    logger.info("Serving root, STATIC_ROOT=%s, portal exists=%s", STATIC_ROOT, path.is_file())
    if not path.is_file():
        return JSONResponse({"error": "portal.html not found", "static_root": str(STATIC_ROOT), "contents": [str(p.name) for p in STATIC_ROOT.iterdir()] if STATIC_ROOT.is_dir() else "NOT A DIR"}, status_code=404)
    return FileResponse(str(path))


@app.get("/{filename}.html")
def serve_html(filename: str):
    path = STATIC_ROOT / f"{filename}.html"
    if path.is_file():
        return FileResponse(str(path))
    return JSONResponse({"error": "Not found"}, status_code=404)


@app.get("/{filename}.json")
def serve_json(filename: str):
    path = STATIC_ROOT / f"{filename}.json"
    if path.is_file():
        return FileResponse(str(path), media_type="application/json")
    return JSONResponse({"error": "Not found"}, status_code=404)


@app.get("/{filename}.js")
def serve_js(filename: str):
    path = STATIC_ROOT / f"{filename}.js"
    if path.is_file():
        return FileResponse(str(path), media_type="application/javascript")
    return JSONResponse({"error": "Not found"}, status_code=404)


# ── Startup event: seed admin user if not exists ─────────────────────────────

@app.on_event("startup")
def _seed_admin():
    from datetime import datetime, timedelta

    from passlib.context import CryptContext
    from sqlalchemy.orm import Session

    from database import SessionLocal
    from models import ApiToken, User

    try:
        Base.metadata.create_all(bind=engine)
    except Exception as exc:
        logger.error("DB table creation failed (app will still start): %s", exc)
        return

    pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
    db: Session = SessionLocal()
    try:
        admin = db.query(User).filter(User.username == settings.ADMIN_USERNAME).first()
        if not admin:
            admin = User(
                username=settings.ADMIN_USERNAME,
                password_hash=pwd_ctx.hash(settings.ADMIN_PASSWORD),
                role="admin",
                expires_at=datetime.now() + timedelta(days=365 * 10),
            )
            db.add(admin)
            db.commit()
            logger.info("Admin user '%s' created.", settings.ADMIN_USERNAME)
        else:
            logger.info("Admin user '%s' already exists.", settings.ADMIN_USERNAME)

        if settings.ADMIN_API_TOKEN:
            existing = (
                db.query(ApiToken)
                .filter(ApiToken.token == settings.ADMIN_API_TOKEN)
                .first()
            )
            if not existing:
                token = ApiToken(
                    token=settings.ADMIN_API_TOKEN,
                    user_id=admin.id,
                    name="admin-permanent",
                    expires_at=datetime.now() + timedelta(days=365 * 10),
                )
                db.add(token)
                db.commit()
                logger.info("Admin API token seeded.")
            else:
                logger.info("Admin API token already exists.")
    except Exception as exc:
        logger.error("Admin seed failed: %s", exc)
    finally:
        db.close()


# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
