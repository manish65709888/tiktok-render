/* ── Single-instance guard: only one Mode 1 tab allowed ── */
(function () {
    const CHANNEL_NAME = 'mode1-single-instance';
    const instanceId = Date.now() + '-' + Math.random().toString(36).slice(2);
    const singleCh = new BroadcastChannel(CHANNEL_NAME);

    // Tell any existing Mode 1 tab to close
    singleCh.postMessage({ type: 'takeover', id: instanceId });

    singleCh.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'takeover' && e.data.id !== instanceId) {
            // A newer Mode 1 tab opened – close this one
            singleCh.close();
            window.location.href = 'portal.html';
        }
    });
})();

let ws = null;
let wsRoomId = null;
let layoutKey = "default";
let camBgKey = "default:cam-bg";
let camBgLoadedFromServer = false;

function getDisplayNameStorageKey(username) {
    return `tiktok-display-name:${String(username || 'default').toLowerCase()}`;
}

function getStoredDisplayName(username) {
    try {
        const value = localStorage.getItem(getDisplayNameStorageKey(username));
        return (value || '').trim() || 'Host';
    } catch (err) {
        return 'Host';
    }
}

function getWsUrl(roomId) {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/ws?room=${encodeURIComponent(roomId)}`;
}

function connectWs(roomId) {
    if (!roomId) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    ws = new WebSocket(getWsUrl(roomId));
    ws.addEventListener('message', (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleIncoming(msg);
        } catch (err) {
            // ignore
        }
    });
    ws.addEventListener('close', () => {
        setTimeout(() => connectWs(roomId), 2000);
    });
}

function sendWs(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

async function requireLogin() {
    try {
        const res = await fetch('/api/auth/status', { credentials: 'include' });
        const data = await res.json();
        if (!res.ok || !data.authenticated) {
            window.location.href = 'portal.html';
            return;
        }
        wsRoomId = data.user?.username || null;
        layoutKey = wsRoomId || "default";
        camBgKey = `${layoutKey}:cam-bg`;
        const camNamePill = document.getElementById("camNamePill");
        if (camNamePill) {
            camNamePill.textContent = getStoredDisplayName(wsRoomId);
        }
        connectWs(wsRoomId);
        // Reload layout for this user after login
        loadLayoutFromServer().then((loaded) => {
            if (loaded) {
                applyRoomStyle();
                updateRoomUI(roomOpen);
            }
        });
        // Reload camera background for this user after login
        loadCamBgFromServer().then((bg) => {
            camBgLoadedFromServer = true;
            if (bg) setCamBackground(bg);
        });
        // Now that session is confirmed, download premium assets
        downloadLionUpgrade();
        preloadGiftAssets();
    } catch (err) {
        window.location.href = 'portal.html';
    }
}
requireLogin();

const channelName = "tiktok-room-control";
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(channelName) : null;
const fallbackKey = "tiktok-room-control-message";
const seatsStoreKey = "tiktok-room-seats-v2";
const seatCount = 8;

const qs = new URLSearchParams(location.search);
const preferredMode = qs.get("mode");

const hostLayout = document.getElementById("hostLayout");
const roomPanel = document.getElementById("roomPanel");
const roomGrid = document.getElementById("roomGrid");
const videoWrap = document.getElementById("videoWrap");
const videoEl = document.getElementById("camera");
const camBgEl = document.getElementById("camBg");
const camSegCanvas = document.getElementById("camSegCanvas");
const camSegCtx = camSegCanvas ? camSegCanvas.getContext("2d") : null;
const camAiCanvas = document.getElementById("camAiCanvas");
const camAiCtx = camAiCanvas ? camAiCanvas.getContext("2d") : null;
const camVrmCanvas = document.getElementById("camVrmCanvas");
const camToolsEl = document.getElementById("camTools");
const camAiFaceBtn = document.getElementById("camAiFaceBtn");
const camSegBtn = document.getElementById("camSegBtn");
const camVrmPickBtn = document.getElementById("camVrmPickBtn");
const camVrmClearBtn = document.getElementById("camVrmClearBtn");
const camBgBtn = document.getElementById("camBgBtn");
const camBgClearBtn = document.getElementById("camBgClearBtn");
const camBgFile = document.getElementById("camBgFile");
const camVrmFile = document.getElementById("camVrmFile");
const animationBox = document.getElementById("animationBox");
const giftOverlay = document.getElementById("giftOverlay");
let giftVideo = document.getElementById("giftVideo");
const soundPrompt = document.getElementById("soundPrompt");
const soundPromptBtn = document.getElementById("soundPromptBtn");

if (animationBox) animationBox.style.borderStyle = "none";

let roomOpen = true;
let stream = null;
let currentFacingMode = "user";
let camToolsVisible = false;
let camVrmEnabled = true;
let camSegEnabled = false;
let camAiEnabled = false;
let editMoveEnabled = false;
let camVisible = true;
let camAiAvatarUrl = "";
let camAiAvatarReady = false;
const camAiAvatarImage = new Image();
let camAiLoopId = null;
let camSegLoopId = null;
let faceMesh = null;
let selfieSegmentation = null;
let micStream = null;
let micCtx = null;
let micAnalyser = null;
let micData = null;
let micRaf = null;
let micActive = false;
let lionUpgradeBlobUrl = null;
const LION_UPG_DB = 'lionUpgradeCache';
const LION_UPG_KEY = 'lionupgrade_webm_v5';
const LION_UPG_URL = 'image/!Lion (29999).webm';

async function fetchProtected(fileKey) {
    return fetch(fileKey);
}
const isIOSDeviceGlobal = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isIPhoneDevice = /iPhone|iPod/.test(navigator.userAgent);
const lionDlChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lion-upgrade-dl') : null;

function openLionDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(LION_UPG_DB, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore('blobs'); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
function getLionBlob(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('blobs', 'readonly');
        const r = tx.objectStore('blobs').get(LION_UPG_KEY);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
    });
}
function saveLionBlob(db, blob) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').put(blob, LION_UPG_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function downloadLionUpgrade() {
    if (isIPhoneDevice) return;
    try {
        const db = await openLionDB();
        const cached = await getLionBlob(db);
        if (cached) {
            lionUpgradeBlobUrl = URL.createObjectURL(cached);
            console.log('Lion upgrade loaded from cache');
            if (lionDlChannel) lionDlChannel.postMessage({ type: 'lion-dl', status: 'done', pct: 100 });
            return;
        }
        // Broadcast: starting
        if (lionDlChannel) lionDlChannel.postMessage({ type: 'lion-dl', status: 'progress', pct: 0 });
        const resp = await fetchProtected(LION_UPG_URL);
        if (!resp.ok) throw new Error('fetch failed ' + resp.status);
        const total = parseInt(resp.headers.get('Content-Length') || '0', 10);
        const reader = resp.body.getReader();
        const chunks = [];
        let loaded = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;
            if (total > 0) {
                const p = Math.min(99, Math.round(loaded / total * 100));
                if (lionDlChannel) lionDlChannel.postMessage({ type: 'lion-dl', status: 'progress', pct: p });
            }
        }
        const blob = new Blob(chunks, { type: 'video/webm' });
        await saveLionBlob(db, blob);
        lionUpgradeBlobUrl = URL.createObjectURL(blob);
        console.log('Lion upgrade downloaded & cached');
        if (lionDlChannel) lionDlChannel.postMessage({ type: 'lion-dl', status: 'done', pct: 100 });
    } catch (err) {
        console.warn('Lion upgrade download failed:', err);
        if (lionDlChannel) lionDlChannel.postMessage({ type: 'lion-dl', status: 'error' });
    }
}
// downloadLionUpgrade is called after requireLogin succeeds
const styleStoreKey = "tiktok-room-style-latest";
const styleStoreVersion = 2;
const camBgStoreKey = "tiktok-room-cam-bg";
const camFacingStoreKey = "tiktok-room-cam-facing";
let _layoutSaveTimer = null;

const editLayerEls = [videoWrap, roomPanel, animationBox].filter(Boolean);

function resetEditZOrder() {
    editLayerEls.forEach((el) => {
        el.style.zIndex = "";
    });
}

function applyEditZOrder(activeEl) {
    if (!editMoveEnabled) return;
    if (animationBox) animationBox.style.zIndex = "10";
    if (roomPanel) roomPanel.style.zIndex = "15";
    if (videoWrap) videoWrap.style.zIndex = "20";
    if (activeEl) activeEl.style.zIndex = "40";
}

editLayerEls.forEach((el) => {
    el.addEventListener("pointerdown", () => {
        if (!editMoveEnabled) return;
        applyEditZOrder(el);
    }, { capture: true });
});

/* ---- CSRF helper ---- */
function getCsrfToken() {
    const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : '';
}

/* ---- Server-backed layout persistence ---- */
async function saveLayoutToServer() {
    try {
        const resp = await fetch('/api/layout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
            body: JSON.stringify({ key: layoutKey, style: { ...roomStyle, _v: styleStoreVersion } })
        });
        const data = await resp.json();
        if (data.ok) console.log('Layout saved to server');
    } catch (err) { console.warn('Layout save to server failed:', err); }
}

async function saveCamBgToServer(dataUrl) {
    try {
        await fetch('/api/layout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
            body: JSON.stringify({ key: camBgKey, style: { dataUrl: dataUrl || "" } })
        });
    } catch (err) { /* ignore */ }
}

async function loadCamBgFromServer() {
    try {
        const resp = await fetch(`/api/layout?key=${encodeURIComponent(camBgKey)}`);
        const data = await resp.json();
        if (data.ok && data.style && typeof data.style === 'object') {
            return data.style.dataUrl || "";
        }
    } catch (err) { /* ignore */ }
    return "";
}

async function loadLayoutFromServer() {
    try {
        const resp = await fetch(`/api/layout?key=${encodeURIComponent(layoutKey)}`);
        const data = await resp.json();
        if (data.ok && data.style && typeof data.style === 'object') {
            const { _v, ...rest } = data.style;
            roomStyle = { ...roomStyle, ...rest };
            console.log('Layout loaded from server');
            return true;
        }
    } catch (err) { console.warn('Layout load from server failed:', err); }
    return false;
}

function debounceSaveLayout() {
    if (_layoutSaveTimer) clearTimeout(_layoutSaveTimer);
    _layoutSaveTimer = setTimeout(() => { saveLayoutToServer(); }, 1500);
}
let seats = Array.from({ length: seatCount }, () => null);
let seatColors = Array.from({ length: seatCount }, () => null);
let roomStyle = {
    slotHeight: 101,
    colWidth: 0,
    gap: 5,
    bg1: "#14171c",
    bg2: "#1f2430",
    blend: 0.5,
    plusSize: 36,
    labelSize: 14,
    requestTextStyle: "regular",
    pointsFormat: "compact",
    camWidth: 212,
    camHeight: 420,
    camRadius: 10,
    camOffsetX: 0,
    camOffsetY: 165,
    closedCamWidth: 430,
    closedCamHeight: 615,
    closedCamOffsetX: 0,
    closedCamOffsetY: 165,
    roomWidth: 215,
    roomHeight: 423,
    roomRadius: 10,
    roomOffsetX: 215,
    roomOffsetY: 165,
    animationWidth: 575,
    animationHeight: 566,
    animationOffsetX: -76,
    animationOffsetY: 379,
};

const giftLibrary = {
    lion: { id: "lion", sources: ["image/lionAnimation.mp4", "image/lionAnimation.webm"], sound: "image/0204(4).MP3" },
    leonandlion: { id: "leonandlion", sources: ["image/!Leon and Lion (34000).webm"], sound: "image/!Leon and Lion (34000).webm" },
    dragon: { id: "dragon", sources: ["image/dragonanimation.webm"], sound: "image/dragonanimation.webm" },
    pegasus: { id: "pegasus", sources: ["image/pegasus.mp4"], sound: "image/pegasus.mp3" },
    thunderfalcon: { id: "thunderfalcon", sources: ["image/thunderfalcon.mp4"], sound: "image/thunderfalcon.mp3" },
};
const giftPreloadVideos = [];
const giftPreloadAudios = [];

async function preloadGiftAssets() {
    try {
        for (const gift of Object.values(giftLibrary)) {
            for (const src of (gift.sources || [])) {
                const vid = document.createElement('video');
                vid.preload = 'auto';
                vid.muted = true;
                vid.playsInline = true;
                vid.setAttribute('playsinline', '');
                vid.setAttribute('webkit-playsinline', '');
                vid.style.display = 'none';
                vid.src = src;
                vid.load();
                giftPreloadVideos.push(vid);
            }
            if (gift.sound) {
                const aud = new Audio(gift.sound);
                aud.preload = 'auto';
                aud.load();
                giftPreloadAudios.push(aud);
            }
        }
    } catch (err) { /* ignore */ }
}
let giftHideTimer = null;
let giftPlaySeq = 0;
let giftIsPlaying = false;
let pendingGiftReplayId = null;

/* ---- iOS audio unlock: persistent Audio element ---- */
const _giftAudioEl = new Audio();
_giftAudioEl.volume = 1;
let _audioUnlocked = false;
const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function showSoundPrompt() {
    if (!soundPrompt || !isIOSDevice || _audioUnlocked) return;
    soundPrompt.classList.remove("hidden");
    soundPrompt.setAttribute("aria-hidden", "false");
}
function hideSoundPrompt() {
    if (!soundPrompt) return;
    soundPrompt.classList.add("hidden");
    soundPrompt.setAttribute("aria-hidden", "true");
}
function unlockAudio() {
    if (_audioUnlocked) {
        hideSoundPrompt();
        return;
    }
    _giftAudioEl.muted = true;
    _giftAudioEl.play().then(() => {
        _giftAudioEl.pause();
        _giftAudioEl.muted = false;
        _giftAudioEl.currentTime = 0;
        _audioUnlocked = true;
        console.log("Audio unlocked for gift sounds");
        hideSoundPrompt();
    }).catch(() => { });
}
["touchstart", "touchend", "click", "pointerdown"].forEach(evt => {
    document.addEventListener(evt, unlockAudio, { once: false, passive: true });
});

/* ---- Video autoplay unlock: warm-up muted play on first user gesture ---- */
let _videoUnlocked = false;
function unlockVideo() {
    if (_videoUnlocked) return;
    try {
        const tmp = document.createElement("video");
        tmp.muted = true;
        tmp.setAttribute("muted", "");
        tmp.playsInline = true;
        tmp.setAttribute("playsinline", "");
        // Tiny transparent 1-frame webm (base64)
        tmp.src = "data:video/webm;base64,GkXfo0AgQoaBAUL3gQFC8oEEQvOBCEKCQAR3ZWJtQoeBAkKFgQIYU4BnQN8VSalmQCgq17FAAw9CQE2AQAZ3aGFtbXlXQUAGd2hhbW15RIlACECPQAAAAAAAFlSua0AxrkAu14EBY8WBAZyBACK1nEADdW5khkAFVl9WUDglhohAA1ZQOIOBAeBABrCBCLqBCB9DtnVAIueBAKNAHIEAAIAwAQCdASoIAAgAAUAmJaQAA3AA/vz0AAA=";
        tmp.play().then(() => {
            _videoUnlocked = true;
            tmp.pause();
            tmp.remove();
            console.log("Video autoplay unlocked");
        }).catch(() => { tmp.remove(); });
    } catch (e) { /* ignore */ }
}
["touchstart", "touchend", "click", "pointerdown"].forEach(evt => {
    document.addEventListener(evt, unlockVideo, { once: false, passive: true });
});
if (soundPromptBtn) {
    soundPromptBtn.addEventListener("click", () => {
        hideSoundPrompt();
        unlockAudio();
    });
}
const recentMessages = new Map();
const recentMessageWindowMs = 3000;

function shouldProcessMessage(message) {
    const key = [message.type || "", message.giftId || "", message.seatIndex ?? "", message.ts || ""].join("|");
    const now = Date.now();
    const last = recentMessages.get(key);
    if (last && now - last < recentMessageWindowMs) return false;
    recentMessages.set(key, now);
    // Cleanup old entries
    for (const [k, t] of recentMessages.entries()) {
        if (now - t > recentMessageWindowMs) recentMessages.delete(k);
    }
    return true;
}

function computeSeatColor(idx, avatarUrl) {
    if (!avatarUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
        try {
            const canvas = document.createElement("canvas");
            const size = 24;
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.drawImage(img, 0, 0, size, size);
            const data = ctx.getImageData(0, 0, size, size).data;
            let r = 0, g = 0, b = 0;
            const pixels = size * size;
            for (let i = 0; i < data.length; i += 4) {
                r += data[i];
                g += data[i + 1];
                b += data[i + 2];
            }
            r = Math.round(r / pixels);
            g = Math.round(g / pixels);
            b = Math.round(b / pixels);
            seatColors[idx] = `rgb(${r}, ${g}, ${b})`;
            applyRoomStyle();
        } catch (err) {
            seatColors[idx] = null;
        }
    };
    img.onerror = () => { seatColors[idx] = null; };
    img.src = avatarUrl;
}

function showLionSeatIcon(idx, iconSrc = "image/lionicon.png") {
    const slot = roomGrid.querySelectorAll(".slot")[idx];
    if (!slot) return;
    const icon = slot.querySelector(".seat-lion-icon");
    if (!icon) return;
    icon.src = iconSrc;
    icon.classList.remove("seat-lion-show");
    void icon.offsetWidth;
    icon.classList.add("seat-lion-show");
    icon.addEventListener("animationend", () => {
        icon.classList.remove("seat-lion-show");
    }, { once: true });
}

function resetSeatGiftIcons() {
    roomGrid.querySelectorAll(".seat-lion-icon").forEach((icon) => {
        icon.classList.remove("seat-lion-show");
    });
}

function showSeatPointsRise(idx, delta) {
    const slot = roomGrid.querySelectorAll(".slot")[idx];
    if (!slot) return;
    if (!Number.isFinite(delta) || delta === 0) return;
    const wrap = slot.querySelector(".seat-points-wrap");
    if (!wrap) return;
    const pointsText = wrap.querySelector(".seat-points-text");
    if (!pointsText) return;

    /* Text already shows new value (set by applyRoomStyle). Derive old value. */
    const newVal = pointsText.textContent;
    const newNum = Number(pointsText.dataset.rawPoints ?? 0);
    const oldNum = newNum - delta;
    const oldVal = formatSeatPoints(oldNum);

    /* Remove any existing roller */
    const prev = wrap.querySelector(".seat-points-roller");
    if (prev) { prev.remove(); pointsText.style.display = ""; }

    /* Hide real text, build roller: old on top → new below */
    pointsText.style.display = "none";
    const roller = document.createElement("div");
    roller.className = "seat-points-roller";
    const oldSpan = document.createElement("span");
    oldSpan.textContent = oldVal;
    const newSpan = document.createElement("span");
    newSpan.textContent = newVal;
    roller.append(oldSpan, newSpan);
    wrap.appendChild(roller);

    /* Trigger roll animation */
    void roller.offsetWidth;
    roller.classList.add("rolling");
    roller.addEventListener("animationend", () => {
        pointsText.style.display = "";
        roller.remove();
    }, { once: true });
}

function positionGiftOverlay() {
    // Gift overlay now fills the animation box, no dynamic positioning needed
}

function resetGiftVideoElement() {
    if (!giftOverlay) return null;
    const old = giftOverlay.querySelector("#giftVideo");
    if (old && old.parentNode) {
        try { old.pause(); old.removeAttribute("src"); old.load(); } catch (err) { /* ignore */ }
        old.parentNode.removeChild(old);
    }
    const next = document.createElement("video");
    next.id = "giftVideo";
    next.playsInline = true;
    next.setAttribute("playsinline", "");
    next.setAttribute("webkit-playsinline", "");
    next.setAttribute("preload", "auto");
    next.setAttribute("x-webkit-airplay", "deny");
    next.setAttribute("disableRemotePlayback", "");
    // Always start muted+autoplay to satisfy browser autoplay policies
    // (Safari requires the HTML attribute, not just the JS property)
    next.muted = true;
    next.autoplay = true;
    next.setAttribute("muted", "");
    next.setAttribute("autoplay", "");
    giftOverlay.appendChild(next);
    giftVideo = next;
    return next;
}

function enqueueGiftAnimation(giftId) {
    if (!giftId) return;
    if (giftIsPlaying) {
        // If user clicks many times during one animation, replay only once.
        pendingGiftReplayId = giftId;
        return;
    }
    playGiftAnimation(giftId);
}

function playGiftAnimation(giftId) {
    const gift = giftLibrary[giftId];
    if (!gift || !giftVideo || !giftOverlay) {
        console.log("Gift animation failed: missing elements", { gift, giftVideo: !!giftVideo, giftOverlay: !!giftOverlay });
        return;
    }
    const useEmbeddedGiftSound = giftId === "leonandlion" || giftId === "dragon";
    const useDoubleHeightGift = giftId === "dragon";
    const dragonStartOffsetSec = giftId === "dragon" ? 0.10 : 0;

    /* Check if this is a lion upgrade play */
    const useLionUpgrade = (giftId === 'lion' && lionUpgradeBlobUrl && !isIPhoneDevice);

    let sources = gift.sources || (gift.animation ? [gift.animation] : []);

    /* Build ordered source list — upgrade blob first, then original fallbacks */
    if (useLionUpgrade) {
        sources = [lionUpgradeBlobUrl, ...sources]; // upgrade first, old as fallback
    }
    if (!useLionUpgrade && giftVideo && sources.length > 1) {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        const preferMP4 = isIOS; // Only iOS uses MP4; macOS Safari can play WebM
        const canPlay = (src) => {
            if (src.endsWith(".webm")) {
                if (preferMP4) return false; // iOS/Safari: skip WebM entirely, use MP4
                return !!giftVideo.canPlayType("video/webm") || !!giftVideo.canPlayType("video/webm; codecs=\"vp9\"");
            }
            if (src.endsWith(".mp4")) {
                return !!giftVideo.canPlayType("video/mp4");
            }
            return true;
        };
        const mp4Sources = sources.filter((s) => s.endsWith(".mp4") && canPlay(s));
        const webmSources = sources.filter((s) => s.endsWith(".webm") && canPlay(s));
        const other = sources.filter((s) => !s.endsWith(".webm") && !s.endsWith(".mp4") && canPlay(s));
        const ordered = preferMP4
            ? [...mp4Sources, ...other] // iOS/Safari: MP4 only, no WebM fallback
            : [...webmSources, ...mp4Sources, ...other]; // Others: WebM first for alpha support
        if (ordered.length) sources = ordered;
    }
    if (!sources.length) {
        console.log("Gift animation failed: no sources");
        return;
    }

    giftIsPlaying = true;
    const seq = ++giftPlaySeq;
    console.log("Playing gift animation:", giftId, sources);

    /* ---- Play gift sound separately ---- */
    if (gift.sound) {
        try {
            if (!_audioUnlocked) showSoundPrompt();
            _giftAudioEl.src = gift.sound;
            _giftAudioEl.currentTime = 0;
            _giftAudioEl.volume = 1;
            _giftAudioEl.play().catch(() => { });
        } catch (e) { /* ignore */ }
    }

    const finish = () => {
        if (seq !== giftPlaySeq) return;
        if (giftHideTimer) {
            clearTimeout(giftHideTimer);
            giftHideTimer = null;
        }
        giftOverlay.classList.remove("show");
        giftOverlay.classList.remove("lion-upgrade");
        giftIsPlaying = false;
        // Stop audio if still playing
        try { _giftAudioEl.pause(); _giftAudioEl.currentTime = 0; } catch (e) { }
        if (pendingGiftReplayId) {
            const nextGiftId = pendingGiftReplayId;
            pendingGiftReplayId = null;
            // Next tick to allow DOM/class cleanup to apply.
            setTimeout(() => enqueueGiftAnimation(nextGiftId), 0);
        }
    };

    if (giftHideTimer) {
        clearTimeout(giftHideTimer);
        giftHideTimer = null;
    }
    giftOverlay.classList.remove("show");
    giftOverlay.classList.remove("lion-upgrade");
    // Force a style flush so re-adding the class retriggers reliably.
    void giftOverlay.offsetWidth;

    // Recreate the video element so re-playing the same file starts cleanly.
    resetGiftVideoElement();

    let idx = 0;
    const tryNext = async () => {
        if (seq !== giftPlaySeq) return;
        if (idx >= sources.length) {
            console.log("All sources failed");
            finish();
            return;
        }
        const src = sources[idx++];
        console.log("Trying source:", src);
        if (!giftVideo) return;
        giftVideo.muted = useEmbeddedGiftSound;

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

        // Clear any previous event listeners by recreating the element
        if (idx > 1) resetGiftVideoElement();

        giftVideo.onended = () => {
            if (seq !== giftPlaySeq) return;
            console.log("Video ended");
            clearInterval(freezeWatchdog);
            finish();
        };
        giftVideo.onerror = (e) => {
            if (seq !== giftPlaySeq) return;
            console.error("Video error:", e, src);
            clearInterval(freezeWatchdog);
            tryNext();
        };

        positionGiftOverlay();
        const isUpgSrc = useLionUpgrade && src === lionUpgradeBlobUrl;
        if (isUpgSrc || useDoubleHeightGift) {
            giftOverlay.classList.add("lion-upgrade");
        } else {
            giftOverlay.classList.remove("lion-upgrade");
        }
        giftOverlay.classList.add("show");

        const startHideTimer = () => {
            if (seq !== giftPlaySeq) return;
            giftHideTimer = setTimeout(() => {
                if (seq !== giftPlaySeq) return;
                clearInterval(freezeWatchdog);
                finish();
            }, 10000);
        };

        // Freeze watchdog
        let lastWatchTime = -1;
        let freezeChecks = 0;
        const freezeWatchdog = setInterval(() => {
            if (seq !== giftPlaySeq || !giftVideo) { clearInterval(freezeWatchdog); return; }
            if (giftVideo.ended) { clearInterval(freezeWatchdog); return; }
            // If paused unexpectedly, try to resume
            if (giftVideo.paused && !giftVideo.ended && giftVideo.readyState >= 2) {
                console.warn("Video paused unexpectedly, resuming");
                giftVideo.play().catch(() => { });
                return;
            }
            if (!giftVideo.paused && giftVideo.currentTime === lastWatchTime) {
                freezeChecks++;
                if (freezeChecks >= 4) {
                    console.warn("Video freeze detected, recreating");
                    clearInterval(freezeWatchdog);
                    // Nuclear option: destroy and recreate
                    resetGiftVideoElement();
                    giftVideo.muted = true;
                    giftVideo.playsInline = true;
                    // Get fresh token if needed
                    (async () => {
                        const freshSrc = protectedGiftFiles.has(src)
                            ? (await getTokenUrl(src) || src)
                            : src + '?_cb=' + Date.now();
                        giftVideo.src = freshSrc;
                        giftVideo.load();
                        giftVideo.onended = () => { if (seq === giftPlaySeq) finish(); };
                        giftVideo.oncanplaythrough = () => {
                            giftVideo.play().catch(() => { });
                        };
                        startHideTimer();
                    })();
                    return;
                }
            } else {
                freezeChecks = 0;
            }
            lastWatchTime = giftVideo.currentTime;
        }, 400);

        // Set source and play
        giftVideo.muted = true; // Always start muted

        // iOS: use canvas rendering to remove black background from MP4
        // Lion upgrade: use canvas only for fade-out (already has alpha)
        const isLionUpgSrc = useLionUpgrade && src === lionUpgradeBlobUrl;
        const isDragonSrc = giftId === "dragon" && src.includes("dragonanimation.webm");
        const useCanvas = isLionUpgSrc || isDragonSrc || (isIOS && (src.endsWith(".mp4") || src.includes(".mp4?"))) || src.includes("pegasus.mp4") || src.includes("thunderfalcon.mp4");
        let giftCanvas = giftOverlay.querySelector(".gift-canvas");
        let canvasRaf = null;

        if (useCanvas) {
            giftVideo.classList.add("use-canvas");
            if (!giftCanvas) {
                giftCanvas = document.createElement("canvas");
                giftCanvas.className = "gift-canvas";
                giftOverlay.appendChild(giftCanvas);
            }
            const ctx = giftCanvas.getContext("2d", { willReadFrequently: true });

            const drawFrame = () => {
                if (seq !== giftPlaySeq || !giftVideo || giftVideo.paused || giftVideo.ended) {
                    return;
                }
                const vw = giftVideo.videoWidth || 480;
                const vh = giftVideo.videoHeight || 480;
                if (giftCanvas.width !== vw) giftCanvas.width = vw;
                if (giftCanvas.height !== vh) giftCanvas.height = vh;

                if (isLionUpgSrc || isDragonSrc) {
                    /* ---- Lion upgrade / Dragon: already transparent, only do fade-out ---- */
                    ctx.clearRect(0, 0, vw, vh);
                    const duration = Number(giftVideo.duration || 0);
                    const timeLeft = duration > 0 ? duration - giftVideo.currentTime : Infinity;
                    if (timeLeft <= 1) {
                        ctx.globalAlpha = Math.max(0, Math.min(1, timeLeft / 1));
                    } else {
                        ctx.globalAlpha = 1;
                    }
                    ctx.drawImage(giftVideo, 0, 0, vw, vh);
                    ctx.globalAlpha = 1;
                    canvasRaf = requestAnimationFrame(drawFrame);
                    return;
                }

                ctx.drawImage(giftVideo, 0, 0, vw, vh);
                const isLionMp4 = isIOS && src.includes("lionAnimation.mp4");
                const isThunder = src.includes("thunderfalcon.mp4");
                if (src.includes("pegasus.mp4") || isThunder || isLionMp4) {
                    const blurH = Math.floor(vh * 0.25);
                    ctx.filter = "blur(4px)";
                    ctx.drawImage(giftVideo, 0, 0, vw, blurH, 0, 0, vw, blurH);
                    ctx.filter = "none";
                }
                // Remove black pixels: make them transparent
                const imageData = ctx.getImageData(0, 0, vw, vh);
                const d = imageData.data;
                const isPegasus = src.includes("pegasus.mp4");
                const isLionKey = isLionMp4;
                const threshold = isLionKey ? 45 : 30; // stronger key for lion mp4
                if (isPegasus || isThunder) {
                    // Fade all pixels from 0% to 100% opacity across top 30%
                    const fadeAllH = Math.floor(vh * 0.3);
                    for (let y = 0; y < fadeAllH; y++) {
                        const fadeAll = y / Math.max(1, fadeAllH);
                        for (let x = 0; x < vw; x++) {
                            const i = (y * vw + x) * 4;
                            d[i + 3] = Math.round(d[i + 3] * fadeAll);
                        }
                    }
                } else if (isLionKey) {
                    const topBlackH = Math.floor(vh * 0.2);
                    const fadeBlackH = Math.floor(vh * 0.4);
                    for (let y = 0; y < fadeBlackH; y++) {
                        const fade = y < topBlackH ? 0 : (y - topBlackH) / Math.max(1, fadeBlackH - topBlackH);
                        for (let x = 0; x < vw; x++) {
                            const i = (y * vw + x) * 4;
                            const brightness = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
                            if (brightness < threshold) {
                                d[i + 3] = Math.round(255 * fade);
                            }
                        }
                    }

                    // Fade all pixels from 0% to 100% opacity across top 40%
                    const fadeAllH = Math.floor(vh * 0.4);
                    for (let y = 0; y < fadeAllH; y++) {
                        const fadeAll = y / Math.max(1, fadeAllH);
                        for (let x = 0; x < vw; x++) {
                            const i = (y * vw + x) * 4;
                            d[i + 3] = Math.round(d[i + 3] * fadeAll);
                        }
                    }
                } else {
                    for (let i = 0; i < d.length; i += 4) {
                        const brightness = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
                        if (brightness < threshold) {
                            d[i + 3] = 0; // fully transparent
                        } else if (brightness < threshold * 2) {
                            // Smooth transition for near-black pixels
                            d[i + 3] = Math.round((brightness - threshold) / threshold * 255);
                        }
                    }
                }

                // Fade out during the last 1 second of the animation
                const duration = Number(giftVideo.duration || 0);
                if (duration > 0) {
                    const timeLeft = duration - giftVideo.currentTime;
                    if (timeLeft <= 1) {
                        const fadeOut = Math.max(0, Math.min(1, timeLeft / 1));
                        for (let i = 0; i < d.length; i += 4) {
                            d[i + 3] = Math.round(d[i + 3] * fadeOut);
                        }
                    }
                }
                ctx.putImageData(imageData, 0, 0);
                canvasRaf = requestAnimationFrame(drawFrame);
            };

            // Start drawing when video plays
            giftVideo.addEventListener("playing", () => {
                drawFrame();
            }, { once: true });

            // Clean up canvas on end
            const origOnEnded = giftVideo.onended;
            giftVideo.onended = () => {
                if (canvasRaf) cancelAnimationFrame(canvasRaf);
                if (giftCanvas && giftCanvas.parentNode) giftCanvas.parentNode.removeChild(giftCanvas);
                if (origOnEnded) origOnEnded();
            };
        } else {
            // Remove canvas if present (non-iOS)
            if (giftCanvas && giftCanvas.parentNode) giftCanvas.parentNode.removeChild(giftCanvas);
            giftVideo.classList.remove("use-canvas");
        }

        /* Use source URL directly — server serves protected files to logged-in users */
        giftVideo.src = src;
        giftVideo.load();

        if (dragonStartOffsetSec > 0) {
            giftVideo.addEventListener("loadedmetadata", () => {
                try {
                    if (Number.isFinite(giftVideo.duration) && giftVideo.duration > dragonStartOffsetSec) {
                        giftVideo.currentTime = dragonStartOffsetSec;
                    }
                } catch (err) { /* ignore seek errors */ }
            }, { once: true });
        }

        // Wait for canplaythrough (most reliable on iOS)
        let playAttempted = false;
        const attemptPlay = () => {
            if (playAttempted || seq !== giftPlaySeq) return;
            playAttempted = true;
            // Ensure muted attribute is set (Safari checks attribute, not just property)
            giftVideo.muted = true;
            giftVideo.setAttribute("muted", "");
            giftVideo.play().then(() => {
                if (seq !== giftPlaySeq) return;
                console.log("Video playing (muted)");
                startHideTimer();
                // Unmute after successful play start if we want sound via _giftAudioEl
            }).catch((err1) => {
                console.warn("Muted play failed, retrying after frame:", err1.message);
                // Some browsers need a microtask/frame delay after DOM insertion
                requestAnimationFrame(() => {
                    if (seq !== giftPlaySeq) return;
                    giftVideo.muted = true;
                    giftVideo.setAttribute("muted", "");
                    giftVideo.play().then(() => {
                        if (seq !== giftPlaySeq) return;
                        console.log("Video playing (muted, retry)");
                        startHideTimer();
                    }).catch((err2) => {
                        console.error("Play completely failed:", err2);
                        clearInterval(freezeWatchdog);
                        tryNext();
                    });
                });
            });
        };

        giftVideo.addEventListener("canplaythrough", attemptPlay, { once: true });
        // Also listen for canplay as fallback
        giftVideo.addEventListener("canplay", () => {
            setTimeout(attemptPlay, 50);
        }, { once: true });
        // Fallback timeout — if nothing happens in 4s, force play
        setTimeout(attemptPlay, 4000);
    };

    tryNext();
}

function buildRoomSlots() {
    roomGrid.innerHTML = "";
    for (let i = 0; i < seatCount; i++) {
        const slot = document.createElement("div");
        slot.className = "slot";
        const bg = document.createElement("div");
        bg.className = "slot-bg";
        const bgImg = document.createElement("img");
        bgImg.className = "slot-bg-img";
        bgImg.style.display = "none";
        bg.appendChild(bgImg);
        const pointsPill = document.createElement("div");
        pointsPill.className = "seat-pill seat-pill-top";
        pointsPill.style.display = "none";
        const pointsIcon = document.createElement("img");
        pointsIcon.className = "seat-pill-icon";
        pointsIcon.src = "image/pointstar.png";
        pointsIcon.alt = "";
        const pointsWrap = document.createElement("span");
        pointsWrap.className = "seat-points-wrap";
        const pointsText = document.createElement("span");
        pointsText.className = "seat-points-text";
        pointsText.textContent = "0";
        pointsWrap.appendChild(pointsText);
        pointsPill.append(pointsIcon, pointsWrap);
        const muteIcon = document.createElement("img");
        muteIcon.className = "seat-mute";
        muteIcon.src = "image/mutemic.png";
        muteIcon.alt = "";
        muteIcon.style.display = "none";
        const lionIcon = document.createElement("img");
        lionIcon.className = "seat-lion-icon";
        lionIcon.src = "image/lionicon.png";
        lionIcon.alt = "";
        const plus = document.createElement("div");
        plus.className = "plus";
        plus.textContent = "+";
        const label = document.createElement("div");
        label.className = "label";
        label.textContent = "Request";
        const avatar = document.createElement("img");
        avatar.className = "slot-avatar";
        avatar.style.display = "none";
        const namePill = document.createElement("div");
        namePill.className = "seat-pill seat-pill-bottom";
        namePill.style.display = "none";
        const name = document.createElement("span");
        name.className = "seat-name-text";
        const plusCircle = document.createElement("span");
        plusCircle.className = "seat-plus-circle";
        const plusGlyph = document.createElement("span");
        plusGlyph.className = "seat-plus-glyph";
        plusGlyph.textContent = "+";
        plusCircle.appendChild(plusGlyph);
        namePill.append(name, plusCircle);
        slot.appendChild(bg);
        slot.appendChild(pointsPill);
        slot.appendChild(muteIcon);
        slot.appendChild(lionIcon);
        slot.appendChild(plus);
        slot.appendChild(label);
        slot.appendChild(avatar);
        slot.appendChild(namePill);
        roomGrid.appendChild(slot);
    }
    applyRoomStyle();
}

function formatSeatName(raw) {
    if (!raw) return "";
    const trimmed = raw.trim();
    if (trimmed.length >= 8) return trimmed.slice(0, 7) + "...";
    return trimmed;
}

function formatSeatPoints(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "0";
    const pointsFormat = String(roomStyle?.pointsFormat || "compact").toLowerCase();
    if (pointsFormat === "full") {
        return Math.round(num).toLocaleString();
    }
    const abs = Math.abs(num);
    if (abs >= 1_000_000) {
        const scaled = num / 1_000_000;
        const truncated = scaled >= 0
            ? Math.floor(scaled * 10) / 10
            : Math.ceil(scaled * 10) / 10;
        return `${truncated.toFixed(1)}m`;
    }
    if (abs >= 1_000) {
        const scaled = num / 1_000;
        const truncated = scaled >= 0
            ? Math.floor(scaled * 10) / 10
            : Math.ceil(scaled * 10) / 10;
        return `${truncated.toFixed(1)}k`;
    }
    return Math.round(num).toString();
}

const seatProfileCache = new Map();
const seatProfileInFlight = new Set();

function normalizeHandle(raw) {
    if (!raw) return "";
    return raw.trim().replace(/^@+/, "");
}

async function fetchSeatProfile(handle, idx) {
    const clean = normalizeHandle(handle);
    if (!clean || seatProfileInFlight.has(clean)) return;
    seatProfileInFlight.add(clean);
    try {
        const res = await fetch(`/api/tiktok/profile/${encodeURIComponent(clean)}`);
        if (!res.ok) return;
        const body = await res.json();
        const data = body?.data || body?.profile || body;
        if (!data) return;
        const avatar = data.avatar || data.avatarLarger || data.avatarThumb || "";
        const name = data.nickname || data.displayName || data.username || clean;
        seatProfileCache.set(clean, { avatar, name });
        if (seats[idx]) {
            seats[idx].avatar = avatar || seats[idx].avatar || "";
            seats[idx].name = name || seats[idx].name || seats[idx].handle || "";
            applyRoomStyle();
        }
    } catch (err) { /* ignore */ }
    finally { seatProfileInFlight.delete(clean); }
}

function applyRoomStyle() {
    const { slotHeight, colWidth, gap, bg1, bg2, blend, plusSize, labelSize, camWidth, camHeight, camRadius, camOffsetX, camOffsetY, closedCamWidth, closedCamHeight, closedCamOffsetX, closedCamOffsetY, roomWidth, roomHeight, roomRadius, roomOffsetX, roomOffsetY, animationWidth, animationHeight, animationOffsetX, animationOffsetY } = roomStyle;
    const requestStyle = String(roomStyle.requestTextStyle || "regular").toLowerCase();
    const requestFontMap = {
        regular: '"TikTok Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
        medium: '"TikTok Sans Medium", "TikTok Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
        semibold: '"TikTok Sans SemiBold", "TikTok Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
        bold: '"TikTok Sans Bold", "TikTok Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
        condensed: '"TikTok Sans Condensed", "TikTok Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
        expanded: '"TikTok Sans Expanded", "TikTok Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    };
    const requestFontFamily = requestFontMap[requestStyle] || requestFontMap.regular;
    roomGrid.style.gridTemplateColumns = `repeat(2, minmax(${colWidth}px, 1fr))`;
    roomGrid.style.gap = `${gap}px`;
    const isDesktop = window.matchMedia && window.matchMedia("(min-width: 900px)").matches;
    const desktopExtraX = isDesktop ? 700 : 0;
    const slots = roomGrid.querySelectorAll(".slot");
    const mix = Math.min(1, Math.max(0, blend ?? 0.5));
    const cut = Math.round((1 - mix) * 70);
    const gradient = bg2
        ? `linear-gradient(135deg, ${bg1} 0%, ${bg1} ${cut}%, ${bg2} 100%)`
        : bg1;
    slots.forEach((slot, idx) => {
        slot.style.minHeight = `${slotHeight}px`;
        slot.style.borderRadius = `${Math.max(0, Number(roomRadius) || 0)}px`;
        const seat = seats[idx];
        slot.classList.toggle("occupied", !!seat);
        if (seat && seat.avatar && !seatColors[idx]) {
            computeSeatColor(idx, seat.avatar);
        }
        if (seat && !seat.avatar && seat.handle) {
            const clean = normalizeHandle(seat.handle);
            if (clean && seatProfileCache.has(clean)) {
                const cached = seatProfileCache.get(clean);
                if (cached?.avatar) seat.avatar = cached.avatar;
                if (cached?.name) seat.name = cached.name;
            } else if (clean) {
                fetchSeatProfile(clean, idx);
            }
        }
        const bgEl = slot.querySelector('.slot-bg');
        const bgImg = bgEl ? bgEl.querySelector('img') : null;
        const pointsPill = slot.querySelector(".seat-pill-top");
        const pointsText = pointsPill ? pointsPill.querySelector(".seat-points-text") : null;
        const namePill = slot.querySelector(".seat-pill-bottom");
        const nameEl = namePill ? namePill.querySelector(".seat-name-text") : null;
        const muteIcon = slot.querySelector(".seat-mute");
        if (seat && seat.avatar) {
            // Show blurred avatar image as background
            slot.style.background = '#14171c';
            if (bgImg) {
                bgImg.src = seat.avatar;
                bgImg.style.display = 'block';
            }
        } else {
            if (bgImg) {
                bgImg.style.display = 'none';
            }
            slot.style.background = gradient;
        }
        const plusEl = slot.querySelector(".plus");
        const labelEl = slot.querySelector(".label");
        const avatarEl = slot.querySelector(".slot-avatar");
        if (seat) {
            seat.points = Number.isFinite(seat.points) ? seat.points : 0;
            if (plusEl) plusEl.style.display = "none";
            if (labelEl) labelEl.style.display = "none";
            if (avatarEl) {
                if (seat.avatar) {
                    avatarEl.src = seat.avatar;
                    avatarEl.alt = seat.handle || seat.name || "seat";
                    avatarEl.style.display = "block";
                } else {
                    avatarEl.style.display = "none";
                }
            }
            if (namePill && nameEl) {
                nameEl.textContent = formatSeatName(seat.name || seat.handle || "");
                namePill.style.display = "inline-flex";
            }
            if (pointsPill && pointsText) {
                const seatPoints = Number(seat.points ?? 0);
                pointsText.dataset.rawPoints = String(Number.isFinite(seatPoints) ? seatPoints : 0);
                pointsText.textContent = formatSeatPoints(seatPoints);
                pointsPill.style.display = "inline-flex";
            }
            if (muteIcon) muteIcon.style.display = "block";
        } else {
            if (plusEl) {
                plusEl.style.fontSize = `${plusSize}px`;
                plusEl.style.display = "block";
            }
            if (labelEl) {
                labelEl.style.fontSize = `${labelSize}px`;
                labelEl.style.fontFamily = requestFontFamily;
                labelEl.style.display = "block";
            }
            if (avatarEl) avatarEl.style.display = "none";
            if (namePill) namePill.style.display = "none";
            if (pointsPill) pointsPill.style.display = "none";
            if (muteIcon) muteIcon.style.display = "none";
        }
    });

    if (videoWrap) {
        const useClosed = !roomOpen;
        const nextCamWidth = useClosed ? (closedCamWidth ?? camWidth) : camWidth;
        const nextCamHeight = useClosed ? (closedCamHeight ?? camHeight) : camHeight;
        const nextCamOffsetX = useClosed ? (closedCamOffsetX ?? camOffsetX) : camOffsetX;
        const nextCamOffsetY = useClosed ? (closedCamOffsetY ?? camOffsetY) : camOffsetY;
        videoWrap.style.width = `${nextCamWidth}px`;
        videoWrap.style.height = `${nextCamHeight}px`;
        videoWrap.style.borderRadius = `${Math.max(0, Number(camRadius) || 0)}px`;
        videoWrap.style.transform = `translate(${nextCamOffsetX + desktopExtraX}px, ${nextCamOffsetY}px)`;
        resizeAiCanvas();
        resizeSegCanvas();
        if (window.VRMController && typeof window.VRMController.resize === "function") {
            window.VRMController.resize();
        }
    }

    if (roomPanel) {
        roomPanel.style.width = `${roomWidth}px`;
        roomPanel.style.height = `${roomHeight}px`;
        roomPanel.style.transform = `translate(${roomOffsetX + desktopExtraX}px, ${roomOffsetY}px)`;
    }

    if (animationBox) {
        animationBox.style.width = `${animationWidth}px`;
        animationBox.style.height = `${animationHeight}px`;
        animationBox.style.transform = `translate(${animationOffsetX + desktopExtraX}px, ${animationOffsetY}px)`;
    }

    positionGiftOverlay();
    try {
        localStorage.setItem(styleStoreKey, JSON.stringify({ ...roomStyle, _v: styleStoreVersion }));
    } catch (err) { /* ignore */ }
    debounceSaveLayout();
}

function broadcastCurrentStyle(origin = "host") {
    const payload = { type: "remote-style", style: { ...roomStyle, _v: styleStoreVersion }, source: origin, ts: Date.now() };
    if (channel) {
        channel.postMessage(payload);
    } else {
        localStorage.setItem(fallbackKey, JSON.stringify(payload));
    }
}

function updateRoomUI(open) {
    roomOpen = open;
    roomPanel.classList.toggle("show", open);
    resetSeatGiftIcons();
    applyRoomStyle();
    positionGiftOverlay();
}

async function startCamera() {
    try {
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            stream = null;
        }
    } catch (err) { /* ignore */ }
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: currentFacingMode } },
            audio: false,
        });
        videoEl.srcObject = stream;
        const playPromise = videoEl.play();
        if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(() => { });
        }
    } catch (err) {
        // Ignore camera errors to keep UI clean
    }
}

function isStreamActive() {
    if (!stream || typeof stream.getTracks !== "function") return false;
    return stream.getTracks().some((track) => track.readyState === "live");
}

function startMicMonitor() {
    if (micActive) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    micActive = true;
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        micStream = stream;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        micCtx = new AudioCtx();
        if (micCtx.state === "suspended") {
            micCtx.resume().catch(() => { });
        }
        const source = micCtx.createMediaStreamSource(stream);
        micAnalyser = micCtx.createAnalyser();
        micAnalyser.fftSize = 512;
        micData = new Uint8Array(micAnalyser.fftSize);
        source.connect(micAnalyser);
        const tick = () => {
            if (!micAnalyser || !micData) return;
            micAnalyser.getByteTimeDomainData(micData);
            let sum = 0;
            for (let i = 0; i < micData.length; i++) {
                const v = (micData[i] - 128) / 128;
                sum += v * v;
            }
            const rms = Math.sqrt(sum / micData.length);
            const speaking = rms > 0.04;
            if (videoWrap) videoWrap.classList.toggle("cam-speaking", speaking);
            micRaf = requestAnimationFrame(tick);
        };
        tick();
    }).catch(() => {
        micActive = false;
    });
}

function ensureMicStart() {
    if (!micActive) startMicMonitor();
    if (micCtx && micCtx.state === "suspended") {
        micCtx.resume().catch(() => { });
    }
}
["pointerdown", "touchstart", "click"].forEach((evt) => {
    document.addEventListener(evt, ensureMicStart, { passive: true });
});

function toggleCameraFacing() {
    currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
    try { localStorage.setItem(camFacingStoreKey, currentFacingMode); } catch (err) { /* ignore */ }
    startCamera();
}

function setCamBackground(dataUrl) {
    if (!camBgEl) return;
    if (dataUrl) {
        camBgEl.src = dataUrl;
        camBgEl.style.display = "block";
        // Auto-hide camera when background is set
        setCamVisible(false);
        // Stop camera stream only if VRM is NOT enabled
        if (!camVrmEnabled && stream) {
            try { stream.getTracks().forEach((track) => track.stop()); } catch (err) { /* ignore */ }
            stream = null;
            if (videoEl) videoEl.srcObject = null;
        } else if (camVrmEnabled && !isStreamActive()) {
            startCamera();
        }
    } else {
        camBgEl.src = "";
        camBgEl.style.display = "none";
        // Show camera again when background is cleared
        setCamVisible(true);
        if (!isStreamActive()) startCamera();
    }
    try { localStorage.setItem(camBgStoreKey, dataUrl || ""); } catch (err) { /* ignore */ }
    saveCamBgToServer(dataUrl || "");
}

function setAiAvatar(url) {
    camAiAvatarUrl = url || "";
    camAiAvatarReady = false;
    camAiAvatarImage.onload = () => { camAiAvatarReady = true; };
    camAiAvatarImage.onerror = () => { camAiAvatarReady = false; };
    if (camAiAvatarUrl) {
        camAiAvatarImage.src = camAiAvatarUrl;
    } else {
        camAiAvatarImage.src = "";
    }
}

function resizeAiCanvas() {
    if (!camAiCanvas || !videoWrap) return;
    camAiCanvas.width = videoWrap.clientWidth;
    camAiCanvas.height = videoWrap.clientHeight;
}

function resizeSegCanvas() {
    if (!camSegCanvas || !videoWrap) return;
    camSegCanvas.width = videoWrap.clientWidth;
    camSegCanvas.height = videoWrap.clientHeight;
}

function drawAiAvatar(results) {
    if (!camAiCanvas || !camAiCtx) return;
    camAiCtx.clearRect(0, 0, camAiCanvas.width, camAiCanvas.height);
    if (!camAiEnabled || !camAiAvatarReady) return;
    const faces = results && results.multiFaceLandmarks;
    if (!faces || !faces.length) return;
    const landmarks = faces[0];
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const p of landmarks) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    const w = camAiCanvas.width;
    const h = camAiCanvas.height;
    const faceW = (maxX - minX) * w;
    const faceH = (maxY - minY) * h;
    const centerX = (minX + maxX) * 0.5 * w;
    const centerY = (minY + maxY) * 0.5 * h;
    const scale = 1.4;
    const drawW = faceW * scale;
    const drawH = faceH * scale;
    const x = centerX - drawW / 2;
    const y = centerY - drawH / 2;
    camAiCtx.drawImage(camAiAvatarImage, x, y, drawW, drawH);
}

function initFaceMesh() {
    if (faceMesh || typeof FaceMesh === "undefined") return;
    faceMesh = new FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
    });
    faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
    });
    faceMesh.onResults(drawAiAvatar);
}

function initSelfieSegmentation() {
    if (selfieSegmentation || typeof SelfieSegmentation === "undefined") return;
    selfieSegmentation = new SelfieSegmentation({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1/${file}`,
    });
    selfieSegmentation.setOptions({ modelSelection: 1 });
    selfieSegmentation.onResults((results) => {
        if (!camSegCtx || !camSegCanvas) return;
        camSegCtx.clearRect(0, 0, camSegCanvas.width, camSegCanvas.height);
        if (!camSegEnabled) return;
        if (!results || !results.segmentationMask) return;

        const w = camSegCanvas.width;
        const h = camSegCanvas.height;

        camSegCtx.save();
        camSegCtx.drawImage(results.segmentationMask, 0, 0, w, h);
        camSegCtx.globalCompositeOperation = "source-in";
        camSegCtx.drawImage(results.image, 0, 0, w, h);
        camSegCtx.restore();

        if (camBgEl && camBgEl.style.display !== "none" && camBgEl.src) {
            camSegCtx.globalCompositeOperation = "destination-over";
            camSegCtx.drawImage(camBgEl, 0, 0, w, h);
            camSegCtx.globalCompositeOperation = "source-over";
        }
    });
}

