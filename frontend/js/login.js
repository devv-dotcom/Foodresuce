/**
 * login.js — Self-contained, robust auth module for login & register.
 * Provides instant 1-click test credentials and role routing.
 */

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

const TOKEN_KEY = 'foodbridge.token';
const USER_KEY  = 'foodbridge.user';

const saveSession = ({ token, user }) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
};

const getSession = () => {
  try {
    return { token: localStorage.getItem(TOKEN_KEY), user: JSON.parse(localStorage.getItem(USER_KEY) || 'null') };
  } catch { return { token: null, user: null }; }
};

const DASHBOARD_BY_ROLE = {
  admin:        '/admin/dashboard.html',
  ngo:          '/partner/dashboard.html',
  partner:      '/partner/dashboard.html',
  restaurant:   '/business/dashboard.html',
  hotel:        '/business/dashboard.html',
  bakery:       '/business/dashboard.html',
  supermarket:  '/business/dashboard.html',
  catering:     '/business/dashboard.html',
  marriage_hall:'/business/dashboard.html',
};

const dashboardFor = role => {
  const target = DASHBOARD_BY_ROLE[String(role || '').toLowerCase()] || '/index.html';
  if (typeof window !== 'undefined' && window.location.pathname.includes('/frontend/')) {
    return target.startsWith('/frontend/') ? target : '/frontend' + target;
  }
  return target;
};

// Determine the API base URL
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
const API_BASE = (window.FOODBRIDGE_API_BASE || (isLocal && location.port !== '5000'
  ? `${location.protocol}//${location.hostname}:5000`
  : '')).replace(/\/$/, '');

// ── Toast notification ─────────────────────────────────────────────────────
const toast = (msg, type = 'success') => {
  let box = $('#foodbridge-toasts');
  if (!box) {
    box = Object.assign(document.createElement('div'), { id: 'foodbridge-toasts' });
    Object.assign(box.style, {
      position: 'fixed', top: '1.2rem', right: '1.2rem', zIndex: '9999',
      display: 'grid', gap: '.6rem', maxWidth: 'min(24rem,calc(100vw - 2rem))'
    });
    document.body.append(box);
  }
  const el = document.createElement('div');
  el.textContent = msg;
  Object.assign(el.style, {
    background: type === 'error' ? '#9f1239' : type === 'warning' ? '#a16207' : '#166534',
    color: '#fff', padding: '.9rem 1.1rem', borderRadius: '.85rem',
    boxShadow: '0 12px 30px rgba(0,0,0,.22)', font: '700 14px system-ui',
    animation: 'authEntrance 0.3s ease'
  });
  box.append(el);
  setTimeout(() => el.remove(), 5000);
};

// ── setLoading helper ─────────────────────────────────────────────────────
const setLoading = (btn, loading, label = 'Please wait…') => {
  if (!btn) return;
  if (loading) {
    btn.dataset.orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.orig || btn.textContent;
  }
};

// ── API helper ────────────────────────────────────────────────────────────
const apiPost = async (path, body, { auth = false } = {}) => {
  if (location.protocol === 'file:') {
    throw new Error('Please open through http://localhost:5000/login.html before signing in.');
  }
  const { token } = getSession();
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.message || `Request failed (${res.status}).`);
  return data;
};

// ── Check if already logged in (optional friendly hint, no forced redirect) ──
const params = new URLSearchParams(location.search);
const { token, user } = getSession();
if (token && user?.role && params.has('autoredirect')) {
  const dest = dashboardFor(user.role);
  if (!location.pathname.endsWith(dest.split('/').pop())) {
    location.replace(dest);
  }
}

function selectRole(roleName) {
  const roleInput = $('#login-role');
  if (roleInput) roleInput.value = roleName;
  $$('.auth-role-pill').forEach(pill => {
    const isTarget = pill.dataset.role === roleName;
    pill.classList.toggle('active', isTarget);
    pill.setAttribute('aria-selected', String(isTarget));
  });
}

// Pre-select role if specified in query string
if (params.get('role')) {
  selectRole(params.get('role'));
}

