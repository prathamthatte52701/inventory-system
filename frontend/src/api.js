import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', withCredentials: true }) // session = httpOnly cookie;

export const MAX_NUM = 1e9; // same limit the API enforces for quantities and rates
export const LOGOUT_EVENT = 'auth:logout';

export const clearSession = () => {
  window.dispatchEvent(new Event(LOGOUT_EVENT)); // AuthProvider drops the user, ProtectedRoute redirects to /login
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

// Today in the user's local calendar as YYYY-MM-DD (toISOString would be the UTC date, off by a day near midnight).
export const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Fetch a report as a blob and hand it to the browser as a file download.
export async function downloadFile(path, params) {
  const res = await api.get(path, { params, responseType: 'blob' });
  const name = /filename="?([^";]+)"?/.exec(res.headers['content-disposition'] || '')?.[1] || 'report';
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { name, size: res.data.size };
}

export default api;
