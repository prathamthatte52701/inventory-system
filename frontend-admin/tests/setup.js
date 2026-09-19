import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 20000 }); // real DB over the internet: slower than the 1s default
afterEach(async () => {
  cleanup(); vi.restoreAllMocks();
  // httpOnly cookie is invisible to JS: clear the jsdom jar via the real logout endpoint
  try { const { default: api } = await import('../src/api'); await api.post('/auth/logout'); } catch { /* backend down at teardown */ }
});
