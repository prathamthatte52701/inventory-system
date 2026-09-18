import { createContext, useContext, useState } from 'react';
import api from './api';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const stored = () => {
  try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => (localStorage.getItem('token') ? stored() : null));

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };
  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, login, logout, isAdmin: user?.role === 'admin' }}>{children}</AuthContext.Provider>;
}
