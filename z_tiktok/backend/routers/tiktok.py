"""TikTok profile proxy router.

Proxies profile lookups to the upstream API on Render, rewrites avatar URLs
to go through our own ``/api/tiktok/avatar`` proxy so the browser can load
TikTok CDN images without CORS issues.
"""

import logging
import re
from datetime import datetime, timedelta
from typing import Dict, Tuple
from urllib.parse import quote, unquote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from dependencies import get_current_user
from models import User

logger = logging.getLogger(__name__)

router = APIRouter()

# UPSTREAM_BASE = "https://twowwwvvwwwwwwwwwwwwwwwwwwwwvvwwwwwwwwww.onrender.com"
UPSTREAM_BASE = "https://twwwwwwwvwwwwwwwwwwwvvwwwwwwwwwwwwwvvwww.onrender.com"

# In-memory caches
_profile_cache: Dict[str, Tuple[dict, datetime]] = {}
_PROFILE_TTL = timedelta(hours=1)

_avatar_cache: Dict[str, Tuple[bytes, str, datetime]] = {}  # url -> (bytes, content_type, ts)
_AVATAR_TTL = timedelta(hours=6)

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/26.2 Safari/605.1.15"
)

# Allowed domains for the avatar proxy to prevent SSRF
_ALLOWED_AVATAR_DOMAINS = {
    "p16-sign.tiktokcdn.com",
    "p16-sign-va.tiktokcdn.com",
    "p16-sign-sg.tiktokcdn.com",
    "p77-sign.tiktokcdn.com",
    "p19-sign.tiktokcdn.com",
    "p16-amd-va.tiktokcdn.com",
    "p16.tiktokcdn.com",
    "p77.tiktokcdn.com",
    "p19.tiktokcdn.com",
    "lf16-tiktok-common.tiktokcdn.com",
}


def _rewrite_avatar_url(raw_url: str, request: Request) -> str:
    """Rewrite an upstream avatar URL to point through our local proxy.

    The upstream returns paths like ``/api/tiktok/avatar?url=<encoded_cdn_url>``.
    We extract the actual CDN URL and build a local proxy URL so the browser
    fetches it from *our* server instead.
    """
    if not raw_url:
        return raw_url

    cdn_url = raw_url

    # If it's already an upstream proxy path, extract the real CDN URL
    match = re.search(r"[?&]url=([^&]+)", raw_url)
    if match:
        cdn_url = unquote(match.group(1))

    # Build our own proxy URL
    local_base = str(request.base_url).rstrip("/")
    return f"{local_base}/api/tiktok/avatar?url={quote(cdn_url, safe='')}"


async def _fetch_profile(handle: str) -> dict:
    """Fetch a TikTok profile from the upstream Render API."""
    url = f"{UPSTREAM_BASE}/api/tiktok/profile/{handle}"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, headers={"Accept": "application/json", "User-Agent": _UA})
        resp.raise_for_status()
        return resp.json()


# ── GET /api/tiktok/profile/{handle} ─────────────────────────────────────────

@router.get("/profile/{handle}")
async def get_tiktok_profile(
    handle: str,
    request: Request,
    _user: User = Depends(get_current_user),
):
    clean = handle.lstrip("@").lower()
    if not clean:
        raise HTTPException(status_code=400, detail="Handle is required")

    now = datetime.utcnow()

    # Return cached value if fresh enough
    if clean in _profile_cache:
        data, fetched_at = _profile_cache[clean]
        if now - fetched_at < _PROFILE_TTL:
            return data

    try:
        data = await _fetch_profile(clean)
    except httpx.HTTPStatusError as exc:
        logger.warning("Upstream returned %s for %s", exc.response.status_code, clean)
        raise HTTPException(status_code=exc.response.status_code, detail="Upstream error")
    except Exception as exc:
        logger.error("Failed to fetch profile for %s: %s", clean, exc)
        raise HTTPException(status_code=502, detail="Failed to fetch TikTok profile")

    # Rewrite avatar URLs to go through our local proxy
    if "data" in data and isinstance(data["data"], dict):
        d = data["data"]
        for key in ("avatar", "avatarLarger", "avatarThumb"):
            if key in d and d[key]:
                d[key] = _rewrite_avatar_url(d[key], request)

    _profile_cache[clean] = (data, now)
    return data


# ── GET /api/tiktok/avatar?url=... ───────────────────────────────────────────

@router.get("/avatar")
async def proxy_avatar(url: str = Query(..., description="TikTok CDN image URL")):
    """Stream an image from TikTok's CDN through our server.

    This avoids CORS / referrer-policy issues that prevent the browser from
    loading TikTok-hosted images directly.
    Only allows requests to known TikTok CDN domains to prevent SSRF.
    """
    if not url:
        raise HTTPException(status_code=400, detail="url query param required")

    # SSRF protection: only allow known TikTok CDN domains
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Invalid URL scheme")
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="Invalid URL")
    # Allow any *.tiktokcdn.com subdomain
    hostname = parsed.hostname.lower()
    if not (hostname.endswith(".tiktokcdn.com") or hostname in _ALLOWED_AVATAR_DOMAINS):
        raise HTTPException(status_code=400, detail="URL domain not allowed")

    now = datetime.utcnow()

    # Serve from cache if available
    if url in _avatar_cache:
        img_bytes, content_type, cached_at = _avatar_cache[url]
        if now - cached_at < _AVATAR_TTL:
            return Response(
                content=img_bytes,
                media_type=content_type,
                headers={"Cache-Control": "public, max-age=21600"},
            )

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": _UA})
            resp.raise_for_status()
    except Exception as exc:
        logger.error("Avatar proxy failed for %s: %s", url[:120], exc)
        raise HTTPException(status_code=502, detail="Failed to fetch avatar")

    content_type = resp.headers.get("content-type", "image/jpeg")
    img_bytes = resp.content

    # Cache the image bytes
    _avatar_cache[url] = (img_bytes, content_type, now)

    return Response(
        content=img_bytes,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=21600"},
    )
