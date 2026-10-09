import { toast } from './utils.js';

const isLocalBrowser = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
const localApiBase = isLocalBrowser && window.location.port !== '5000'
  ? `${window.location.protocol}//${window.location.hostname}:5000`
  : '';

// Production uses a configured API host or same-origin API routes. Static
// local development servers (including XAMPP and Live Server) use the local
// Express API so their POST requests do not land on the static server.
export const API_BASE = (
  window.FOODBRIDGE_API_BASE ||
  document.documentElement.dataset.apiBase ||
  localApiBase
).replace(/\/$/, '');
export const TOKEN_KEY = 'foodbridge.token';
export const USER_KEY = 'foodbridge.user';

export class ApiError extends Error {
  constructor(message, status, payload = {}) { super(message); this.name = 'ApiError'; this.status = status; this.payload = payload; }
}

export const getSession = () => {
  try { return { token: localStorage.getItem(TOKEN_KEY), user: JSON.parse(localStorage.getItem(USER_KEY) || 'null') }; } catch { return { token: null, user: null }; }
};
export const saveSession = ({ token, user }) => { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); };
export const clearSession = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); };

const parseResponse = async response => {
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json() : { message: await response.text() };
  if (!response.ok || payload.success === false) throw new ApiError(payload.message || `Request failed (${response.status}).`, response.status, payload);
  return payload;
};

export const request = async (path, { method = 'GET', body, auth = true, headers = {}, signal, timeoutMs = 15000 } = {}) => {
  // API routes are provided by Express. When an HTML file is opened directly
  // from disk, an absolute route resolves as file:///api/... and produces a
  // misleading 404 instead of reaching the application server.
  if (window.location.protocol === 'file:') {
    throw new ApiError('Open Food Rescue through its web server (for example, http://localhost:5000/login.html) before signing in.', 0);
  }
  const { token } = getSession();
  const isForm = body instanceof FormData;
  const controller = signal ? null : new AbortController();
  const timeout = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method, signal: signal || controller.signal, headers: { Accept: 'application/json', ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(auth && token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined
    });
    return await parseResponse(response);
  } catch (error) {
    if (error.status === 401 && document.body.dataset.requiredRole) {
      clearSession();
      window.dispatchEvent(new CustomEvent('foodbridge:unauthorized'));
    }
    if (error.name === 'AbortError') throw new ApiError('The request timed out. Please try again.', 0);
    throw error;
  } finally {
    if (timeout) window.clearTimeout(timeout);
  }
};

export const notifyError = error => {
  const messages = { 400: 'Please check the information you entered.', 401: 'Your session has expired. Please sign in again.', 403: 'You do not have permission for this action.', 404: 'The requested item was not found.', 500: 'The server had a problem. Please try again shortly.', 502: 'The upload server is temporarily unavailable. Please try again shortly.' };
  const validationErrors = error?.payload?.errors;
  if (validationErrors?.length) {
    const firstError = validationErrors[0];
    const form = document.querySelector('[data-api-form="donation"]');
    const field = form?.elements.namedItem(firstError.field);
    const fieldLabel = field?.closest('.donor-field-group')?.querySelector('.donor-label')?.textContent.replace('*', '').trim();
    field?.setAttribute('aria-invalid', 'true');
    field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    field?.focus({ preventScroll: true });
    const moreErrors = validationErrors.length > 1 ? ` (+${validationErrors.length - 1} more field${validationErrors.length > 2 ? 's' : ''})` : '';
    return toast(`${fieldLabel || firstError.field}: ${firstError.message}${moreErrors}`, 'error');
  }
  if (!error?.status && (error instanceof TypeError || /fetch|network/i.test(error?.message || ''))) return toast('Cannot reach the Food Rescue API. Start the backend and MySQL, then try again.', 'error');
  if (error?.status === 502) return toast(messages[502], 'error');
  toast(error?.message || messages[error?.status] || 'Something went wrong. Please try again.', 'error');
};

export const login = (credentials, endpoint = '/api/auth/login') => request(endpoint, { method: 'POST', body: credentials, auth: false });
export const register = (details, endpoint = '/api/auth/register') => request(endpoint, { method: 'POST', body: details, auth: false });
export const fetchProfile = endpoint => request(endpoint);
export const getDonations = () => request('/api/business/donations');
export const createDonation = data => request('/api/donations', { method: 'POST', body: data });
export const acceptDonation = id => request(`/api/ngo/accept/${id}`, { method: 'POST' });
export const acceptPickup = id => request(`/api/pickups/accept/${id}`, { method: 'POST' });
export const uploadImage = (path, data) => request(path, { method: 'POST', body: data });