async function aiFaceLoop() {
    if (!camAiEnabled || !faceMesh || !videoEl) return;
    if (videoEl.readyState >= 2) {
        try {
            await faceMesh.send({ image: videoEl });
        } catch (err) {
            // Ignore transient face mesh errors
        }
    }
    camAiLoopId = requestAnimationFrame(aiFaceLoop);
}

async function segLoop() {
    if (!camSegEnabled || !selfieSegmentation || !videoEl) return;
    if (videoEl.readyState >= 2) {
        try {
            await selfieSegmentation.send({ image: videoEl });
        } catch (err) {
            // Ignore transient segmentation errors
        }
    }
    camSegLoopId = requestAnimationFrame(segLoop);
}

function setAiFaceEnabled(next) {
    camAiEnabled = !!next;
    if (camAiEnabled && typeof FaceMesh === "undefined") {
        camAiEnabled = false;
        if (camAiFaceBtn) camAiFaceBtn.classList.remove("active");
        console.warn("FaceMesh not available; check CDN access.");
        return;
    }
    if (videoEl) videoEl.classList.toggle("cam-ai-face", camAiEnabled);
    if (camAiCanvas) camAiCanvas.style.display = camAiEnabled ? "block" : "none";
    if (camAiCtx && !camAiEnabled) camAiCtx.clearRect(0, 0, camAiCanvas.width, camAiCanvas.height);
    if (camAiEnabled) {
        initFaceMesh();
        resizeAiCanvas();
        if (!camAiLoopId) aiFaceLoop();
    } else if (camAiLoopId) {
        cancelAnimationFrame(camAiLoopId);
        camAiLoopId = null;
    }
}