// Role pills click listeners
$$('.auth-role-pill').forEach(pill => {
  pill.addEventListener('click', () => selectRole(pill.dataset.role));
});

let pendingEmail = '';

// ── Step 1: Email + Password Submission ───────────────────────────────────
const loginForm = $('[data-api-form="login"]');
if (loginForm) {
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const data   = Object.fromEntries(new FormData(loginForm));
    const submit = loginForm.querySelector('[type="submit"]');
    try {
      setLoading(submit, true, 'Verifying credentials…');
      const endpoint = '/api/auth/login';
      const res = await apiPost(endpoint, { email: data.email, password: data.password, role: data.role });

      if (res.requiresOtp) {
        // Show OTP step
        pendingEmail = res.email || data.email;
        const emailField = $('#otp-email-field');
        const hint       = $('#otp-hint');
        const otpInput   = $('#otp-input');

        if (emailField) emailField.value = pendingEmail;
        if (hint) hint.textContent = `A 6-digit sign-in code was sent to ${pendingEmail}.`;

        $('#step-credentials')?.setAttribute('hidden', '');
        const stepOtp = $('#step-otp');
        if (stepOtp) { stepOtp.removeAttribute('hidden'); otpInput?.focus(); }
        toast(res.message || 'Check your email for your sign-in code.');
      } else {
        // Handle a completed authentication response.
        saveSession(res);
        toast(`Welcome back, ${res.user.name || 'User'}! Redirecting…`);
        setTimeout(() => location.assign(dashboardFor(res.user.role)), 500);
      }
    } catch (err) {
      toast(err.message || 'Login failed. Please check your credentials.', 'error');
    } finally {
      setLoading(submit, false);
    }
  });
}

// ── Step 2: OTP verification ───────────────────────────────────────────────
const otpForm = $('[data-api-form="verify-login-otp"]');
if (otpForm) {
  otpForm.addEventListener('submit', async e => {
    e.preventDefault();
    const data   = Object.fromEntries(new FormData(otpForm));
    const submit = otpForm.querySelector('[type="submit"]');
    try {
      setLoading(submit, true, 'Verifying code…');
      const res = await apiPost('/api/auth/verify-login-otp', {
        email: data.email || pendingEmail,
        otp: data.otp
      });
      saveSession(res);
      toast('Verification successful! Opening your workspace…');
      setTimeout(() => location.assign(dashboardFor(res.user.role)), 500);
    } catch (err) {
      toast(err.message || 'Invalid or expired sign-in code.', 'error');
    } finally {
      setLoading(submit, false);
    }
  });
}

// ── Resend OTP ─────────────────────────────────────────────────────────────
$('#resend-otp-link')?.addEventListener('click', async e => {
  e.preventDefault();
  const email = $('#otp-email-field')?.value || pendingEmail;
  if (!email) return;
  try {
    const res = await apiPost('/api/auth/resend-login-otp', { email });
    toast('A new sign-in code has been sent.');
  } catch (err) {
    toast(err.message || 'Could not resend code.', 'error');
  }
});

// ── Back to credentials ────────────────────────────────────────────────────
$('#back-to-login')?.addEventListener('click', e => {
  e.preventDefault();
  $('#step-otp')?.setAttribute('hidden', '');
  $('#step-credentials')?.removeAttribute('hidden');
});

// ── Register form ──────────────────────────────────────────────────────────
const registerForm = $('[data-api-form="register"]');
if (registerForm) {
  registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    const data   = Object.fromEntries(new FormData(registerForm));
    const submit = registerForm.querySelector('[type="submit"]');
    if (data.password !== data.confirmPassword) return toast('Passwords do not match.', 'error');
    try {
      setLoading(submit, true, 'Creating account…');
      const role     = data.role || 'restaurant';
      const endpoint = role === 'ngo' ? '/api/ngo/register' : '/api/auth/register';
      const res = await apiPost(endpoint, data);
      saveSession(res);
      toast('Account created! Opening your dashboard…');
      setTimeout(() => location.assign(dashboardFor(res.user.role)), 600);
    } catch (err) {
      toast(err.message || 'Registration failed. Please check your details.', 'error');
    } finally {
      setLoading(submit, false);
    }
  });
}
