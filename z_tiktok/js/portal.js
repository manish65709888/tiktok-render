/* ================================================================
   Portal – full auth + admin wiring for the FastAPI backend
   ================================================================ */

// ── DOM refs ─────────────────────────────────────────────────────
const loginScreen = document.getElementById('loginScreen');
const appShell = document.getElementById('appShell');
const adminPanel = document.getElementById('adminPanel');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const loginAttempts = document.getElementById('loginAttempts');
const attemptValue = document.getElementById('attemptValue');
const sessionUsername = document.getElementById('sessionUsername');
const timeLeftBadge = document.getElementById('timeLeftBadge');
const hostBtn = document.getElementById('openHost');
const remoteBtn = document.getElementById('openRemote');
const logoutBtn = document.getElementById('logoutBtn');
const displayNameInput = document.getElementById('displayNameInput');
const saveDisplayName = document.getElementById('saveDisplayName');

let currentUser = null;   // { username, role, expiresAt }
let loginAttemptCount = 0;
let timeLeftInterval = null;

// ── Display-name helpers (localStorage, shared with mode1/mode2) ─
function dnKey(u) { return `tiktok-display-name:${u}`; }
function getStoredDisplayName(u) {
    try { return localStorage.getItem(dnKey(u)) || 'Host'; } catch { return 'Host'; }
}
function saveStoredDisplayName(u, v) {
    try { localStorage.setItem(dnKey(u), v); } catch { }
}

// ── View toggling ────────────────────────────────────────────────
function showLogin() {
    loginScreen.classList.remove('k');
    appShell.classList.add('k');
    adminPanel.classList.remove('active');
    if (timeLeftInterval) { clearInterval(timeLeftInterval); timeLeftInterval = null; }
}
function showApp(user) {
    currentUser = user;
    loginScreen.classList.add('k');
    appShell.classList.remove('k');
    sessionUsername.textContent = user.username;
    displayNameInput.value = getStoredDisplayName(user.username);
    startTimeLeft(user.expiresAt);
    // Show admin button only for admins (append to actions if not there)
    let adminBtn = document.getElementById('openAdminBtn');
    if (user.role === 'admin') {
        if (!adminBtn) {
            adminBtn = document.createElement('button');
            adminBtn.id = 'openAdminBtn';
            adminBtn.className = 'pill-button secondary';
            adminBtn.textContent = 'Admin Panel';
            adminBtn.addEventListener('click', openAdmin);
            document.querySelector('.app-actions').appendChild(adminBtn);
        }
    } else if (adminBtn) {
        adminBtn.remove();
    }
}

// ── Time-left countdown ──────────────────────────────────────────
function startTimeLeft(expiresAt) {
    const badge = timeLeftBadge;
    if (!badge) return;
    badge.classList.remove('k');
    function tick() {
        const diff = new Date(expiresAt) - Date.now();
        if (diff <= 0) { badge.textContent = 'Access expired'; return; }
        const d = Math.floor(diff / 86400000);
        const h = Math.floor((diff % 86400000) / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        let txt = '';
        if (d > 0) txt += d + 'd ';
        if (h > 0 || d > 0) txt += h + 'h ';
        txt += m + 'm ' + s + 's remaining';
        badge.textContent = txt;
    }
    tick();
    if (timeLeftInterval) clearInterval(timeLeftInterval);
    timeLeftInterval = setInterval(tick, 1000);
}

// ── Auth: check status on load ───────────────────────────────────
async function checkAuth() {
    try {
        const res = await fetch('/api/auth/status', { credentials: 'include' });
        const data = await res.json();
        if (res.ok && data.authenticated && data.user) {
            showApp(data.user);
        } else {
            showLogin();
        }
    } catch {
        showLogin();
    }
}
checkAuth();

// ── Auth: login form ─────────────────────────────────────────────
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    loginError.classList.add('k');
    loginError.textContent = '';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
            loginAttemptCount = 0;
            showApp(data.user);
        } else {
            loginAttemptCount++;
            loginError.textContent = data.detail || 'Invalid credentials';
            loginError.classList.remove('k');
            attemptValue.textContent = loginAttemptCount;
            loginAttempts.classList.remove('k');
        }
    } catch (err) {
        loginError.textContent = 'Network error – is the server running?';
        loginError.classList.remove('k');
    }
});

// ── Auth: logout ─────────────────────────────────────────────────
logoutBtn.addEventListener('click', async () => {
    try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch { }
    showLogin();
});

// ── Mode buttons ─────────────────────────────────────────────────
if (hostBtn) hostBtn.addEventListener('click', () => window.open('mode1.html?mode=host', '_blank'));
if (remoteBtn) remoteBtn.addEventListener('click', () => window.open('mode2.html?mode=remote', '_blank'));

