import { createContext, useContext, useEffect, useState } from 'react';
import api, { LOGOUT_EVENT } from './api';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

// Session lives in an httpOnly cookie JS cannot read; GET /auth/me on load tells us whether it is valid.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get('/auth/me')
      .then(({ data }) => { if (alive) setUser(publicUser(data)); })
      .catch(() => { if (alive) setUser(null); })
      .finally(() => { if (alive) setReady(true); });
    const onLogout = () => setUser(null);
    window.addEventListener(LOGOUT_EVENT, onLogout);
    return () => { alive = false; window.removeEventListener(LOGOUT_EVENT, onLogout); };
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setUser(data.user);
    setReady(true);
    return data.user;
  };
  const logout = async () => {
    try { await api.post('/auth/logout'); } catch { /* cookie clear is best-effort client side; server clears it on success */ }
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, ready, login, logout, isAdmin: user?.role === 'admin' }}>{children}</AuthContext.Provider>;
}
