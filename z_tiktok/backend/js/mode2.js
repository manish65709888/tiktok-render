/* ── Single-instance guard: only one Mode 2 tab allowed ── */
(function () {
    const CHANNEL_NAME = 'mode2-single-instance';
    const instanceId = Date.now() + '-' + Math.random().toString(36).slice(2);
    const singleCh = new BroadcastChannel(CHANNEL_NAME);

    // Tell any existing Mode 2 tab to close
    singleCh.postMessage({ type: 'takeover', id: instanceId });

    singleCh.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'takeover' && e.data.id !== instanceId) {
            // A newer Mode 2 tab opened – close this one
            singleCh.close();
            window.location.href = 'portal.html';
        }
    });
})();

let ws = null;
let wsRoomId = null;
let layoutKey = "default";

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

function saveStoredDisplayName(username, value) {
    try {
        localStorage.setItem(getDisplayNameStorageKey(username), (value || '').trim() || 'Host');
    } catch (err) {
        // ignore
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
            handleRemoteMessage(msg);
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
        const storedName = getStoredDisplayName(wsRoomId);
        const camNameEl = document.getElementById("camNameInput");
        if (camNameEl) camNameEl.value = storedName;
        connectWs(wsRoomId);
        sendMessage({ type: "cam-name-text", text: storedName });
        // Load layout for this user
        hydrateFromStore();
    } catch (err) {
        window.location.href = 'portal.html';
    }
}
requireLogin();

const channelName = "tiktok-room-control";
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(channelName) : null;
const fallbackKey = "tiktok-room-control-message";
const styleStoreKey = "tiktok-room-style-latest";
const styleStoreVersion = 2;

const defaultStyle = {
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

/* ---- Server-backed layout helpers ---- */
async function loadLayoutFromServer() {
    try {
        const resp = await fetch(`/api/layout?key=${encodeURIComponent(layoutKey)}`);
        const data = await resp.json();
        if (data.ok && data.style && typeof data.style === 'object') {
            return data.style;
        }
    } catch (err) { /* ignore */ }
    return null;
}

/* ---- CSRF helper ---- */
function getCsrfToken() {
    const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : '';
}

async function saveLayoutToServer(style) {
    try {
        await fetch('/api/layout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
            body: JSON.stringify({ key: layoutKey, style })
        });
    } catch (err) { /* ignore */ }
}
const transparentAvatar = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const giftOptions = [
    {
        id: "lion",
        name: "Lion Gift",
        img: "image/lion_img.png",
        animation: "image/lionAnimation.mp4",
        sources: ["image/lionAnimation.mp4", "image/lionAnimation.webm"],
    },
    {
        id: "leonandlion",
        name: "Leon and Lion",
        img: "image/leonandlion_img.png",
        animation: "image/!Leon and Lion (34000).webm",
        sources: ["image/!Leon and Lion (34000).webm"],
    },
    {
        id: "dragon",
        name: "Dragon",
        img: "image/dragonicon.png",
        animation: "image/dragonanimation.webm",
        sources: ["image/dragonanimation.webm"],
    },
    {
        id: "pegasus",
        name: "Pegasus Gift",
        img: "image/pegasus_img.png",
        animation: "image/pegasus.mp4",
        sources: ["image/pegasus.mp4"],
    },
    {
        id: "thunderfalcon",
        name: "Thunder Falcon",
        img: "image/thunderfalfon_img.jpeg",
        animation: "image/thunderfalcon.mp4",
        sources: ["image/thunderfalcon.mp4"],
    },
];
// Allow overriding API host with ?api=http://yourhost:port, default to same origin.
const apiOverride = new URLSearchParams(window.location.search).get("api");
const apiGuessBase = apiOverride ? apiOverride.replace(/\/$/, "") : window.location.origin;
const profileEndpoints = [
    `${apiGuessBase}/api/tiktok/profile/`,
];

const qs = new URLSearchParams(location.search);
const preferredMode = qs.get("mode");

