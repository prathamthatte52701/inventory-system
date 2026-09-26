// Admin Audit Log: base list, filters, date-range validation, pagination, the stale-response race guard, and
// non-admin lockout — against the real backend and real Mongo. Only the race test (item 6) mocks api.get.
import { describe, it, expect, vi } from 'vitest';
import { screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN, as, loginApi, session, renderApp, uid, makeUser } from './helpers';
import appApi from '../src/api'; // the app's own axios instance (for spying on/mocking api.get)

async function openAudit() {
  renderApp('/audit');
  await screen.findByRole('heading', { name: 'Audit Log' });
}
const auditRows = () => screen.getAllByTestId(/^audit-/);
const cellsOf = (row) => within(row).getAllByRole('cell');

describe('Admin audit log: base list', () => {
  it('shows a real login and a real material-create entry with correct data, newest first', async () => {
    const cookie = (await loginApi(ADMIN)).cookie; // real LOGIN audit entry
    const api = as(cookie);
    const materialId = uid('AUD');
    await api.post('/materials', { materialId, description: 'Audit test', unit: 'Kg' }); // real MATERIAL_CREATE entry
    await session(ADMIN); // browser-side session for rendering

    await openAudit();
    // filter to Material/MATERIAL_CREATE so our just-created row is reliably findable among whatever else parallel
    // suites have written to this shared, real audit log
    await userEvent.selectOptions(screen.getByLabelText('Entity type'), 'Material');
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'MATERIAL_CREATE');

    // exact `details` shape written by materialController.create: { materialId: m.materialId }
    const cell = await screen.findByText(JSON.stringify({ materialId }));
    const row = cell.closest('tr');
    expect(within(row).getByText(ADMIN.email)).toBeInTheDocument();
    expect(within(row).getByText('MATERIAL_CREATE')).toBeInTheDocument();
    expect(cellsOf(row)[3]).toHaveTextContent('Material');

    // newest-first ordering across whatever rows are currently rendered (a real, general invariant)
    await waitFor(() => expect(document.querySelectorAll('time').length).toBeGreaterThan(0));
    const times = [...document.querySelectorAll('time')].map((t) => new Date(t.getAttribute('dateTime')).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

describe('Admin audit log: filters', () => {
  it('narrows by entityType, by action, and by both together — matching the request params and the rendered rows', async () => {
    const cookie = (await loginApi(ADMIN)).cookie;
    const api = as(cookie);
    const materialId = uid('AUD');
    const mat = (await api.post('/materials', { materialId, description: 'Filter test', unit: 'Kg' })).data;
    const mv = (await api.post('/movements', { material: mat._id, type: 'IN', quantity: 5, rate: 2 })).data.movement;
    await session(ADMIN);

    const getSpy = vi.spyOn(appApi, 'get'); // observes real calls, does not change behavior
    await openAudit();
    getSpy.mockClear();

    // entityType alone
    await userEvent.selectOptions(screen.getByLabelText('Entity type'), 'Material');
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    let params = getSpy.mock.calls.at(-1)[1].params;
    expect(params.entityType).toBe('Material');
    expect(params.action).toBeUndefined();
    await screen.findByText(JSON.stringify({ materialId }));
    for (const row of auditRows()) expect(cellsOf(row)[3]).toHaveTextContent('Material');

    // action alone
    getSpy.mockClear();
    await userEvent.selectOptions(screen.getByLabelText('Entity type'), '');
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'MOVEMENT_CREATE');
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    params = getSpy.mock.calls.at(-1)[1].params;
    expect(params.action).toBe('MOVEMENT_CREATE');
    expect(params.entityType).toBeUndefined();
    // exact `details` shape written by movementController.create: { material, type, quantity, amount }
    const moveDetails = JSON.stringify({ material: materialId, type: 'IN', quantity: 5, amount: mv.amount });
    await screen.findByText(moveDetails);
    for (const row of auditRows()) expect(cellsOf(row)[2]).toHaveTextContent('MOVEMENT_CREATE');

    // both together
    getSpy.mockClear();
    await userEvent.selectOptions(screen.getByLabelText('Entity type'), 'Movement');
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    params = getSpy.mock.calls.at(-1)[1].params;
    expect(params.entityType).toBe('Movement');
    expect(params.action).toBe('MOVEMENT_CREATE');
    await screen.findByText(moveDetails);
    for (const row of auditRows()) {
      expect(cellsOf(row)[2]).toHaveTextContent('MOVEMENT_CREATE');
      expect(cellsOf(row)[3]).toHaveTextContent('Movement');
    }
    getSpy.mockRestore();
  }, 20000);
});

describe('Admin audit log: date range validation', () => {
  it('shows the "From is after To" warning and fires no request while the range stays invalid', async () => {
    await session(ADMIN);
    await openAudit();
    const getSpy = vi.spyOn(appApi, 'get');
    getSpy.mockClear();

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2024-01-10' } });
    await waitFor(() => expect(getSpy).toHaveBeenCalled()); // a single-sided range is valid: this one fires

    getSpy.mockClear();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2024-06-01' } }); // now From > To
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('"From" is after "To".');
    expect(getSpy).not.toHaveBeenCalled();

    // widen it again and confirm requests resume (the guard is not permanently stuck)
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2024-12-31' } });
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    getSpy.mockRestore();
  });
});

// The login limiter charges attempts before checking the password and only resets the counter after a successful
// login completes, so too many truly concurrent logins for the same account can race the charge and spuriously
// 429 once "failures" (all momentarily in-flight) exceeds its cap of 5. Small batches (<= 4 concurrent) stay safely
// under that cap while still being far faster than one-at-a-time.
async function manyLogins(n) {
  const BATCH = 4;
  for (let i = 0; i < n; i += BATCH) {
    await Promise.all(Array.from({ length: Math.min(BATCH, n - i) }, () => loginApi(ADMIN)));
  }
}

describe('Admin audit log: pagination', () => {
  it('shows 50 rows per page, a second page with a different row set, and lands back on real data after the filter narrows mid-browse', async () => {
    await manyLogins(55); // 55 real LOGIN/User audit entries
    await session(ADMIN);

    await openAudit();
    await userEvent.selectOptions(screen.getByLabelText('Entity type'), 'User');
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'LOGIN');
    await waitFor(() => expect(auditRows()).toHaveLength(50));
    expect(screen.getByTestId('page-info')).toHaveTextContent(/Page 1 of [2-9]/);
    const page1Ids = auditRows().map((r) => r.dataset.testid);

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    // `page` (and so the "Page 2" label) updates synchronously on click, before the new rows arrive — wait for the
    // actual row set to change, not just the label, or this can read the stale page-1 rows under a "Page 2" label
    await waitFor(() => {
      const ids = auditRows().map((r) => r.dataset.testid);
      expect(ids.some((id) => page1Ids.includes(id))).toBe(false);
    });
    expect(screen.getByTestId('page-info')).toHaveTextContent('Page 2');
    const page2Ids = auditRows().map((r) => r.dataset.testid);
    expect(page2Ids.length).toBeGreaterThan(0);

    // Narrow the active filter while sitting on page 2. AdminAudit's own filter handler (`set()` in AdminAudit.jsx)
    // resets `page` to 1 in the SAME state update that changes the filter, which is what the admin actually
    // experiences as "snapping back" instead of a stranded empty page. (The deeper `!data.length && page > 1`
    // recovery branch inside load() itself could not be exercised through genuine UI interaction against this real,
    // append-only backend: every exposed filter control resets the page together with the filter in one event, so
    // load() never sees a stale page number alongside a newly-narrowed filter, and audit rows are never deleted, so
    // a page that once had data can never legitimately go empty on its own. See the report for detail.)
    await userEvent.selectOptions(screen.getByLabelText('Entity type'), 'Material');
    await waitFor(() => expect(screen.queryByText('No audit entries match.')).toBeNull());
    expect(auditRows().length).toBeGreaterThan(0);
  }, 45000);
});

describe('Admin audit log: clear filters', () => {
  it('resets all filters and the page to their defaults, and the next request carries no filter params', async () => {
    await session(ADMIN);
    await openAudit();
    await userEvent.selectOptions(screen.getByLabelText('Entity type'), 'Material');
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'MATERIAL_CREATE');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2024-01-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2024-12-31' } });
    await waitFor(() => expect(screen.getByLabelText('To')).toHaveValue('2024-12-31'));

    const nextBtn = screen.queryByRole('button', { name: 'Next' }); // move to page 2 if this filter combo has one
    if (nextBtn && !nextBtn.disabled) await userEvent.click(nextBtn);

    const getSpy = vi.spyOn(appApi, 'get');
    getSpy.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    const params = getSpy.mock.calls.at(-1)[1].params;
    expect(params.entityType).toBeUndefined();
    expect(params.action).toBeUndefined();
    expect(params.from).toBeUndefined();
    expect(params.to).toBeUndefined();
    expect(params.page).toBe(1);

    expect(screen.getByLabelText('Entity type')).toHaveValue('');
    expect(screen.getByLabelText('Action')).toHaveValue('');
    expect(screen.getByLabelText('From')).toHaveValue('');
    expect(screen.getByLabelText('To')).toHaveValue('');
    getSpy.mockRestore();
  });
});

describe('Admin audit log: race condition', () => {
  // Mocking api.get is used ONLY in this test, to make the timing deterministic: the first (stale) call is given an
  // artificial delay longer than the second (superseding) call, which proves the `latest` ref in AdminAudit.jsx
  // actually drops the stale response rather than merely "usually winning the race" against a real backend.
  it('renders only the latest filter\'s results when an earlier request resolves after a later one', async () => {
    await session(ADMIN);
    const realGet = appApi.get.bind(appApi); // AuthContext also calls api.get('/auth/me'); only /audit is faked below
    let n = 0;
    const getSpy = vi.spyOn(appApi, 'get').mockImplementation((url, config) => {
      if (url !== '/audit') return realGet(url, config);
      n += 1;
      const seq = n;
      const action = config?.params?.action || 'NONE';
      const delay = seq === 2 ? 300 : 0; // the 2nd call (first filter change) is made deliberately slow/stale
      const row = { _id: `race-r${seq}`, createdAt: new Date(Date.now() - seq).toISOString(), userEmail: ADMIN.email, action, entityType: 'Material', details: { seq } };
      return new Promise((resolve) => setTimeout(() => resolve({ data: { data: [row], total: 1, totalPages: 1 } }), delay));
    });

    await openAudit(); // call #1: mount, unfiltered, resolves immediately
    await waitFor(() => expect(screen.getByTestId('audit-race-r1')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText('Action'), 'LOGIN');  // call #2: slow, will be stale
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'SIGNUP'); // call #3: fast, supersedes #2

    await waitFor(() => expect(screen.getByTestId('audit-race-r3')).toBeInTheDocument());
    expect(screen.getByTestId('audit-race-r3')).toHaveTextContent('SIGNUP');
    expect(screen.queryByTestId('audit-race-r2')).toBeNull(); // never rendered, not even transiently up to now

    // let call #2's delayed promise resolve and confirm it still never lands
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByTestId('audit-race-r2')).toBeNull();
    expect(screen.getByTestId('audit-race-r3')).toBeInTheDocument();

    getSpy.mockRestore();
  });
});

