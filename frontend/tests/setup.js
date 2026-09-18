import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 20000 }); // real DB over the internet: slower than the 1s default
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