const remoteOpenBtn = document.getElementById("remoteOpen");
const remoteStartCamBtn = document.getElementById("remoteStartCam");
const toggleEditMoveBtn = document.getElementById("toggleEditMove");
const saveLayoutBtn = document.getElementById("saveLayout");
const resetLayoutBtn = document.getElementById("resetLayout");
const openHostBtn = document.getElementById("openHost");
const toggleStyleBtn = document.getElementById("toggleStyle");
const toggleAnimationBodyBtn = document.getElementById("toggleAnimationBody");
const toggleCamBtn = document.getElementById("toggleCam");
const styleBody = document.getElementById("styleBody");
const camBody = document.getElementById("camBody");
const previewGrid = document.getElementById("previewGrid");
const roomStatus = document.getElementById("roomStatus");
const toggleSeatsBtn = document.getElementById("toggleSeats");
const heightInput = document.getElementById("heightInput");
const widthInput = document.getElementById("widthInput");
const gapInput = document.getElementById("gapInput");
const color1 = document.getElementById("color1");
const color2 = document.getElementById("color2");
const blendInput = document.getElementById("blendInput");
const plusSizeInput = document.getElementById("plusSizeInput");
const labelSizeInput = document.getElementById("labelSizeInput");
const requestStyleSelect = document.getElementById("requestStyleSelect");
const pointsFormatSelect = document.getElementById("pointsFormatSelect");
const camWidthInput = document.getElementById("camWidthInput");
const camHeightInput = document.getElementById("camHeightInput");
const camRadiusInput = document.getElementById("camRadiusInput");
const camXInput = document.getElementById("camXInput");
const camYInput = document.getElementById("camYInput");
const roomWidthInput = document.getElementById("roomWidthInput");
const roomHeightInput = document.getElementById("roomHeightInput");
const roomRadiusInput = document.getElementById("roomRadiusInput");
const roomXInput = document.getElementById("roomXInput");
const roomYInput = document.getElementById("roomYInput");
const heightValue = document.getElementById("heightValue");
const widthValue = document.getElementById("widthValue");
const gapValue = document.getElementById("gapValue");
const blendValue = document.getElementById("blendValue");
const plusSizeValue = document.getElementById("plusSizeValue");
const labelSizeValue = document.getElementById("labelSizeValue");
const camWidthValue = document.getElementById("camWidthValue");
const camHeightValue = document.getElementById("camHeightValue");
const camRadiusValue = document.getElementById("camRadiusValue");
const camXValue = document.getElementById("camXValue");
const camYValue = document.getElementById("camYValue");
const closedCamWidthInput = document.getElementById("closedCamWidthInput");
const closedCamHeightInput = document.getElementById("closedCamHeightInput");
const closedCamXInput = document.getElementById("closedCamXInput");
const closedCamYInput = document.getElementById("closedCamYInput");
const closedCamWidthValue = document.getElementById("closedCamWidthValue");
const closedCamHeightValue = document.getElementById("closedCamHeightValue");
const closedCamXValue = document.getElementById("closedCamXValue");
const closedCamYValue = document.getElementById("closedCamYValue");
const roomWidthValue = document.getElementById("roomWidthValue");
const roomHeightValue = document.getElementById("roomHeightValue");
const roomRadiusValue = document.getElementById("roomRadiusValue");
const roomXValue = document.getElementById("roomXValue");
const roomYValue = document.getElementById("roomYValue");
const animationWidthInput = document.getElementById("animationWidthInput");
const animationHeightInput = document.getElementById("animationHeightInput");
const animationXInput = document.getElementById("animationXInput");
const animationYInput = document.getElementById("animationYInput");
const animationWidthValue = document.getElementById("animationWidthValue");
const animationHeightValue = document.getElementById("animationHeightValue");
const animationXValue = document.getElementById("animationXValue");
const animationYValue = document.getElementById("animationYValue");
const toggleAnimationBoxBtn = document.getElementById("toggleAnimationBox");
const toggleCamFacingBtn = document.getElementById("toggleCamFacing");
const toggleCamVisibleBtn = document.getElementById("toggleCamVisible");
const camNameInput = document.getElementById("camNameInput");
const applyCamNameBtn = document.getElementById("applyCamName");
const toggleCamNameTextBtn = document.getElementById("toggleCamNameText");
const toggleCamNameCapsuleBtn = document.getElementById("toggleCamNameCapsule");
const toggleCamToolsBtn = document.getElementById("toggleCamTools");
const setDefaultVrmBtn = document.getElementById("setDefaultVrm");
const setVrm1Btn = document.getElementById("setVrm1");
const setVrm2Btn = document.getElementById("setVrm2");
const setVrmTestBtn = document.getElementById("setVrmTest");
const vrmPoseAngleInput = document.getElementById("vrmPoseAngleInput");
const vrmPoseAngleValue = document.getElementById("vrmPoseAngleValue");

const seatsStoreKey = "tiktok-room-seats-v2";
const seatCount = 8;
let seats = Array.from({ length: seatCount }, () => null);
let roomOpen = true;
let openGiftMenu = null;
let animationBoxVisible = false;
let editMoveEnabled = false;
let camVisible = true;

function sendMessage(payload) {
    const message = { ...payload, ts: Date.now() };
    if (channel) {
        channel.postMessage(message);
    } else {
        localStorage.setItem(fallbackKey, JSON.stringify(message));
    }
    sendWs(message);
}

function handleRemoteMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "remote-style" && msg.source && msg.source.startsWith("host")) {
        applyIncomingStyle(msg.style);
    }
    if (msg.type === "remote-command" && msg.action === "open-room") setRoomOpen(true);
    if (msg.type === "remote-command" && msg.action === "close-room") setRoomOpen(false);
}

function collectStyle() {
    return {
        slotHeight: Number(heightInput.value),
        colWidth: Number(widthInput.value),
        gap: Number(gapInput.value),
        bg1: color1.value,
        bg2: color2.value,
        blend: Number(blendInput.value) / 100,
        plusSize: Number(plusSizeInput.value),
        labelSize: Number(labelSizeInput.value),
        requestTextStyle: requestStyleSelect?.value || "regular",
        pointsFormat: pointsFormatSelect?.value || "compact",
        camWidth: Number(camWidthInput.value),
        camHeight: Number(camHeightInput.value),
        camRadius: Number(camRadiusInput.value),
        camOffsetX: Number(camXInput.value),
        camOffsetY: Number(camYInput.value),
        closedCamWidth: Number(closedCamWidthInput.value),
        closedCamHeight: Number(closedCamHeightInput.value),
        closedCamOffsetX: Number(closedCamXInput.value),
        closedCamOffsetY: Number(closedCamYInput.value),
        roomWidth: Number(roomWidthInput.value),
        roomHeight: Number(roomHeightInput.value),
        roomRadius: Number(roomRadiusInput.value),
        roomOffsetX: Number(roomXInput.value),
        roomOffsetY: Number(roomYInput.value),
        animationWidth: Number(animationWidthInput.value),
        animationHeight: Number(animationHeightInput.value),
        animationOffsetX: Number(animationXInput.value),
        animationOffsetY: Number(animationYInput.value),
    };
}

function loadStoredStyle() {
    try {
        const saved = localStorage.getItem(styleStoreKey);
        if (!saved) return null;
        const parsed = JSON.parse(saved);
        if (!parsed || typeof parsed !== "object") return null;
        if (parsed._v !== styleStoreVersion) return null;
        const { _v, ...rest } = parsed;
        return rest;
    } catch (err) {
        return null;
    }
}

function broadcastStyle() {
    const merged = { ...(loadStoredStyle() || {}), ...collectStyle() };
    try { localStorage.setItem(styleStoreKey, JSON.stringify({ ...merged, _v: styleStoreVersion })); } catch (err) { /* ignore */ }
    const style = merged;
    sendMessage({ type: "remote-style", style });
}

async function resetLayoutToDefaults() {
    hydrateSliders(defaultStyle);
    broadcastStyle();
    const style = { ...collectStyle(), _v: styleStoreVersion };
    await saveLayoutToServer(style);
    sendMessage({ type: "save-layout" });
}

function saveSeats() {
    try { localStorage.setItem(seatsStoreKey, JSON.stringify(seats)); } catch (err) { /* ignore */ }
}

function loadSeats() {
    try {
        const saved = localStorage.getItem(seatsStoreKey);
        if (!saved) return;
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === seatCount) seats = parsed;
    } catch (err) { /* ignore */ }
}

function normalizeHandle(raw) {
    if (!raw) return "";
    const cleaned = raw.trim().replace(/^@+/, "");
    return cleaned;
}

async function fetchTikTokProfile(rawHandle) {
    const clean = normalizeHandle(rawHandle);
    if (!clean) return null;
    for (const base of profileEndpoints) {
        const url = `${base}${encodeURIComponent(clean)}`;
        try {
            const res = await fetch(url, { headers: { Accept: "application/json" } });
            if (!res.ok) throw new Error(`lookup failed ${res.status}`);
            const body = await res.json();
            const data = body?.data || body?.profile || body;
            if (!data) throw new Error("no profile payload");
            const username = data.username || data.uniqueId || clean;
            const display = data.nickname || data.displayName || username || clean;
            const avatar = data.avatar || data.avatarLarger || data.avatarThumb || "";
            return {
                handle: username.startsWith("@") ? username : "@" + username,
                name: display,
                avatar,
                followers: data.followers ?? data.followerCount,
                likes: data.likes ?? data.likesCount,
            };
        } catch (err) {
            console.warn("TikTok lookup failed", url, err);
        }
    }
    return {
        handle: "@" + clean,
        name: "@" + clean,
        avatar: "",
    };
}

function broadcastSeats() {
    saveSeats();
    sendMessage({ type: "remote-seats", seats });
}

function sendGift(giftId) {
    sendMessage({ type: "play-gift", giftId });
}

function toggleAnimationBoxVisibility() {
    animationBoxVisible = !animationBoxVisible;
    toggleAnimationBoxBtn.textContent = animationBoxVisible ? "Hide Border" : "Show Border";
    sendMessage({ type: "animation-box-visibility", visible: animationBoxVisible });
}