// ── Display name ─────────────────────────────────────────────────
if (saveDisplayName) {
    saveDisplayName.addEventListener('click', () => {
        if (!currentUser) return;
        saveStoredDisplayName(currentUser.username, displayNameInput.value.trim() || 'Host');
    });
}

// ── Admin panel (lazy-loaded) ────────────────────────────────────
let adminPanelLoaded = false;
// Admin DOM refs (populated after admin HTML loads)
let refreshCustomersBtn, closeAdminBtn, createUserForm, deleteExpiredBtn,
    adminSearchInput, usersList, adminEmptyState,
    totalUsersStat, activeUsersStat, waitingUsersStat, expiringUsersStat;

async function openAdmin() {
    if (!adminPanelLoaded) {
        try {
            const res = await fetch('admin-panel.html');
            if (!res.ok) throw new Error('Failed to load admin panel');
            const html = await res.text();
            adminPanel.innerHTML = html;
            adminPanelLoaded = true;
            bindAdminEvents();
        } catch (err) {
            console.error('Admin panel load failed:', err);
            return;
        }
    }
    adminPanel.classList.add('active');
    loadUsers();
}

function bindAdminEvents() {
    refreshCustomersBtn = document.getElementById('refreshCustomersBtn');
    closeAdminBtn = document.getElementById('closeAdminBtn');
    createUserForm = document.getElementById('createUserForm');
    deleteExpiredBtn = document.getElementById('deleteExpiredBtn');
    adminSearchInput = document.getElementById('adminSearchInput');
    usersList = document.getElementById('usersList');
    adminEmptyState = document.getElementById('adminEmptyState');
    totalUsersStat = document.getElementById('totalUsersStat');
    activeUsersStat = document.getElementById('activeUsersStat');
    waitingUsersStat = document.getElementById('waitingUsersStat');
    expiringUsersStat = document.getElementById('expiringUsersStat');

    if (closeAdminBtn) closeAdminBtn.addEventListener('click', () => adminPanel.classList.remove('active'));
    if (refreshCustomersBtn) refreshCustomersBtn.addEventListener('click', loadUsers);

    // Create user
    if (createUserForm) {
        createUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('newUsername').value.trim();
            const password = document.getElementById('newPassword').value;
            const durationMinutes = parseInt(document.getElementById('userDuration').value, 10);
            try {
                const res = await fetch('/api/admin/users', {
                    method: 'POST',
                    headers: secureHeaders(),
                    credentials: 'include',
                    body: JSON.stringify({ username, password, durationMinutes }),
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    createUserForm.reset();
                    loadUsers();
                } else {
                    alert(data.detail || 'Failed to create user');
                }
            } catch (err) {
                alert('Network error');
            }
        });
    }

    // Delete expired
    if (deleteExpiredBtn) {
        deleteExpiredBtn.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/admin/users/expired', {
                    method: 'DELETE',
                    headers: { 'X-CSRF-Token': getCsrfToken() },
                    credentials: 'include',
                });
                const data = await res.json();
                if (res.ok) {
                    alert(`Deleted ${data.deleted} expired user(s)`);
                    loadUsers();
                }
            } catch { alert('Network error'); }
        });
    }

    // Search filter
    let searchDebounce = null;
    if (adminSearchInput) {
        adminSearchInput.addEventListener('input', () => {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => loadUsers(adminSearchInput.value.trim()), 300);
        });
    }

    // Admin password toggle
    adminPanel.querySelectorAll('.password-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            const input = document.getElementById(targetId);
            if (!input) return;
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            const icon = btn.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-eye', !isPassword);
                icon.classList.toggle('fa-eye-slash', isPassword);
            }
        });
    });
}