describe('Admin audit log: material deactivate/reactivate actions', () => {
  it('the Action dropdown includes MATERIAL_DEACTIVATE/MATERIAL_REACTIVATE, and filtering by one narrows to a real generated entry', async () => {
    const cookie = (await loginApi(ADMIN)).cookie;
    const api = as(cookie);
    const materialId = uid('AUD');
    const mat = (await api.post('/materials', { materialId, description: 'Deactivate test', unit: 'Kg' })).data;
    await api.patch(`/materials/${mat._id}/deactivate`); // real MATERIAL_DEACTIVATE entry
    await session(ADMIN);

    await openAudit();
    const actionSelect = screen.getByLabelText('Action');
    const optionValues = [...actionSelect.options].map((o) => o.value);
    expect(optionValues).toContain('MATERIAL_DEACTIVATE');
    expect(optionValues).toContain('MATERIAL_REACTIVATE');

    await userEvent.selectOptions(actionSelect, 'MATERIAL_DEACTIVATE');
    // the deactivate audit call carries no `details` (materialController.js's setActive omits it), so the row is
    // identified by its action, not by a materialId in the Details column
    await waitFor(() => expect(auditRows().length).toBeGreaterThan(0));
    for (const row of auditRows()) {
      expect(cellsOf(row)[2]).toHaveTextContent('MATERIAL_DEACTIVATE'); // action column only — other actions' option
      expect(cellsOf(row)[2]).not.toHaveTextContent('MATERIAL_CREATE'); // text still exists in the <select>'s DOM,
      expect(cellsOf(row)[2]).not.toHaveTextContent('MATERIAL_REACTIVATE'); // so this must be scoped to the row, not the page
    }
  });
});

describe('Admin audit log: non-admin access', () => {
  it('a non-admin cannot sign in to the admin app or ever reach the audit log', async () => {
    const u = await makeUser();
    renderApp('/login');
    await userEvent.type(await screen.findByLabelText('Email'), u.email);
    await userEvent.type(screen.getByLabelText('Password'), u.password);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This app is for admins only');
    expect(screen.queryByRole('heading', { name: 'Audit Log' })).toBeNull();
    expect(screen.queryByLabelText('Entity type')).toBeNull();
  });
});