function closeActiveGiftMenu() {
    if (openGiftMenu) {
        openGiftMenu.setAttribute("hidden", "hidden");
        openGiftMenu = null;
    }
}

function initChannel() {
    // No listeners needed here; remote only sends
    sendMessage({ type: "hello" });
}

function setRoomOpen(next) {
    roomOpen = next;
    roomStatus.textContent = next ? "Open" : "Closed";
    remoteOpenBtn.textContent = next ? "Close 8-seat room" : "Open 8-seat room";
    sendMessage({ type: "remote-command", action: next ? "open-room" : "close-room" });
}

remoteOpenBtn.addEventListener("click", () => {
    setRoomOpen(!roomOpen);
});

remoteStartCamBtn.addEventListener("click", () => {
    sendMessage({ type: "remote-command", action: "start-camera" });
});

if (toggleEditMoveBtn) {
    toggleEditMoveBtn.addEventListener("click", () => {
        editMoveEnabled = !editMoveEnabled;
        toggleEditMoveBtn.textContent = editMoveEnabled ? "Edit Move: On" : "Edit Move: Off";
        sendMessage({ type: "edit-mode", enabled: editMoveEnabled });
    });
}

if (saveLayoutBtn) {
    saveLayoutBtn.addEventListener("click", async () => {
        sendMessage({ type: "save-layout" });
        // Also save directly from mode2's current slider values
        const style = { ...collectStyle(), _v: styleStoreVersion };
        await saveLayoutToServer(style);
        console.log("Layout saved to server from mode2");
    });
}

if (resetLayoutBtn) {
    resetLayoutBtn.addEventListener("click", () => {
        resetLayoutToDefaults();
    });
}

openHostBtn.addEventListener("click", () => {
    window.open("mode1.html?mode=host", "_blank");
});

document.addEventListener("click", (e) => {
    if (!openGiftMenu) return;
    if (!openGiftMenu.contains(e.target)) {
        closeActiveGiftMenu();
    }
});

toggleSeatsBtn.addEventListener("click", () => {
    const hidden = previewGrid.hasAttribute("hidden");
    if (hidden) {
        previewGrid.removeAttribute("hidden");
        toggleSeatsBtn.textContent = "Hide";
    } else {
        previewGrid.setAttribute("hidden", "hidden");
        toggleSeatsBtn.textContent = "Show";
    }
});

toggleStyleBtn.addEventListener("click", () => {
    const collapsed = styleBody.getAttribute("data-collapsed") === "true";
    styleBody.setAttribute("data-collapsed", collapsed ? "false" : "true");
    toggleStyleBtn.textContent = collapsed ? "⚙️ ▲" : "⚙️ ▼";
});

toggleCamBtn.addEventListener("click", () => {
    const collapsed = camBody.getAttribute("data-collapsed") === "true";
    camBody.setAttribute("data-collapsed", collapsed ? "false" : "true");
    toggleCamBtn.textContent = collapsed ? "📷 ▲" : "📷 ▼";
});

toggleAnimationBodyBtn.addEventListener("click", () => {
    const collapsed = animationBody.getAttribute("data-collapsed") === "true";
    animationBody.setAttribute("data-collapsed", collapsed ? "false" : "true");
    toggleAnimationBodyBtn.textContent = collapsed ? "⚙️ ▲" : "⚙️ ▼";
});

toggleAnimationBoxBtn.addEventListener("click", () => {
    toggleAnimationBoxVisibility();
});

if (toggleCamFacingBtn) {
    toggleCamFacingBtn.addEventListener("click", () => {
        sendMessage({ type: "toggle-camera" });
    });
}

if (toggleCamVisibleBtn) {
    toggleCamVisibleBtn.addEventListener("click", () => {
        camVisible = !camVisible;
        toggleCamVisibleBtn.textContent = camVisible ? "Hide Cam" : "Show Cam";
        sendMessage({ type: "cam-visibility", visible: camVisible });
    });
}

let hostTextVisible = true;
const toggleHostTextBtn = document.getElementById("toggleHostText");
if (toggleHostTextBtn) {
    toggleHostTextBtn.addEventListener("click", () => {
        hostTextVisible = !hostTextVisible;
        toggleHostTextBtn.textContent = hostTextVisible ? "Hide Host Text" : "Show Host Text";
        sendMessage({ type: "host-text-visibility", visible: hostTextVisible });
    });
}

function sendCamNameText() {
    const nextText = (camNameInput?.value || "").trim() || "Host";
    saveStoredDisplayName(wsRoomId, nextText);
    sendMessage({ type: "cam-name-text", text: nextText });
}

if (applyCamNameBtn) {
    applyCamNameBtn.addEventListener("click", () => {
        sendCamNameText();
    });
}

if (camNameInput) {
    camNameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            sendCamNameText();
        }
    });
}