function setSegEnabled(next) {
    camSegEnabled = !!next;
    if (camSegEnabled && typeof SelfieSegmentation === "undefined") {
        camSegEnabled = false;
        if (camSegBtn) camSegBtn.classList.remove("active");
        console.warn("SelfieSegmentation not available; check CDN access.");
        return;
    }
    if (camSegCanvas) camSegCanvas.style.display = camSegEnabled ? "block" : "none";
    if (camSegCtx && !camSegEnabled) camSegCtx.clearRect(0, 0, camSegCanvas.width, camSegCanvas.height);
    if (camSegEnabled) {
        initSelfieSegmentation();
        resizeSegCanvas();
        if (!camSegLoopId) segLoop();
    } else if (camSegLoopId) {
        cancelAnimationFrame(camSegLoopId);
        camSegLoopId = null;
    }
    applyCamVisibility();
}

function setVrmEnabled(next) {
    camVrmEnabled = !!next;
    if (camVrmCanvas) camVrmCanvas.style.display = camVrmEnabled ? "block" : "none";
    if (window.VRMController && typeof window.VRMController.enable === "function") {
        window.VRMController.enable(camVrmEnabled);
    }
    // If VRM is turned off while background is active, stop camera stream
    if (!camVrmEnabled && camBgEl && camBgEl.style.display !== "none") {
        if (stream) {
            try { stream.getTracks().forEach((track) => track.stop()); } catch (err) { /* ignore */ }
            stream = null;
            if (videoEl) videoEl.srcObject = null;
        }
    } else if (camVrmEnabled && !isStreamActive()) {
        startCamera();
    }
    applyCamVisibility();
}

