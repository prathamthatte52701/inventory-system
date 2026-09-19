// Round 4: adversarial frontend pass (empty submits, double clicks, Back button, session abuse, direct URLs, numbers, XSS).
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../src/api';
import { ADMIN, loginApi, adminApi, makeUser, session, renderApp, uid, as, backendRequire } from './helpers';

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
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 6/i);
    expect(calls(spy, '/auth/signup')).toBe(0);
  });

  it('material form: empty and invalid fields are blocked; nothing created', async () => {
    await session(ADMIN);
    const spy = vi.spyOn(api, 'post');
    renderApp('/admin/materials');
    await userEvent.click(await screen.findByRole('button', { name: 'Add Material' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Material ID is required');
    await type('Material ID', uid('EM'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/description and unit/i);
    await type('Description', 'd'); await type('Unit', 'u'); await type('Opening Quantity', '-3');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/openingQuantity must be a number/);
    await type('Opening Quantity', '1e15');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/openingQuantity must be a number/);
    expect(calls(spy, '/materials')).toBe(0);
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

  it('ledger edit: empty quantity / empty rate blocked, nothing sent', async () => {
    const { _id, api: a } = await newMat('ELG');
    const mv = (await a.post('/movements', { material: _id, type: 'IN', quantity: 10, rate: 5 })).data.movement;
    await session(ADMIN);
    const spy = vi.spyOn(api, 'put');
    renderApp('/admin/ledger');
    const row = await screen.findByTestId(`row-${mv._id}`);
    await userEvent.click(within(row).getByRole('button', { name: /^Edit movement/ }));
    await userEvent.clear(within(row).getByLabelText('Quantity'));
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/quantity must be a number/i);
    await type2(within(row).getByLabelText('Quantity'), '10');
    await userEvent.clear(within(row).getByLabelText('Rate'));
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/rate is required/i);
    expect(calls(spy, `/movements/${mv._id}`)).toBe(0);
  });
});
const type2 = async (el, text) => { await userEvent.clear(el); await userEvent.type(el, text); };

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
    await type('Name', 'Dbl'); await type('Email', `${uid('d').toLowerCase()}@test.com`); await type('Password', 'secret1');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Sign up' }));
    expect(await screen.findByText(/waiting for admin approval/i)).toBeInTheDocument();
    expect(calls(spy, '/auth/signup')).toBe(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('material create: one row, no duplicate-ID error', async () => {
    await session(ADMIN);
    const spy = vi.spyOn(api, 'post');
    renderApp('/admin/materials');
    const id = uid('DBL');
    await userEvent.click(await screen.findByRole('button', { name: 'Add Material' }));
    await type('Material ID', id); await type('Description', 'Dbl'); await type('Unit', 'u');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(id)).toBeInTheDocument();
    expect(calls(spy, '/materials')).toBe(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByText(id)).toHaveLength(1);
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

  it('ledger save: one PUT', async () => {
    const { _id, api: a } = await newMat('DBL2');
    const mv = (await a.post('/movements', { material: _id, type: 'IN', quantity: 10, rate: 5 })).data.movement;
    await session(ADMIN);
    const spy = vi.spyOn(api, 'put');
    renderApp('/admin/ledger');
    const row = await screen.findByTestId(`row-${mv._id}`);
    await userEvent.click(within(row).getByRole('button', { name: /^Edit movement/ }));
    await type2(within(row).getByLabelText('Quantity'), '20');
    await userEvent.dblClick(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(screen.getByTestId(`row-${mv._id}`)).getByText('₹100')).toBeInTheDocument());
    expect(calls(spy, `/movements/${mv._id}`)).toBe(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('users approve: one PATCH, no "already processed" error', async () => {
    const email = `${uid('ap').toLowerCase()}@test.com`;
    await as().post('/auth/signup', { name: 'Ap', email, password: 'secret1' });
    await session(ADMIN);
    const spy = vi.spyOn(api, 'patch');
    renderApp('/admin/users');
    await userEvent.dblClick(await screen.findByRole('button', { name: `Approve ${email}` }));
    await waitFor(() => expect(screen.queryByRole('button', { name: `Approve ${email}` })).toBeNull());
    expect(spy.mock.calls.filter((c) => c[0].endsWith('/approve')).length).toBe(1);
    expect(screen.queryByRole('alert')).toBeNull();
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

  it('edited role in localStorage does not unlock admin UI (server role wins) and never flashes it', async () => {
    const u = await session(await makeUser('Sneaky Sam'));
    localStorage.setItem('user', JSON.stringify({ ...u.user, role: 'admin' }));
    const w = watchFor('Admin Console');
    renderApp('/admin/users');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(w.seen.hit).toBe(false);
    const nav = screen.getByRole('navigation');
    expect(within(nav).queryByRole('link', { name: 'Users' })).toBeNull();
    expect(within(nav).queryByText(/admin/)).toBeNull();
    w.stop();
  });
});

describe('Round 4 · direct URL access', () => {
  it('normal user typing /users or any /admin/* URL: redirected, admin content never appears', async () => {
    await session(await makeUser());
    for (const url of ['/users', '/admin/users', '/admin', '/admin/', '/admin/materials', '/admin/ledger', '/admin/audit', '/admin/analytics', '/admin/nope', '/users/', '/USERS']) {
      const w = watchFor('Admin Console');
      const { unmount } = renderApp(url);
      expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
      expect(w.seen.hit, url).toBe(false);
      w.stop(); unmount();
    }
  });
  it('logged-out visitor typing admin URLs goes to login', async () => {
    for (const url of ['/users', '/admin', '/admin/users', '/admin/audit', '/admin/analytics', '/materials', '/ledger', '/reports', '/movement']) {
      const { unmount } = renderApp(url);
      expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
      unmount();
    }
  });
  it('admin can reach /admin/users directly', async () => {
    await session(ADMIN);
    renderApp('/admin/users');
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument();
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

    await type('Quantity', '1e9'); // the documented ceiling: allowed by both layers, goes negative with a warning
    await userEvent.click(screen.getByRole('button', { name: 'Record Movement' }));
    expect(await screen.findByText(/exceeds available stock/i)).toBeInTheDocument();
    expect(calls(spy, '/movements')).toBe(2);
    const final = (await direct.get(`/materials/${m._id}`)).data;
    expect(Number.isFinite(final.currentQuantity)).toBe(true);
    expect(final.currentQuantity).toBeCloseTo(9.5 - 1e9, 3);
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

  it('ledger edit: 1e15 / negative quantity blocked client-side', async () => {
    const { _id, api: a } = await newMat('LNM');
    const mv = (await a.post('/movements', { material: _id, type: 'IN', quantity: 10, rate: 5 })).data.movement;
    await session(ADMIN);
    const spy = vi.spyOn(api, 'put');
    renderApp('/admin/ledger');
    const row = await screen.findByTestId(`row-${mv._id}`);
    await userEvent.click(within(row).getByRole('button', { name: /^Edit movement/ }));
    for (const bad of ['1e15', '-2', '0']) {
      await type2(within(row).getByLabelText('Quantity'), bad);
      await userEvent.click(within(row).getByRole('button', { name: 'Save' }));
      expect(await screen.findByRole('alert'), bad).toHaveTextContent(/quantity must be a number/i);
    }
    expect(calls(spy, `/movements/${mv._id}`)).toBe(0);
  });
});

describe('Round 4 · hostile text renders as inert text', () => {
  it('HTML in descriptions/notes is shown literally on dashboard, materials, ledger and their admin twins (no elements, no script)', async () => {
    const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
    const m = await newMat('XSS');
    await m.api.put(`/materials/${m._id}`, { description: payload });
    await m.api.post('/movements', { material: m._id, type: 'IN', quantity: 1, rate: 1, note: payload });
    await session(ADMIN);
    for (const route of ['/', '/materials', '/ledger', '/admin/materials', '/admin/ledger']) {
      const { unmount, container } = renderApp(route);
      await screen.findAllByText((t) => t.includes('<img src=x'));
      expect(container.querySelector('img[src="x"]')).toBeNull();
      expect(container.querySelector('script')).toBeNull();
      expect(window.__xss).toBeUndefined();
      unmount();
    }
  });
});
