import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { LOGOUT_EVENT } from './api';

// Holds the Import page's in-progress work — the selected file, the preview plan, any inline rate fixes, the
// commit result — outside the page component. This is a client-side router (BrowserRouter): navigating to
// another page never reloads the browser, it only unmounts <Import/>, so the File object and everything else
// here are still alive in memory the whole time. The page itself keeps only useState, so unmounting threw all
// of this away; lifting it here (same pattern as ThemeContext/AuthContext) is what makes it survive.
const ImportContext = createContext(null);
export const useImportState = () => useContext(ImportContext);

const empty = { file: null, plan: null, result: null, error: '', rateText: {} };

export function ImportProvider({ children }) {
  const [state, setState] = useState(empty);

  useEffect(() => {
    const onLogout = () => setState(empty); // never leak one user's in-progress import into the next session
    window.addEventListener(LOGOUT_EVENT, onLogout);
    return () => window.removeEventListener(LOGOUT_EVENT, onLogout);
  }, []);

  // partial update, object or (prevState) => partial
  const patch = useCallback((p) => setState((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) })), []);
  const reset = useCallback(() => setState(empty), []); // explicit "Clear / start over"

  return <ImportContext.Provider value={{ ...state, patch, reset }}>{children}</ImportContext.Provider>;
}
