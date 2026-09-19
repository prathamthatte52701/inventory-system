import axios from 'axios';

// The session is an httpOnly cookie the browser sends by itself; nothing is stored in localStorage.
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', withCredentials: true });

export const MAX_NUM = 1e9; // same limit the API enforces for quantities and rates
export const LOGOUT_EVENT = 'auth:logout';

export const clearSession = () => {
  window.dispatchEvent(new Event(LOGOUT_EVENT)); // AuthProvider drops the user, RequireAdmin redirects to /login
};

// A 401 while holding a session = expired/invalid token; 403 "Account not approved" = revoked after login.
// (Wrong password on /login has no session, so it just errors.)
api.interceptors.response.use(
  (r) => r,
  (err) => {
    const s = err.response?.status;
    const revoked = s === 403 && err.response?.data?.message === 'Account not approved';
    if ((s === 401 || revoked) && !/\/auth\/(login|me|logout)$/.test(err.config?.url || '')) clearSession();
    return Promise.reject(err);
  }
);

export const errMsg = (e) =>
  e.response?.data?.errors?.map((x) => x.message).join(', ') || e.response?.data?.message || e.message || 'Something went wrong';

export const fmt = (n) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// Client-side twin of the API's numeric rule: a finite number in [min, MAX_NUM]. Returns the number or NaN.
export function parseNum(v, min = 0) {
  if (typeof v !== 'string' || v.trim() === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= MAX_NUM ? n : NaN;
}

export default api;