function applyCamVisibility() {
    if (!videoEl) return;
    if (!camVisible) {
        videoEl.style.opacity = "0";
        return;
    }
    if (camVrmEnabled || camSegEnabled) {
        videoEl.style.opacity = "0";
    } else {
        videoEl.style.opacity = "1";
    }
}

function setCamVisible(next) {
    camVisible = !!next;
    if (camVisible) {
        if (camSegEnabled) setSegEnabled(false);
        if (camVrmEnabled) setVrmEnabled(false);
        if (!camSegEnabled && !camVrmEnabled && !isStreamActive()) {
            startCamera();
        }
    }
    applyCamVisibility();
}

function setCamToolsVisible(next) {
    camToolsVisible = !!next;
    if (camToolsEl) {
        camToolsEl.classList.toggle("show", camToolsVisible);
        camToolsEl.setAttribute("aria-hidden", camToolsVisible ? "false" : "true");
    }
}

// VRM is enabled by default
setVrmEnabled(true);

if (camVrmPickBtn && camVrmFile) {
    camVrmPickBtn.addEventListener("click", () => {
        camVrmFile.click();
    });
    camVrmFile.addEventListener("change", () => {
        const file = camVrmFile.files && camVrmFile.files[0];
        if (!file) return;
        setVrmEnabled(true);
        if (window.VRMController && typeof window.VRMController.loadFile === "function") {
            window.VRMController.loadFile(file);
        }
        camVrmFile.value = "";
    });
}

