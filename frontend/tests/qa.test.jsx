// Admin-route tests removed — admin is a separate app now (frontend-admin/). See README "Testing" section for the pending admin test coverage.
// Round 4: adversarial frontend pass (empty submits, double clicks, Back button, session abuse, direct URLs, numbers, XSS).
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../src/api';
import { ADMIN, loginApi, adminApi, makeUser, session, renderApp, uid, as } from './helpers';

const type = async (label, text) => { const el = await screen.findByLabelText(label); await userEvent.clear(el); await userEvent.type(el, text); };
const calls = (spy, url) => spy.mock.calls.filter((c) => c[0] === url).length;
const anyStatus = { validateStatus: () => true };

// records every time a piece of text is ever present in the DOM (catches a one-frame "flash" of protected content)
function watchFor(text) {
  const seen = { hit: false };
  const check = () => { if (document.body.textContent.includes(text)) seen.hit = true; };
  const mo = new MutationObserver(check);
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  check();
  return { seen, stop: () => mo.disconnect() };
}
async function matOption(matId) {
  const sel = await screen.findByLabelText('Material');
  await waitFor(() => expect([...sel.options].some((o) => o.value === matId)).toBe(true));
  await userEvent.selectOptions(sel, matId);
}
async function newMat(prefix, extra = {}) {
  const api2 = await adminApi();
  const id = uid(prefix);
  const { data } = await api2.post('/materials', { materialId: id, description: `QA ${id}`, unit: 'Nos', ...extra });
  return { id, _id: data._id, api: api2 };
}

describe('Round 4 · empty required fields', () => {
  it('login: empty submit shows a message and sends nothing', async () => {
    const spy = vi.spyOn(api, 'post');
    renderApp('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter your email and password/i);
    expect(calls(spy, '/auth/login')).toBe(0);
    await type('Email', 'someone@test.com');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter your email and password/i); // password still empty
    expect(calls(spy, '/auth/login')).toBe(0);
  });

  it('signup: empty / short-password submits are blocked client-side', async () => {
    const spy = vi.spyOn(api, 'post');
    renderApp('/signup');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/required/i);
    await type('Name', 'A'); await type('Email', 'a@test.com'); await type('Password', '123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Name must be 3-48/i); // first failing rule
    await type('Name', 'Abe');
    await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Password must be 8-32/i);
    expect(calls(spy, '/auth/signup')).toBe(0);
  });

  it('movement form: empty quantity / missing IN rate blocked', async () => {
    const m = await newMat('EMV');
    await session(await makeUser());
    const spy = vi.spyOn(api, 'post');
    renderApp('/movement');
    await matOption(m._id);
    await userEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/quantity must be a number greater than 0/i);
    await type('Quantity', '5');
    await userEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/rate is required/i);
    expect(calls(spy, '/movements')).toBe(0);
  });

});

