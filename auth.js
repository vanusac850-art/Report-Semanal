'use strict';

// ── Auth config ────────────────────────────────────────────────────────────
const AUTH_URL = 'https://rmucbgujvmmtmftxtgxk.supabase.co';
const AUTH_KEY = 'sb_publishable_c1jV7_vPvYm_UDoWzVsc7w_jbbbl0uW';

// ── Session ────────────────────────────────────────────────────────────────
let currentUser = null;
let currentRole = null; // 'gestor' or 'colaborador'
let refreshTimer = null;

function getSession() {
  try {
    const s = localStorage.getItem('reports_session');
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
function saveSession(session, role) {
  localStorage.setItem('reports_session', JSON.stringify({ ...session, role, savedAt: Date.now() }));
}
function clearSession() {
  localStorage.removeItem('reports_session');
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
}

// ── Token refresh ────────────────────────────────────────────────────────────
// Supabase access tokens expire (default 1h). We use the refresh_token to get
// a new one automatically before it expires, so the user is never kicked out
// mid-session with a "JWT expired" error.
async function refreshAccessToken() {
  const session = getSession();
  if (!session?.refresh_token) return false;

  try {
    const res = await fetch(`${AUTH_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': AUTH_KEY },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    if (!res.ok) return false;
    const data = await res.json();
    saveSession(data, currentRole || session.role);
    scheduleTokenRefresh(data.expires_in);
    return true;
  } catch {
    return false;
  }
}

function scheduleTokenRefresh(expiresInSeconds) {
  if (refreshTimer) clearTimeout(refreshTimer);
  // Refresh 2 minutes before expiry (or halfway through if very short-lived)
  const ms = Math.max((expiresInSeconds - 120) * 1000, (expiresInSeconds * 1000) / 2);
  refreshTimer = setTimeout(() => { refreshAccessToken(); }, ms);
}

// ── Login ──────────────────────────────────────────────────────────────────
async function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  if (!email || !password) { errEl.textContent = 'Preencha e-mail e senha.'; return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i> Entrando...';
  errEl.textContent = '';

  try {
    const res = await fetch(`${AUTH_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': AUTH_KEY },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || 'Credenciais inválidas.');

    // Get role from user_roles table
    const roleRes = await fetch(`${AUTH_URL}/rest/v1/user_roles?user_id=eq.${data.user.id}&select=role`, {
      headers: { 'apikey': AUTH_KEY, 'Authorization': `Bearer ${data.access_token}` }
    });
    const roleData = roleRes.ok ? await roleRes.json() : [];
    const role = roleData?.[0]?.role || 'colaborador';

    currentUser = data.user;
    currentRole = role;
    saveSession(data, role);
    scheduleTokenRefresh(data.expires_in || 3600);
    showApp();
  } catch(e) {
    errEl.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-login"></i> Entrar';
  }
}

// ── Logout ─────────────────────────────────────────────────────────────────
async function logout() {
  const session = getSession();
  if (session?.access_token) {
    await fetch(`${AUTH_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { 'apikey': AUTH_KEY, 'Authorization': `Bearer ${session.access_token}` }
    }).catch(() => {});
  }
  clearSession();
  currentUser = null;
  currentRole = null;
  showLogin();
}

// ── Access token for API calls ─────────────────────────────────────────────
function getAccessToken() {
  return getSession()?.access_token || AUTH_KEY;
}

// Wraps any Supabase call: if it fails with an expired/invalid JWT, refresh
// the token once and retry automatically before giving up.
async function withAuthRetry(fn) {
  const res = await fn();
  if (res.status === 401 || res.status === 403) {
    const text = await res.clone().text().catch(() => '');
    if (text.includes('JWT') || text.includes('expired') || text.includes('invalid')) {
      const refreshed = await refreshAccessToken();
      if (refreshed) return await fn();
    }
  }
  return res;
}

// ── Show/hide ──────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  const isGestor = currentRole === 'gestor';
  document.querySelectorAll('.nav-gestors-only').forEach(el => {
    el.style.display = isGestor ? 'flex' : 'none';
  });

  document.getElementById('userEmail').textContent = currentUser?.email || '';
  document.getElementById('userRole').textContent = isGestor ? 'Gestor' : 'Colaborador';

  if (isGestor) {
    navigate('dashboard');
  } else {
    navigate('upload');
  }
}

// ── Init ───────────────────────────────────────────────────────────────────
async function initAuth() {
  const session = getSession();
  if (session?.access_token && session?.user) {
    currentUser = session.user;
    currentRole = session.role || 'colaborador';

    // Check if the token is already stale based on saved time + expires_in
    const ageSeconds = (Date.now() - (session.savedAt || 0)) / 1000;
    const expiresIn = session.expires_in || 3600;

    if (ageSeconds >= expiresIn - 60) {
      // Likely expired or about to — refresh before showing the app
      const ok = await refreshAccessToken();
      if (!ok) { showLogin(); return; }
    } else {
      scheduleTokenRefresh(expiresIn - ageSeconds);
    }
    showApp();
  } else {
    showLogin();
  }
}

// Enter key on login form
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('loginScreen').style.display !== 'none') {
    login();
  }
});