let camNameTextVisible = true;
if (toggleCamNameTextBtn) {
    toggleCamNameTextBtn.addEventListener("click", () => {
        camNameTextVisible = !camNameTextVisible;
        toggleCamNameTextBtn.textContent = camNameTextVisible ? "Hide Cam Name" : "Show Cam Name";
        sendMessage({ type: "cam-name-visibility", visible: camNameTextVisible });
    });
}

let camNameCapsuleVisible = false;
if (toggleCamNameCapsuleBtn) {
    toggleCamNameCapsuleBtn.addEventListener("click", () => {
        camNameCapsuleVisible = !camNameCapsuleVisible;
        toggleCamNameCapsuleBtn.textContent = camNameCapsuleVisible ? "Hide Name Capsule" : "Show Name Capsule";
        sendMessage({ type: "cam-name-capsule-visibility", visible: camNameCapsuleVisible });
    });
}

let camToolsVisible = false;
if (toggleCamToolsBtn) {
    toggleCamToolsBtn.addEventListener("click", () => {
        camToolsVisible = !camToolsVisible;
        toggleCamToolsBtn.textContent = camToolsVisible ? "Hide Cam Tools" : "Show Cam Tools";
        sendMessage({ type: "cam-tools", visible: camToolsVisible });
    });
}

if (setDefaultVrmBtn) {
    setDefaultVrmBtn.addEventListener("click", () => {
        sendMessage({ type: "vrm-default" });
    });
}

if (setVrm1Btn) {
    setVrm1Btn.addEventListener("click", () => {
        sendMessage({ type: "vrm-load", url: "vrm/vrm1.vrm" });
    });
}

if (setVrm2Btn) {
    setVrm2Btn.addEventListener("click", () => {
        sendMessage({ type: "vrm-load", url: "vrm/vrm2.vrm" });
    });
}

if (setVrmTestBtn) {
    setVrmTestBtn.addEventListener("click", () => {
        sendMessage({ type: "vrm-load", url: "vrm/test.vrm" });
    });
}

function syncVrmPoseAngle(nextValue) {
    const safeValue = Number(nextValue);
    if (!Number.isFinite(safeValue)) return;
    if (vrmPoseAngleInput) vrmPoseAngleInput.value = String(safeValue);
    if (vrmPoseAngleValue) vrmPoseAngleValue.value = String(safeValue);
    sendMessage({ type: "vrm-pose-angle", angle: safeValue });
}

if (vrmPoseAngleInput) {
    vrmPoseAngleInput.addEventListener("input", (e) => {
        syncVrmPoseAngle(e.target.value);
    });
}

if (vrmPoseAngleValue) {
    vrmPoseAngleValue.addEventListener("change", (e) => {
        syncVrmPoseAngle(e.target.value);
    });
}

// Style controls
function syncLabels() {
    heightValue.value = heightInput.value;
    widthValue.value = widthInput.value;
    gapValue.value = gapInput.value;
    blendValue.value = blendInput.value;
    plusSizeValue.value = plusSizeInput.value;
    labelSizeValue.value = labelSizeInput.value;
    camWidthValue.value = camWidthInput.value;
    camHeightValue.value = camHeightInput.value;
    camRadiusValue.value = camRadiusInput.value;
    camXValue.value = camXInput.value;
    camYValue.value = camYInput.value;
    closedCamWidthValue.value = closedCamWidthInput.value;
    closedCamHeightValue.value = closedCamHeightInput.value;
    closedCamXValue.value = closedCamXInput.value;
    closedCamYValue.value = closedCamYInput.value;
    roomWidthValue.value = roomWidthInput.value;
    roomHeightValue.value = roomHeightInput.value;
    roomRadiusValue.value = roomRadiusInput.value;
    roomXValue.value = roomXInput.value;
    roomYValue.value = roomYInput.value;
    animationWidthValue.value = animationWidthInput.value;
    animationHeightValue.value = animationHeightInput.value;
    animationXValue.value = animationXInput.value;
    animationYValue.value = animationYInput.value;
}

function applyPreviewStyle() {
    const style = collectStyle();
    previewGrid.style.gridTemplateColumns = `repeat(2, minmax(${style.colWidth}px, 1fr))`;
    previewGrid.style.gap = `${style.gap}px`;
    const mix = Math.min(1, Math.max(0, style.blend ?? 0.5));
    const cut = Math.round((1 - mix) * 70);
    const gradient = style.bg2
        ? `linear-gradient(135deg, ${style.bg1} 0%, ${style.bg1} ${cut}%, ${style.bg2} 100%)`
        : style.bg1;
    previewGrid.querySelectorAll(".seat").forEach((seatEl) => {
        seatEl.style.minHeight = `${style.slotHeight}px`;
        seatEl.style.borderRadius = `${style.roomRadius}px`;
        seatEl.style.background = gradient;
        const nameEl = seatEl.querySelector(".seat-name");
        if (nameEl) nameEl.style.fontSize = `${style.labelSize}px`;
    });
}

