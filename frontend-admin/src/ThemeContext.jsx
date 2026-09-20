import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// Dark by default; the choice is saved in localStorage and applied as <html data-theme="...">.
// (index.html applies the saved value before first paint, so there is no flash of the wrong theme.)
const KEY = 'theme';
const readSaved = () => {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'dark'; } catch { return 'dark'; }
};

// without a provider (e.g. an isolated component test) the hook still works, it just does not persist anything
const ThemeContext = createContext({ theme: 'dark', setTheme: () => {}, toggleTheme: () => {} });
export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readSaved);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]); // on mount and on every change

  const setTheme = useCallback((t) => {
    const next = t === 'light' ? 'light' : 'dark';
    setThemeState(next);
    try { localStorage.setItem(KEY, next); } catch { /* private mode: still works for this session */ }
  }, []);
  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme]);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