// Load / render user list
async function loadUsers(search) {
    if (!usersList) return;
    try {
        let url = '/api/admin/users';
        if (search) url += '?search=' + encodeURIComponent(search);
        const res = await fetch(url, { credentials: 'include' });
        const data = await res.json();
        if (!res.ok) return;

        // Stats
        const s = data.stats || {};
        if (totalUsersStat) totalUsersStat.textContent = s.total ?? 0;
        if (activeUsersStat) activeUsersStat.textContent = s.active ?? 0;
        if (waitingUsersStat) waitingUsersStat.textContent = s.expired ?? 0;
        if (expiringUsersStat) expiringUsersStat.textContent = s.expiringSoon ?? 0;

        // Render list
        const users = data.users || [];
        if (users.length === 0) {
            usersList.innerHTML = '';
            if (adminEmptyState) {
                adminEmptyState.style.display = '';
                const p = adminEmptyState.querySelector('p');
                if (p) p.textContent = search
                    ? 'No users match "' + search + '"'
                    : adminEmptyState.dataset.defaultText || 'No customers yet.';
            }
            return;
        }
        if (adminEmptyState) adminEmptyState.style.display = 'none';
        usersList.innerHTML = users.map(u => {
            const exp = new Date(u.expiresAt);
            const isExp = exp < Date.now();
            const timeStr = isExp ? 'Expired' : relTime(exp - Date.now());
            const safeId = esc(u.id);
            const safeName = esc(u.username);
            return `
            <div class="user-row">
                <div>
                    <strong>${safeName}</strong>
                    <div class="user-meta">
                        Created ${new Date(u.createdAt).toLocaleDateString()}
                        · ${isExp ? '<span style="color:var(--danger)">Expired</span>' : timeStr + ' left'}
                    </div>
                </div>
                <div class="user-actions">
                    <button onclick="extendUser('${safeId}')">+1h</button>
                    <button onclick="resetPw('${safeId}','${safeName}')">Reset PW</button>
                    <button class="delete-user" onclick="deleteUser('${safeId}','${safeName}')">Delete</button>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        console.error('loadUsers', err);
    }
}

function relTime(ms) {
    if (ms <= 0) return 'Expired';
    const m = Math.floor(ms / 60000);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ' + (m % 60) + 'm';
    const d = Math.floor(h / 24);
    return d + 'd ' + (h % 24) + 'h';
}

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ── CSRF token helper ────────────────────────────────────────────
function getCsrfToken() {
    const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : '';
}

function secureHeaders(extra) {
    return Object.assign({
        'Content-Type': 'application/json',
        'X-CSRF-Token': getCsrfToken(),
    }, extra || {});
}

// Admin actions
async function extendUser(id) {
    try {
        await fetch('/api/admin/users/' + id, {
            method: 'PUT',
            headers: secureHeaders(),
            credentials: 'include',
            body: JSON.stringify({ extendMinutes: 60 }),
        });
        loadUsers();
    } catch { }
}

async function resetPw(id, username) {
    const pw = prompt('New password for ' + username + ':');
    if (!pw) return;
    try {
        await fetch('/api/admin/users/' + id, {
            method: 'PUT',
            headers: secureHeaders(),
            credentials: 'include',
            body: JSON.stringify({ password: pw }),
        });
        alert('Password updated');
    } catch { alert('Failed'); }
}

async function deleteUser(id, username) {
    if (!confirm('Delete user "' + username + '"?')) return;
    try {
        await fetch('/api/admin/users/' + id, {
            method: 'DELETE',
            headers: { 'X-CSRF-Token': getCsrfToken() },
            credentials: 'include',
        });
        loadUsers();
    } catch { }
}

/* ---- Lion upgrade: listen for download progress from mode1 ---- */
const isIPhone = /iPhone|iPod/.test(navigator.userAgent);
const lionDlCh = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lion-upgrade-dl') : null;

function showLionDlProgress(pct) {
    const bar = document.getElementById('lionDlBar');
    const label = document.getElementById('lionDlLabel');
    const pctEl = document.getElementById('lionDlPct');
    const fill = document.getElementById('lionDlFill');
    const done = document.getElementById('lionDlDone');
    if (!bar) return;
    bar.classList.add('active');
    if (pct >= 100) {
        if (label) label.style.display = 'none';
        if (done) done.style.display = 'block';
        if (fill) fill.style.width = '100%';
    } else {
        if (label) label.style.display = '';
        if (done) done.style.display = 'none';
        if (pctEl) pctEl.textContent = pct;
        if (fill) fill.style.width = pct + '%';
    }
}

if (!isIPhone && lionDlCh) {
    lionDlCh.onmessage = (e) => {
        const msg = e.data;
        if (msg && msg.type === 'lion-dl') {
            if (msg.status === 'done') showLionDlProgress(100);
            else if (msg.status === 'progress') showLionDlProgress(msg.pct || 0);
            else if (msg.status === 'error') {
                const bar = document.getElementById('lionDlBar');
                if (bar) bar.classList.remove('active');
            }
        }
    };
    (async () => {
        try {
            const req = indexedDB.open('lionUpgradeCache', 1);
            req.onupgradeneeded = () => { req.result.createObjectStore('blobs'); };
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction('blobs', 'readonly');
                const r = tx.objectStore('blobs').get('lionupgrade_webm_v5');
                r.onsuccess = () => { if (r.result) showLionDlProgress(100); };
            };
        } catch (e) { }
    })();
}

// ── Password visibility toggle (login form) ─────────────────────
document.querySelectorAll('#loginScreen .password-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (!input) return;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        const icon = btn.querySelector('i');
        if (icon) {
            icon.classList.toggle('fa-eye', !isPassword);
            icon.classList.toggle('fa-eye-slash', isPassword);
        }
    });
});