function renderSeatsPreview() {
    closeActiveGiftMenu();
    previewGrid.innerHTML = "";
    seats.forEach((seat, idx) => {
        const seatEl = document.createElement("div");
        seatEl.className = "seat";
        seatEl.dataset.index = idx;
        const seatMain = document.createElement("div");
        seatMain.className = "seat-main";
        const avatar = document.createElement("img");
        avatar.className = "seat-avatar";
        avatar.src = seat?.avatar || transparentAvatar;
        avatar.alt = seat?.handle || "";
        avatar.style.display = seat?.avatar ? "block" : "none";
        const name = document.createElement("div");
        name.className = "seat-name";
        name.textContent = seat?.name || "Empty";
        const actionsWrap = document.createElement("div");
        actionsWrap.className = "seat-actions";
        const action = document.createElement("button");
        action.className = "seat-action";
        action.textContent = seat ? "Kick" : "Add";
        action.type = "button";
        actionsWrap.append(action);

        const giftMenu = document.createElement("div");
        giftMenu.className = "gift-menu";
        giftMenu.setAttribute("hidden", "hidden");

        if (seat) {
            const donateBtn = document.createElement("button");
            donateBtn.className = "seat-action donate";
            donateBtn.textContent = "Donate";
            donateBtn.type = "button";
            donateBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const alreadyOpen = openGiftMenu === giftMenu;
                closeActiveGiftMenu();
                if (!alreadyOpen) {
                    giftMenu.removeAttribute("hidden");
                    openGiftMenu = giftMenu;
                }
            });
            actionsWrap.append(donateBtn);

            giftOptions.forEach((gift) => {
                const item = document.createElement("button");
                item.type = "button";
                item.className = "gift-item";
                const thumb = document.createElement("img");
                thumb.className = "gift-thumb";
                thumb.src = gift.img;
                thumb.alt = gift.name;
                const label = document.createElement("span");
                label.className = "gift-name";
                label.textContent = gift.name;
                item.append(thumb, label);
                item.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (gift.id === "lion" && seats[idx]) {
                        const delta = 29999;
                        const currentPoints = Number(seats[idx].points);
                        const nextPoints = (Number.isFinite(currentPoints) ? currentPoints : 0) + delta;
                        seats[idx].points = nextPoints;
                        saveSeats();
                        sendMessage({
                            type: "donate-gift",
                            giftId: gift.id,
                            seatIndex: idx,
                            seatHandle: seats[idx]?.handle || null,
                            pointsDelta: delta,
                            points: nextPoints,
                        });
                    } else if (gift.id === "leonandlion" && seats[idx]) {
                        const delta = 34000;
                        const currentPoints = Number(seats[idx].points);
                        const nextPoints = (Number.isFinite(currentPoints) ? currentPoints : 0) + delta;
                        seats[idx].points = nextPoints;
                        saveSeats();
                        sendMessage({
                            type: "donate-gift",
                            giftId: gift.id,
                            seatIndex: idx,
                            seatHandle: seats[idx]?.handle || null,
                            pointsDelta: delta,
                            points: nextPoints,
                        });
                    } else if (gift.id === "dragon" && seats[idx]) {
                        const delta = 26999;
                        const currentPoints = Number(seats[idx].points);
                        const nextPoints = (Number.isFinite(currentPoints) ? currentPoints : 0) + delta;
                        seats[idx].points = nextPoints;
                        saveSeats();
                        sendMessage({
                            type: "donate-gift",
                            giftId: gift.id,
                            seatIndex: idx,
                            seatHandle: seats[idx]?.handle || null,
                            pointsDelta: delta,
                            points: nextPoints,
                        });
                    } else if (gift.id === "pegasus" && seats[idx]) {
                        const delta = 42999;
                        const currentPoints = Number(seats[idx].points);
                        const nextPoints = (Number.isFinite(currentPoints) ? currentPoints : 0) + delta;
                        seats[idx].points = nextPoints;
                        saveSeats();
                        sendMessage({
                            type: "donate-gift",
                            giftId: gift.id,
                            seatIndex: idx,
                            seatHandle: seats[idx]?.handle || null,
                            pointsDelta: delta,
                            points: nextPoints,
                        });
                    } else if (gift.id === "thunderfalcon" && seats[idx]) {
                        const delta = 39999;
                        const currentPoints = Number(seats[idx].points);
                        const nextPoints = (Number.isFinite(currentPoints) ? currentPoints : 0) + delta;
                        seats[idx].points = nextPoints;
                        saveSeats();
                        sendMessage({
                            type: "donate-gift",
                            giftId: gift.id,
                            seatIndex: idx,
                            seatHandle: seats[idx]?.handle || null,
                            pointsDelta: delta,
                            points: nextPoints,
                        });
                    } else {
                        sendGift(gift.id);
                    }
                    closeActiveGiftMenu();
                    broadcastSeats();
                });
                giftMenu.appendChild(item);
            });
        }

        seatMain.append(avatar, name, actionsWrap);
        seatEl.append(seatMain, giftMenu);

        seatEl.addEventListener("click", async () => {
            const current = seats[idx];
            const input = prompt("Enter TikTok handle (with or without @). Leave blank to clear:", current?.handle || "");
            if (input === null) return;
            const clean = normalizeHandle(input);
            if (!clean) {
                seats[idx] = null;
            } else {
                const profile = await fetchTikTokProfile(clean);
                seats[idx] = profile || {
                    handle: "@" + clean,
                    name: "@" + clean,
                    avatar: "",
                };
                if (seats[idx]) seats[idx].points = 0;
            }
            renderSeatsPreview();
            applyPreviewStyle();
            broadcastSeats();
        });

        action.addEventListener("click", (e) => {
            e.stopPropagation();
            if (seats[idx]) {
                seats[idx] = null;
                renderSeatsPreview();
                applyPreviewStyle();
                broadcastSeats();
            } else {
                const input = prompt("Enter TikTok handle (with or without @).", "");
                if (input === null) return;
                const clean = normalizeHandle(input);
                if (!clean) return;
                fetchTikTokProfile(clean).then((profile) => {
                    seats[idx] = profile || {
                        handle: "@" + clean,
                        name: "@" + clean,
                        avatar: "",
                    };
                    if (seats[idx]) seats[idx].points = 0;
                    renderSeatsPreview();
                    applyPreviewStyle();
                    broadcastSeats();
                });
            }
        });
        previewGrid.appendChild(seatEl);
    });
    applyPreviewStyle();
}

