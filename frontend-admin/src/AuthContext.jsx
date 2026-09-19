import { createContext, useContext, useEffect, useState } from 'react';
import api, { LOGOUT_EVENT } from './api';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export const NOT_ADMIN_MSG = 'This app is for admins only';
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

// Only an admin is ever put in `user`. A signed-in non-admin never reaches state, so no admin page can render for them,
// not even for one tick. (The session cookie is per host, not per port, so a user already signed in to the normal app
// arrives here with a cookie; if that is not an admin they are simply treated as signed out, and their normal-app
// session is left alone.)
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [denied, setDenied] = useState(false); // a valid session exists but it is not an admin's

  useEffect(() => {
    let alive = true;
    api.get('/auth/me')
      .then(({ data }) => {
        if (!alive) return;
        if (data.role === 'admin') setUser(publicUser(data)); else setDenied(true);
      })
      .catch(() => { if (alive) setUser(null); })
      .finally(() => { if (alive) setReady(true); });
    const onLogout = () => setUser(null);
    window.addEventListener(LOGOUT_EVENT, onLogout);
    return () => { alive = false; window.removeEventListener(LOGOUT_EVENT, onLogout); };
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    if (data.user.role !== 'admin') {
      // the server already set the cookie for this login: end that session right now and never expose the user
      try { await api.post('/auth/logout'); } catch { /* the server clears the cookie on success; nothing more to do here */ }
      throw new Error(NOT_ADMIN_MSG);
    }
    setDenied(false);
    setUser(data.user);
    setReady(true);
    return data.user;
  };
  const logout = async () => {
    try { await api.post('/auth/logout'); } catch { /* server clears the cookie on success */ }
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, ready, denied, login, logout }}>{children}</AuthContext.Provider>;
}
