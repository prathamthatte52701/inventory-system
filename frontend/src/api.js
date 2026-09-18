import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// A 401 while holding a session = expired/revoked token. (Wrong password on /login has no session, so it just errors.)
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && localStorage.getItem('token')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') window.location.assign('/login');
    }
    return Promise.reject(err);
  }
);

export const errMsg = (e) =>
  e.response?.data?.errors?.map((x) => x.message).join(', ') || e.response?.data?.message || e.message || 'Something went wrong';

export const fmt = (n) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

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