function clamp(val, min, max) {
    const num = Number(val);
    if (Number.isNaN(num)) return min;
    return Math.min(max, Math.max(min, num));
}

function hydrateFromStore() {
    // Try server first, then fall back to localStorage
    loadLayoutFromServer().then(serverStyle => {
        const style = serverStyle || loadStoredStyle();
        if (!style) return;
        hydrateSliders(style);
    });
}

function hydrateSliders(style) {
    if (!style) return;
    const setters = [
        [heightInput, style.slotHeight],
        [widthInput, style.colWidth],
        [gapInput, style.gap],
        [color1, style.bg1],
        [color2, style.bg2],
        [blendInput, style.blend != null ? style.blend * 100 : undefined],
        [plusSizeInput, style.plusSize],
        [labelSizeInput, style.labelSize],
        [requestStyleSelect, style.requestTextStyle],
        [pointsFormatSelect, style.pointsFormat],
        [camWidthInput, style.camWidth],
        [camHeightInput, style.camHeight],
        [camRadiusInput, style.camRadius],
        [camXInput, style.camOffsetX],
        [camYInput, style.camOffsetY],
        [closedCamWidthInput, style.closedCamWidth],
        [closedCamHeightInput, style.closedCamHeight],
        [closedCamXInput, style.closedCamOffsetX],
        [closedCamYInput, style.closedCamOffsetY],
        [roomWidthInput, style.roomWidth],
        [roomHeightInput, style.roomHeight],
        [roomRadiusInput, style.roomRadius],
        [roomXInput, style.roomOffsetX],
        [roomYInput, style.roomOffsetY],
        [animationWidthInput, style.animationWidth],
        [animationHeightInput, style.animationHeight],
        [animationXInput, style.animationOffsetX],
        [animationYInput, style.animationOffsetY],
    ];
    setters.forEach(([el, val]) => {
        if (el && val != null) el.value = val;
    });
    syncLabels();
    renderSeatsPreview();
}

function applyIncomingStyle(style) {
    if (!style || typeof style !== "object") return;
    hydrateSliders(style);
    try { localStorage.setItem(styleStoreKey, JSON.stringify({ ...(loadStoredStyle() || {}), ...style, _v: styleStoreVersion })); } catch (err) { /* ignore */ }
}