describe('Round 4 · rapid double-click (exactly one request, no phantom error)', () => {
  it('login', async () => {
    const spy = vi.spyOn(api, 'post');
    renderApp('/login');
    await type('Email', ADMIN.email); await type('Password', ADMIN.password);
    await userEvent.dblClick(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(calls(spy, '/auth/login')).toBe(1);
  });

  it('signup: one account, success screen (no "already registered" error)', async () => {
    const spy = vi.spyOn(api, 'post');
    renderApp('/signup');
    await type('Name', 'Dbl'); await type('Email', `${uid('d').toLowerCase()}@test.com`); await type('Password', 'Secret#123');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Sign up' }));
    expect(await screen.findByText(/waiting for admin approval/i)).toBeInTheDocument();
    expect(calls(spy, '/auth/signup')).toBe(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('movement: one movement recorded, balance not doubled', async () => {
    const m = await newMat('DBM');
    await session(await makeUser());
    const spy = vi.spyOn(api, 'post');
    renderApp('/movement');
    await matOption(m._id);
    await type('Quantity', '10'); await type('Rate', '5');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Record Movement' }));
    await waitFor(() => expect(screen.getByTestId('balance')).toHaveTextContent('10'));
    expect(calls(spy, '/movements')).toBe(1);
    expect((await m.api.get('/movements', { params: { material: m._id } })).data.data).toHaveLength(1);
  });

});

describe('Round 4 · Back / Forward button', () => {
  it('logged-in user pressing Back onto /login is bounced to the dashboard, never shown the form', async () => {
    await session(ADMIN);
    renderApp('/', { entries: ['/login', '/'], index: 1 });
    await screen.findByRole('heading', { name: 'Dashboard' });
    await userEvent.click(screen.getByText('test-back'));
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(screen.queryByRole('heading', { name: 'Log in' })).toBeNull();
  });

  it('log in, then Back: lands on the dashboard, not the login form', async () => {
    renderApp('/login');
    await type('Email', ADMIN.email); await type('Password', ADMIN.password);
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await screen.findByRole('heading', { name: 'Dashboard' });
    await userEvent.click(screen.getByText('test-back'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Log in' })).toBeNull();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('after logout, Back never shows protected pages', async () => {
    await session(ADMIN);
    renderApp('/materials', { entries: ['/', '/materials'], index: 1 });
    await screen.findByRole('heading', { name: 'Material Master' });
    await userEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Logout' }));
    await screen.findByRole('heading', { name: 'Log in' });
    const w = watchFor('Material Master');
    await userEvent.click(screen.getByText('test-back'));
    await screen.findByRole('heading', { name: 'Log in' });
    expect(w.seen.hit).toBe(false);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(localStorage.length).toBe(0);
    w.stop();
  });

  it('mid-flow: half-filled movement form, Back then Forward: no crash, form usable', async () => {
    const m = await newMat('BCK');
    await session(await makeUser());
    renderApp('/movement', { entries: ['/', '/movement'], index: 1 });
    await matOption(m._id);
    await type('Quantity', '7');
    await userEvent.click(screen.getByText('test-back'));
    await screen.findByRole('heading', { name: 'Dashboard' });
    await userEvent.click(screen.getByText('test-forward'));
    await matOption(m._id);
    expect(screen.getByLabelText('Quantity')).toHaveValue(null); // fresh form, not a broken half-state
    await type('Quantity', '3'); await type('Rate', '2');
    await userEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
    await waitFor(() => expect(screen.getByTestId('balance')).toHaveTextContent('3'));
  });
});

describe('Round 4 · session abuse', () => {
  it('no session: clean redirect to login, protected page never rendered', async () => {
    const w = watchFor('Material Master');
    renderApp('/materials');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(w.seen.hit).toBe(false);
    expect(screen.queryByRole('navigation')).toBeNull();
    w.stop();
  });

});

describe('Round 4 · direct URL access', () => {
  it('logged-out visitor typing protected URLs goes to login', async () => {
    for (const url of ['/materials', '/ledger', '/reports', '/movement']) {
      const { unmount } = renderApp(url);
      expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
      unmount();
    }
  });
});

describe('Round 4 · numbers: client and API agree', () => {
  it('quantity field: -5, 0, 1e15, 1e999, text are blocked; 0.5 and 1e9 go through', async () => {
    const m = await newMat('NUM', { openingQuantity: 10, openingRate: 4 });
    const u = await makeUser();
    await session(u); const { cookie: token } = await loginApi(u);
    const spy = vi.spyOn(api, 'post');
    renderApp('/movement');
    await matOption(m._id);
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'OUT');

    for (const bad of ['-5', '0', '1e15', '1e999', '1e9000', '0.00001', 'abc']) {
      await type('Quantity', bad);
      await userEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
      expect(await screen.findByRole('alert'), bad).toHaveTextContent(/quantity must be a number greater than 0/i);
    }
    expect(calls(spy, '/movements')).toBe(0); // nothing sent for any blocked value

    // the API independently rejects every one of them too (the two layers agree)
    const direct = as(token);
    for (const bad of [-5, 0, 1e15, '1e999', '1e9000', 0.00001, 'abc'])
      expect((await direct.post('/movements', { material: m._id, type: 'OUT', quantity: bad }, anyStatus)).status, String(bad)).toBe(400);

    await type('Quantity', '0.5');
    await userEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
    await waitFor(() => expect(screen.getByTestId('balance')).toHaveTextContent('9.5')); // decimal handled exactly
    expect(calls(spy, '/movements')).toBe(1);

    await type('Quantity', '1e9'); // the documented ceiling: passes client validation but the API rejects it (exceeds stock)
    await userEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Cannot record OUT of 1000000000: only 9\.5 .* available/);
    expect(calls(spy, '/movements')).toBe(2);
    const final = (await direct.get(`/materials/${m._id}`)).data;
    expect(Number.isFinite(final.currentQuantity)).toBe(true);
    expect(final.currentQuantity).toBeCloseTo(9.5, 3); // rejected: balance unchanged
  });

  it('rate field: negative / huge / blank rejected for IN, accepted values reach the API unchanged', async () => {
    const m = await newMat('RAT');
    await session(await makeUser());
    const spy = vi.spyOn(api, 'post');
    renderApp('/movement');
    await matOption(m._id);
    await type('Quantity', '2');
    for (const bad of ['-1', '1e15', '1e999', '']) {
      if (bad === '') await userEvent.clear(screen.getByLabelText('Rate')); else await type('Rate', bad);
      await userEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
      expect(await screen.findByRole('alert'), bad).toHaveTextContent(/rate is required/i);
    }
    expect(calls(spy, '/movements')).toBe(0);
    await type('Rate', '12.345');
    await userEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
    await waitFor(() => expect(screen.getByTestId('balance')).toHaveTextContent('2'));
    expect(spy.mock.calls.find((c) => c[0] === '/movements')[1]).toMatchObject({ quantity: 2, rate: 12.345, type: 'IN' });
    expect((await m.api.get(`/materials/${m._id}`)).data.currentRate).toBe(12.345);
  });

});

describe('Round 4 · hostile text renders as inert text', () => {
  it('HTML in descriptions/notes is shown literally on dashboard, materials, ledger (no elements, no script)', async () => {
    const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
    const m = await newMat('XSS');
    await m.api.put(`/materials/${m._id}`, { description: payload });
    await m.api.post('/movements', { material: m._id, type: 'IN', quantity: 1, rate: 1, note: payload });
    await session(ADMIN);
    for (const route of ['/', '/materials', '/ledger']) {
      const { unmount, container } = renderApp(route);
      await screen.findAllByText((t) => t.includes('<img src=x'));
      expect(container.querySelector('img[src="x"]')).toBeNull();
      expect(container.querySelector('script')).toBeNull();
      expect(window.__xss).toBeUndefined();
      unmount();
    }
  });
});
