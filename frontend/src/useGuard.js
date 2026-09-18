import { useRef, useState } from 'react';

// Runs an async action at most once at a time: a second click/Enter while one is in flight is ignored.
// (A ref, not state, so two events in the same tick cannot both slip through.)
export function useGuard() {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const run = async (fn) => {
    if (busy.current) return undefined;
    busy.current = true;
    setPending(true);
    try { return await fn(); } finally { busy.current = false; setPending(false); }
  };
  return [run, pending];
}