if (camVrmClearBtn) {
    camVrmClearBtn.addEventListener("click", () => {
        setVrmEnabled(false);
    });
}

if (camBgBtn && camBgFile) {
    camBgBtn.addEventListener("click", () => {
        camBgFile.click();
    });
    camBgFile.addEventListener("change", () => {
        const file = camBgFile.files && camBgFile.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === "string") {
                setCamBackground(reader.result);
            }
            camBgFile.value = "";
        };
        reader.readAsDataURL(file);
    });
}

if (camBgClearBtn) {
    camBgClearBtn.addEventListener("click", () => {
        setCamBackground("");
    });
}


function loadSeats() {
    try {
        const saved = localStorage.getItem(seatsStoreKey);
        if (!saved) return;
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === seatCount) {
            seats = parsed;
            seatColors = Array.from({ length: seatCount }, () => null);
            seats.forEach((seat, idx) => {
                if (seat && seat.avatar) computeSeatColor(idx, seat.avatar);
            });
        }
    } catch (err) { /* ignore */ }
}

function sendMessage(payload) {
    const message = { ...payload, ts: Date.now() };
    if (channel) {
        channel.postMessage(message);
    } else {
        localStorage.setItem(fallbackKey, JSON.stringify(message));
    }
    sendWs(message);
}

