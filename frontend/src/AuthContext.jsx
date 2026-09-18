import { createContext, useContext, useEffect, useState } from 'react';
import api, { LOGOUT_EVENT } from './api';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

// The stored user is never trusted: with a token present the session is verified against GET /auth/me
// before anything renders, so an expired/garbage token or an edited role in localStorage cannot show protected UI.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(() => !localStorage.getItem('token'));

  useEffect(() => {
    let alive = true;
    if (localStorage.getItem('token')) {
      api.get('/auth/me')
        .then(({ data }) => { if (alive) { const u = publicUser(data); localStorage.setItem('user', JSON.stringify(u)); setUser(u); } })
        .catch(() => { if (alive) { localStorage.removeItem('token'); localStorage.removeItem('user'); setUser(null); } })
        .finally(() => { if (alive) setReady(true); });
    }
    const onLogout = () => setUser(null);
    window.addEventListener(LOGOUT_EVENT, onLogout);
    return () => { alive = false; window.removeEventListener(LOGOUT_EVENT, onLogout); };
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    setReady(true);
    return data.user;
  };
  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, ready, login, logout, isAdmin: user?.role === 'admin' }}>{children}</AuthContext.Provider>;
}