function syncFromNumber() {
    heightInput.value = clamp(heightValue.value, Number(heightInput.min), Number(heightInput.max));
    widthInput.value = clamp(widthValue.value, Number(widthInput.min), Number(widthInput.max));
    gapInput.value = clamp(gapValue.value, Number(gapInput.min), Number(gapInput.max));
    blendInput.value = clamp(blendValue.value, Number(blendInput.min), Number(blendInput.max));
    plusSizeInput.value = clamp(plusSizeValue.value, Number(plusSizeInput.min), Number(plusSizeInput.max));
    labelSizeInput.value = clamp(labelSizeValue.value, Number(labelSizeInput.min), Number(labelSizeInput.max));
    camWidthInput.value = clamp(camWidthValue.value, Number(camWidthInput.min), Number(camWidthInput.max));
    camHeightInput.value = clamp(camHeightValue.value, Number(camHeightInput.min), Number(camHeightInput.max));
    camRadiusInput.value = clamp(camRadiusValue.value, Number(camRadiusInput.min), Number(camRadiusInput.max));
    camXInput.value = clamp(camXValue.value, Number(camXInput.min), Number(camXInput.max));
    camYInput.value = clamp(camYValue.value, Number(camYInput.min), Number(camYInput.max));
    closedCamWidthInput.value = clamp(closedCamWidthValue.value, Number(closedCamWidthInput.min), Number(closedCamWidthInput.max));
    closedCamHeightInput.value = clamp(closedCamHeightValue.value, Number(closedCamHeightInput.min), Number(closedCamHeightInput.max));
    closedCamXInput.value = clamp(closedCamXValue.value, Number(closedCamXInput.min), Number(closedCamXInput.max));
    closedCamYInput.value = clamp(closedCamYValue.value, Number(closedCamYInput.min), Number(closedCamYInput.max));
    roomWidthInput.value = clamp(roomWidthValue.value, Number(roomWidthInput.min), Number(roomWidthInput.max));
    roomHeightInput.value = clamp(roomHeightValue.value, Number(roomHeightInput.min), Number(roomHeightInput.max));
    roomRadiusInput.value = clamp(roomRadiusValue.value, Number(roomRadiusInput.min), Number(roomRadiusInput.max));
    roomXInput.value = clamp(roomXValue.value, Number(roomXInput.min), Number(roomXInput.max));
    roomYInput.value = clamp(roomYValue.value, Number(roomYInput.min), Number(roomYInput.max));
    animationWidthInput.value = clamp(animationWidthValue.value, Number(animationWidthInput.min), Number(animationWidthInput.max));
    animationHeightInput.value = clamp(animationHeightValue.value, Number(animationHeightInput.min), Number(animationHeightInput.max));
    animationXInput.value = clamp(animationXValue.value, Number(animationXInput.min), Number(animationXInput.max));
    animationYInput.value = clamp(animationYValue.value, Number(animationYInput.min), Number(animationYInput.max));
    syncLabels();
    broadcastStyle();
    renderSeatsPreview();
}

[heightInput, widthInput, gapInput, blendInput, plusSizeInput, labelSizeInput, camWidthInput, camHeightInput, camRadiusInput, camXInput, camYInput, closedCamWidthInput, closedCamHeightInput, closedCamXInput, closedCamYInput, roomWidthInput, roomHeightInput, roomRadiusInput, roomXInput, roomYInput, animationWidthInput, animationHeightInput, animationXInput, animationYInput, color1, color2].forEach((el) => {
    el.addEventListener("input", () => {
        syncLabels();
        broadcastStyle();
        renderSeatsPreview();
    });
});

if (requestStyleSelect) {
    requestStyleSelect.addEventListener("change", () => {
        broadcastStyle();
        renderSeatsPreview();
    });
}

if (pointsFormatSelect) {
    pointsFormatSelect.addEventListener("change", () => {
        broadcastStyle();
        renderSeatsPreview();
    });
}

[heightValue, widthValue, gapValue, blendValue, plusSizeValue, labelSizeValue, camWidthValue, camHeightValue, camRadiusValue, camXValue, camYValue, closedCamWidthValue, closedCamHeightValue, closedCamXValue, closedCamYValue, roomWidthValue, roomHeightValue, roomRadiusValue, roomXValue, roomYValue, animationWidthValue, animationHeightValue, animationXValue, animationYValue].forEach((el) => {
    el.addEventListener("input", () => {
        syncFromNumber();
    });
});

initChannel();
hydrateFromStore();
syncLabels();
loadSeats();
renderSeatsPreview();
broadcastSeats();
setRoomOpen(roomOpen);
if (channel) {
    channel.addEventListener("message", (event) => handleRemoteMessage(event.data));
} else {
    window.addEventListener("storage", (e) => {
        if (e.key === fallbackKey && e.newValue) {
            try { handleRemoteMessage(JSON.parse(e.newValue)); } catch (err) { /* ignore */ }
        }
        if (e.key === styleStoreKey) {
            hydrateFromStore();
        }
    });
}
window.addEventListener("storage", (e) => {
    if (e.key === styleStoreKey) {
        hydrateFromStore();
        // Do NOT broadcastStyle here — it overwrites mode1's saved layout
    }
});
if (preferredMode === "remote") {
    // already remote
}