function handleIncoming(message) {
    if (!message || typeof message !== "object") return;
    if (!shouldProcessMessage(message)) return;
    if (message.type === "remote-command") {
        if (message.action === "open-room") updateRoomUI(true);
        if (message.action === "close-room") updateRoomUI(false);
        if (message.action === "start-camera") startCamera();
    } else if (message.type === "edit-mode" && typeof message.enabled === "boolean") {
        editMoveEnabled = message.enabled;
        if (animationBox) {
            animationBox.style.borderStyle = message.enabled ? "dashed" : "none";
        }
        if (editMoveEnabled) {
            applyEditZOrder(videoWrap || animationBox || roomPanel);
        } else {
            resetEditZOrder();
        }
    } else if (message.type === "save-layout") {
        try {
            localStorage.setItem(styleStoreKey, JSON.stringify({ ...roomStyle, _v: styleStoreVersion }));
        } catch (err) { /* ignore */ }
        saveLayoutToServer();
        console.log("Layout saved to localStorage + server");
    } else if (message.type === "remote-style" && message.style) {
        const { _v, ...rest } = message.style;
        roomStyle = { ...roomStyle, ...rest };
        applyRoomStyle();
    } else if (message.type === "remote-seats" && Array.isArray(message.seats)) {
        seats = message.seats;
        seatColors = Array.from({ length: seatCount }, () => null);
        seats.forEach((seat, idx) => {
            if (seat && seat.avatar) computeSeatColor(idx, seat.avatar);
        });
        try { localStorage.setItem(seatsStoreKey, JSON.stringify(seats)); } catch (err) { /* ignore */ }
        applyRoomStyle();
    } else if (message.type === "donate-gift" && message.giftId) {
        const idx = Number(message.seatIndex);
        if (Number.isInteger(idx) && idx >= 0 && idx < seatCount && seats[idx]) {
            // Optional handle check (prevents wrong seat update if remote got out of sync)
            if (!message.seatHandle || seats[idx].handle === message.seatHandle) {
                const delta = Number(message.pointsDelta);
                const current = Number(seats[idx].points);
                const safeCurrent = Number.isFinite(current) ? current : 0;
                const safeDelta = Number.isFinite(delta) ? delta : 0;
                seats[idx].points = safeCurrent + safeDelta;
                try { localStorage.setItem(seatsStoreKey, JSON.stringify(seats)); } catch (err) { /* ignore */ }
                applyRoomStyle();
                showSeatPointsRise(idx, safeDelta);
                if (message.giftId === "lion") {
                    showLionSeatIcon(idx);
                } else if (message.giftId === "leonandlion") {
                    showLionSeatIcon(idx, "image/leonandlionicon.png");
                } else if (message.giftId === "dragon") {
                    showLionSeatIcon(idx, "image/dragonicon.png");
                } else if (message.giftId === "pegasus") {
                    showLionSeatIcon(idx, "image/pegasusicon.png");
                } else if (message.giftId === "thunderfalcon") {
                    showLionSeatIcon(idx, "image/thunderfalconicon.png");
                }
            }
        }
        enqueueGiftAnimation(message.giftId);
    } else if (message.type === "play-gift" && message.giftId) {
        enqueueGiftAnimation(message.giftId);
    } else if (message.type === "cam-bg-updated" || message.type === "cam-bg") {
        const bgUrl = (message.dataUrl != null) ? message.dataUrl : (localStorage.getItem(camBgStoreKey) || "");
        setCamBackground(typeof bgUrl === "string" ? bgUrl : "");
    } else if (message.type === "toggle-camera") {
        toggleCameraFacing();
    } else if (message.type === "cam-tools" && typeof message.visible === "boolean") {
        setCamToolsVisible(message.visible);
    } else if (message.type === "cam-visibility" && typeof message.visible === "boolean") {
        setCamVisible(message.visible);
    } else if (message.type === "host-text-visibility" && typeof message.visible === "boolean") {
        const hp = document.getElementById("hostPill");
        if (hp) hp.style.display = message.visible ? "" : "none";
    } else if (message.type === "cam-name-text" && typeof message.text === "string") {
        const cp = document.getElementById("camNamePill");
        if (cp) cp.textContent = (message.text || "").trim() || "Host";
    } else if (message.type === "cam-name-visibility" && typeof message.visible === "boolean") {
        const cp = document.getElementById("camNamePill");
        if (cp) cp.style.display = message.visible ? "" : "none";
    } else if (message.type === "cam-name-capsule-visibility" && typeof message.visible === "boolean") {
        const cp = document.getElementById("camNamePill");
        if (cp) cp.classList.toggle("no-capsule", !message.visible);
    } else if (message.type === "vrm-default") {
        setVrmEnabled(true);
        if (window.VRMController && typeof window.VRMController.load === "function") {
            window.VRMController.load("vrm/vrm2.vrm");
        }
    } else if (message.type === "vrm-load" && typeof message.url === "string") {
        setVrmEnabled(true);
        if (window.VRMController && typeof window.VRMController.load === "function") {
            window.VRMController.load(message.url);
        }
    } else if (message.type === "vrm-pose" && typeof message.strong === "boolean") {
        setVrmEnabled(true);
        if (window.VRMController && typeof window.VRMController.setPoseStrong === "function") {
            window.VRMController.setPoseStrong(message.strong);
        }
    } else if (message.type === "vrm-pose-angle" && message.angle != null) {
        setVrmEnabled(true);
        if (window.VRMController && typeof window.VRMController.setPoseAngle === "function") {
            window.VRMController.setPoseAngle(message.angle);
        }
    } else if (message.type === "animation-box-visibility" && message.visible !== undefined) {
        if (animationBox) {
            animationBox.style.borderStyle = message.visible ? "dashed" : "none";
        }
    }
}

