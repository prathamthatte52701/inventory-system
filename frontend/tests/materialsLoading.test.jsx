// Materials page must not flash "No materials yet." before its first fetch has finished.
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import api from '../src/api';
import { ADMIN, adminApi, session, renderApp, uid } from './helpers';

const EMPTY = 'No materials yet.';

// records whether a piece of text is ever present in the DOM (even for a single frame)
function watchFor(text) {
  const seen = { hit: false };
  const check = () => { if (document.body.textContent.includes(text)) seen.hit = true; };
  const mo = new MutationObserver(check);
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  check();
  return { seen, stop: () => mo.disconnect() };
}

describe('Materials loading state', () => {
  it('real backend data: the empty-state text never appears while loading or after', async () => {
    const id = uid('LOAD');
    await (await adminApi()).post('/materials', { materialId: id, description: 'Loading probe', unit: 'Nos' });
    await session(ADMIN);
    const w = watchFor(EMPTY);
    renderApp('/materials');
    expect(await screen.findByText(id)).toBeInTheDocument();
    expect(w.seen.hit).toBe(false);
    w.stop();
  });

  it('slow empty response: no empty-state text until the fetch resolves, then it appears', async () => {
    await session(ADMIN);
    let release;
    const real = api.get.bind(api);
    vi.spyOn(api, 'get').mockImplementation((url, ...rest) => (url === '/materials' ? new Promise((res) => { release = () => res({ data: [] }); }) : real(url, ...rest)));
    const w = watchFor(EMPTY);
    renderApp('/materials');
    await screen.findByRole('heading', { name: 'Material Master' });
    await waitFor(() => expect(release).toBeTypeOf('function')); // the request is in flight
    await new Promise((r) => setTimeout(r, 150));                 // give any premature render time to show up
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(w.seen.hit).toBe(false);
    release();
    expect(await screen.findByText(EMPTY)).toBeInTheDocument();  // loaded + genuinely empty
    w.stop();
  });

  it('failed fetch: shows the error, never claims "No materials yet."', async () => {
    await session(ADMIN);
    const real = api.get.bind(api);
    vi.spyOn(api, 'get').mockImplementation((url, ...rest) => (url === '/materials' ? Promise.reject(Object.assign(new Error('boom'), { response: { data: { message: 'Backend exploded' } } })) : real(url, ...rest)));
    const w = watchFor(EMPTY);
    renderApp('/materials');
    expect(await screen.findByRole('alert')).toHaveTextContent('Backend exploded');
    expect(w.seen.hit).toBe(false);
    w.stop();
  });
});