function enableDragResize(el, keyPrefix) {
    let mode = null;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;
    let startOX = 0;
    let startOY = 0;
    let pinchMode = false;
    let pinchStartDist = 0;
    let pinchStartW = 0;
    let pinchStartH = 0;
    let pinchStartOX = 0;
    let pinchStartOY = 0;
    const minSize = 160;
    const minHeight = 120;

    function resolveKeyPrefix() {
        if (keyPrefix === "cam" && !roomOpen) return "closedCam";
        return keyPrefix;
    }

    function getTouchDistance(t1, t2) {
        const dx = t2.clientX - t1.clientX;
        const dy = t2.clientY - t1.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function onPointerMove(e) {
        const activePrefix = resolveKeyPrefix();
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (mode === "move") {
            roomStyle[activePrefix + "OffsetX"] = startOX + dx;
            roomStyle[activePrefix + "OffsetY"] = startOY + dy;
        } else if (mode === "resize") {
            const widthDelta = (resizeRight ? dx : 0) + (resizeLeft ? -dx : 0);
            const heightDelta = (resizeBottom ? dy : 0) + (resizeTop ? -dy : 0);
            const nextW = Math.max(minSize, startW + widthDelta);
            const nextH = Math.max(minHeight, startH + heightDelta);
            roomStyle[activePrefix + "Width"] = nextW;
            roomStyle[activePrefix + "Height"] = nextH;
            if (resizeLeft) roomStyle[activePrefix + "OffsetX"] = startOX + dx;
            if (resizeTop) roomStyle[activePrefix + "OffsetY"] = startOY + dy;
        }
        applyRoomStyle();
        broadcastCurrentStyle("host-drag");
    }

    function onPointerUp() {
        mode = null;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
    }

    let resizeLeft = false;
    let resizeRight = false;
    let resizeTop = false;
    let resizeBottom = false;

    el.addEventListener("pointerdown", (e) => {
        if (!editMoveEnabled) return;
        const activePrefix = resolveKeyPrefix();
        const rect = el.getBoundingClientRect();
        const edge = 12;
        resizeLeft = e.clientX <= rect.left + edge;
        resizeRight = e.clientX >= rect.right - edge;
        resizeTop = e.clientY <= rect.top + edge;
        resizeBottom = e.clientY >= rect.bottom - edge;
        const isResize = resizeLeft || resizeRight || resizeTop || resizeBottom;
        mode = isResize ? "resize" : "move";
        startX = e.clientX;
        startY = e.clientY;
        startW = roomStyle[activePrefix + "Width"] || el.offsetWidth;
        startH = roomStyle[activePrefix + "Height"] || el.offsetHeight;
        startOX = roomStyle[activePrefix + "OffsetX"] || 0;
        startOY = roomStyle[activePrefix + "OffsetY"] || 0;
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
    });

    // Pinch-to-resize for touch devices
    el.addEventListener("touchstart", (e) => {
        if (!editMoveEnabled) return;
        if (e.touches.length !== 2) return;
        const activePrefix = resolveKeyPrefix();
        pinchMode = true;
        pinchStartDist = getTouchDistance(e.touches[0], e.touches[1]);
        pinchStartW = roomStyle[activePrefix + "Width"] || el.offsetWidth;
        pinchStartH = roomStyle[activePrefix + "Height"] || el.offsetHeight;
        pinchStartOX = roomStyle[activePrefix + "OffsetX"] || 0;
        pinchStartOY = roomStyle[activePrefix + "OffsetY"] || 0;
    }, { passive: true });

    el.addEventListener("touchmove", (e) => {
        if (!editMoveEnabled || !pinchMode) return;
        if (e.touches.length !== 2) return;
        const activePrefix = resolveKeyPrefix();
        const dist = getTouchDistance(e.touches[0], e.touches[1]);
        if (!pinchStartDist) return;
        const scale = dist / pinchStartDist;
        const nextW = Math.max(minSize, Math.round(pinchStartW * scale));
        const nextH = Math.max(minHeight, Math.round(pinchStartH * scale));
        roomStyle[activePrefix + "Width"] = nextW;
        roomStyle[activePrefix + "Height"] = nextH;
        roomStyle[activePrefix + "OffsetX"] = pinchStartOX + Math.round((pinchStartW - nextW) / 2);
        roomStyle[activePrefix + "OffsetY"] = pinchStartOY + Math.round((pinchStartH - nextH) / 2);
        applyRoomStyle();
        broadcastCurrentStyle("host-pinch");
    }, { passive: true });

    el.addEventListener("touchend", () => {
        pinchMode = false;
    }, { passive: true });
}

function initChannel() {
    if (channel) {
        channel.addEventListener("message", (event) => handleIncoming(event.data));
    } else {
        window.addEventListener("storage", (event) => {
            if (event.key === fallbackKey && event.newValue) {
                try { handleIncoming(JSON.parse(event.newValue)); } catch (err) { /* ignore */ }
            }
        });
    }
    // Listen for direct localStorage writes (cam bg is stored directly by Mode 2)
    window.addEventListener("storage", (event) => {
        if (event.key === camBgStoreKey) {
            setCamBackground(event.newValue || "");
        }
    });
    sendMessage({ type: "hello" });
}

buildRoomSlots();
loadSeats();
// Load layout from server first, fall back to localStorage
(async function loadSavedLayout() {
    let loaded = await loadLayoutFromServer();
    if (!loaded) {
        try {
            const saved = localStorage.getItem(styleStoreKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed && typeof parsed === "object" && parsed._v === styleStoreVersion) {
                    const { _v, ...rest } = parsed;
                    roomStyle = { ...roomStyle, ...rest };
                }
            }
        } catch (err) { /* ignore */ }
    }
    applyRoomStyle();
    updateRoomUI(roomOpen);
})();
enableDragResize(videoWrap, "cam");
enableDragResize(roomPanel, "room");
enableDragResize(animationBox, "animation");
initChannel();
// preloadGiftAssets is called after requireLogin succeeds
// After init, broadcast mode1's actual layout so mode2 sliders stay in sync
setTimeout(() => broadcastCurrentStyle("host-init"), 500);
try {
    const savedFacing = localStorage.getItem(camFacingStoreKey);
    if (savedFacing === "user" || savedFacing === "environment") currentFacingMode = savedFacing;
} catch (err) { /* ignore */ }
try {
    if (!camBgLoadedFromServer) {
        const savedBg = localStorage.getItem(camBgStoreKey);
        if (savedBg) setCamBackground(savedBg);
    }
} catch (err) { /* ignore */ }
startCamera();
startMicMonitor();
positionGiftOverlay();
window.addEventListener("resize", positionGiftOverlay);
window.addEventListener("resize", applyRoomStyle);
if (preferredMode === "host") {
    // already in host mode
}
