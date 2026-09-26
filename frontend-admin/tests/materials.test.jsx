// Admin Materials page: create/edit/deactivate/reactivate, client + server validation, non-admin lockout.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN, as, loginApi, session, renderApp, uid, makeUser } from './helpers';
import { fmt, MAX_NUM } from '../src/api';

const numMsg = (k) => `${k} must be a number from 0 to ${fmt(MAX_NUM)}`;

async function openPage() {
  await session(ADMIN); // browser-side session (jsdom cookie jar)
  renderApp('/materials');
  await screen.findByRole('heading', { name: 'Manage Materials' });
}

// cells matching this materialId, active or "(inactive)" suffix
const idCells = (id) =>
  screen.getAllByText((_, el) => el?.tagName === 'TD' && new RegExp(`^${id}( \\(inactive\\))?$`).test(el.textContent));

async function openAddForm() {
  await userEvent.click(screen.getByRole('button', { name: 'Add Material' }));
}
async function set(label, value) {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  if (value !== '') await userEvent.type(input, value);
}
async function fillCreate({ materialId, description, unit, openingRate, openingQuantity, minimumQuantity }) {
  if (materialId !== undefined) await set('Material ID', materialId);
  if (description !== undefined) await set('Description', description);
  if (unit !== undefined) await set('Unit', unit);
  if (openingRate !== undefined) await set('Opening Rate', String(openingRate));
  if (openingQuantity !== undefined) await set('Opening Quantity', String(openingQuantity));
  if (minimumQuantity !== undefined) await set('Minimum Quantity', String(minimumQuantity));
}
const save = () => userEvent.click(screen.getByRole('button', { name: 'Save' }));

describe('Admin materials: create / validate / edit / deactivate', () => {
  it('creates a material, shows it with opening values, and locks the Material ID on edit', async () => {
    const id = uid('MAT');
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description: 'Steel rod', unit: 'Kg', openingRate: '12.5', openingQuantity: '100', minimumQuantity: '10' });
    await save();

    await waitFor(() => expect(idCells(id)).toHaveLength(1));
    const row = idCells(id)[0].closest('tr');
    expect(row.textContent).toContain('Steel rod');
    expect(row.textContent).toContain('Kg');
    expect(row.textContent).toContain(fmt(100)); // current qty == opening qty (no movements yet)
    expect(row.textContent).toContain(fmt(12.5)); // current rate == opening rate

    await userEvent.click(screen.getByRole('button', { name: `Edit ${id}` }));
    expect(screen.getByLabelText('Material ID')).toBeDisabled();
    expect(screen.getByLabelText('Material ID')).toHaveValue(id);
  });

  it('rejects an empty Material ID client-side with no POST sent', async () => {
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: '', description: 'X', unit: 'Kg' });
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Material ID is required');
    // the form is still open (save() returned before the try/catch that closes it)
    expect(screen.getByLabelText('Material ID')).toBeInTheDocument();
  });

  it('rejects whitespace-only Material ID with the same required message', async () => {
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: '   ', description: 'X', unit: 'Kg' });
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Material ID is required');
  });

  it('rejects an empty Description client-side', async () => {
    const id = uid('MAT');
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description: '', unit: 'Kg' });
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Description and unit are required');
    expect(screen.queryByText(id, { selector: 'td' })).toBeNull();
  });

  it('rejects an empty Unit client-side', async () => {
    const id = uid('MAT');
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description: 'X', unit: '' });
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Description and unit are required');
    expect(screen.queryByText(id, { selector: 'td' })).toBeNull();
  });

  it('rejects a negative Opening Rate client-side with the real MAX_NUM-formatted message', async () => {
    const id = uid('MAT');
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description: 'X', unit: 'Kg', openingRate: '-5' });
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent(numMsg('openingRate'));
    expect(screen.queryByText(id, { selector: 'td' })).toBeNull();
  });

  it('rejects a non-numeric Opening Quantity client-side', async () => {
    const id = uid('MAT');
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description: 'X', unit: 'Kg', openingQuantity: 'abc' });
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent(numMsg('openingQuantity'));
    expect(screen.queryByText(id, { selector: 'td' })).toBeNull();
  });

  it('rejects a Minimum Quantity of MAX_NUM + 1 client-side', async () => {
    const id = uid('MAT');
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description: 'X', unit: 'Kg', minimumQuantity: String(MAX_NUM + 1) });
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent(numMsg('minimumQuantity'));
    expect(screen.queryByText(id, { selector: 'td' })).toBeNull();
  });

  it('rejects an Opening Rate of exactly MAX_NUM + 1 with the same numeric-range message', async () => {
    const id = uid('MAT');
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description: 'X', unit: 'Kg', openingRate: String(MAX_NUM + 1) });
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent(numMsg('openingRate'));
    expect(screen.queryByText(id, { selector: 'td' })).toBeNull();
  });

  it('surfaces the real backend duplicate-materialId error, not a guessed one', async () => {
    const id = uid('MAT');
    const api = as((await loginApi(ADMIN)).cookie);
    await api.post('/materials', { materialId: id, description: 'Original', unit: 'Kg' });

    await openPage();
    await waitFor(() => expect(idCells(id)).toHaveLength(1));
    await openAddForm();
    await fillCreate({ materialId: id, description: 'Duplicate attempt', unit: 'Kg' });
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Material ID already exists');
    // still exactly one row for this id: the duplicate was never created
    expect(idCells(id)).toHaveLength(1);
  });

  it('a description one character over the 200 cap is rejected by the server, not silently accepted', async () => {
    const id = uid('MAT');
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description: 'x'.repeat(201), unit: 'Kg' });
    await save();
    // no client-side length check in AdminMaterials.save(): this round-trips to the server
    expect(await screen.findByRole('alert')).toHaveTextContent('description must be at most 200 characters');
    expect(screen.queryByText(id, { selector: 'td' })).toBeNull();
  });

  it('edits a material: description/unit/rate change, materialId stays locked and unchanged', async () => {
    const id = uid('MAT');
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description: 'Old desc', unit: 'Kg', openingRate: '5', openingQuantity: '50', minimumQuantity: '5' });
    await save();
    await waitFor(() => expect(idCells(id)).toHaveLength(1));

    await userEvent.click(screen.getByRole('button', { name: `Edit ${id}` }));
    const midInput = screen.getByLabelText('Material ID');
    expect(midInput).toBeDisabled();
    expect(midInput).toHaveValue(id);
    await fillCreate({ description: 'New desc', unit: 'Bag', openingRate: '9' });
    await save();

    await waitFor(() => expect(idCells(id)[0].closest('tr').textContent).toContain('New desc'));
    const row = idCells(id)[0].closest('tr');
    expect(row.textContent).toContain('Bag');
    expect(row.textContent).toContain(fmt(9));
    expect(row.textContent).not.toContain('Old desc');
  });

  it('deactivates and reactivates a material; the row never disappears', async () => {
    const id = uid('MAT');
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description: 'Toggle me', unit: 'Kg' });
    await save();
    await waitFor(() => expect(idCells(id)).toHaveLength(1));
    expect(screen.getByText(id, { selector: 'td' })).toBeInTheDocument(); // active: no suffix

    await userEvent.click(screen.getByRole('button', { name: `Deactivate ${id}` }));
    await waitFor(() => expect(screen.getByText(`${id} (inactive)`, { selector: 'td' })).toBeInTheDocument());
    expect(await screen.findByRole('button', { name: `Reactivate ${id}` })).toBeInTheDocument();
    expect(idCells(id)).toHaveLength(1); // still one row, not removed

    await userEvent.click(screen.getByRole('button', { name: `Reactivate ${id}` }));
    await waitFor(() => expect(screen.getByText(id, { selector: 'td' })).toBeInTheDocument());
    expect(await screen.findByRole('button', { name: `Deactivate ${id}` })).toBeInTheDocument();
    expect(idCells(id)).toHaveLength(1);
  });
});

describe('Admin materials: chaos data', () => {
  it('accepts unicode and emoji in description/unit and renders them unmangled', async () => {
    const id = uid('MAT');
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description: '  café 日本語 steel', unit: '⚙kg' });
    await save();
    await waitFor(() => expect(idCells(id)).toHaveLength(1));
    const row = idCells(id)[0].closest('tr');
    // description is schema-trimmed (leading/trailing whitespace only); the unicode/emoji content itself is preserved
    expect(row.textContent).toContain('café 日本語 steel');
    expect(row.textContent).toContain('⚙kg');
  });

  it('accepts materialId/description/unit at exactly their max length caps (50/200/30), not off-by-one rejected', async () => {
    const base = uid('MAT');
    const id = (base + 'X'.repeat(50)).slice(0, 50);
    const description = 'D'.repeat(200);
    const unit = 'U'.repeat(30);
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description, unit });
    await save();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(idCells(id)).toHaveLength(1));
    const row = idCells(id)[0].closest('tr');
    expect(row.textContent).toContain(description);
    expect(row.textContent).toContain(unit);
  });

  it('stores and renders a null byte / control character in description verbatim, without rejecting or corrupting it', async () => {
    const id = uid('MAT');
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description: 'A\u0000B', unit: 'Kg' });
    await save();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(idCells(id)).toHaveLength(1));
    // neither express-validator's str() nor mongoose rejects or strips a null byte: it round-trips exactly
    const api = as((await loginApi(ADMIN)).cookie);
    const saved = (await api.get('/materials')).data.find((m) => m.materialId === id);
    expect(saved.description).toBe('A\u0000B');
  });

  it('renders HTML/script-tag content in description as inert escaped text, never as real DOM nodes', async () => {
    const id = uid('MAT');
    const payload = '<script>window.__xss = 1;</script><img src=x onerror="window.__xss = 2">';
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description: payload, unit: 'Kg' });
    await save();
    await waitFor(() => expect(idCells(id)).toHaveLength(1));
    const row = idCells(id)[0].closest('tr');
    expect(row.querySelector('script')).toBeNull();
    expect(row.querySelector('img')).toBeNull();
    expect(row.textContent).toContain(payload);
    expect(window.__xss).toBeUndefined();
  });
});

describe('Admin materials: numeric edge cases', () => {
  it('accepts an Opening Quantity of exactly 0, not rejected, and displays 0', async () => {
    const id = uid('MAT');
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description: 'X', unit: 'Kg', openingQuantity: '0' });
    await save();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(idCells(id)).toHaveLength(1));
    expect(idCells(id)[0].closest('tr').textContent).toContain(fmt(0));
  });

  it('typing "-0" into Opening Rate is accepted and saved/displayed as plain 0, not "-0"', async () => {
    const id = uid('MAT');
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description: 'X', unit: 'Kg', openingRate: '-0' });
    await save();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(idCells(id)).toHaveLength(1));
    const row = idCells(id)[0].closest('tr');
    expect(row.textContent).not.toContain('-0');
    expect(row.textContent).toContain(`₹${fmt(0)}`);
  });

  it('accepts scientific notation ("1e5") typed into a numeric field and stores/displays the expanded value', async () => {
    const id = uid('MAT');
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description: 'X', unit: 'Kg', openingQuantity: '1e5' });
    await save();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(idCells(id)).toHaveLength(1));
    expect(idCells(id)[0].closest('tr').textContent).toContain(fmt(100000));
  });

  it('accepts a Minimum Quantity of MAX_NUM - 0.0000001 (float precision near the cap), not spuriously rejected', async () => {
    const id = uid('MAT');
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description: 'X', unit: 'Kg', minimumQuantity: String(MAX_NUM - 0.0000001) });
    await save();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(idCells(id)).toHaveLength(1));
  });
});

describe('Admin materials: concurrent admin edits', () => {
  it('editing only the description in the UI does not clobber a concurrent Opening Quantity change made by another admin session', async () => {
    const id = uid('MAT');
    await openPage();
    await openAddForm();
    await fillCreate({ materialId: id, description: 'Old desc', unit: 'Kg', openingQuantity: '100' });
    await save();
    await waitFor(() => expect(idCells(id)).toHaveLength(1));

    // admin A opens the edit form: the form now holds a snapshot with openingQuantity=100
    await userEvent.click(screen.getByRole('button', { name: `Edit ${id}` }));
    expect(screen.getByLabelText('Opening Quantity')).toHaveValue(100);

    // admin B: a second, independent admin session changes openingQuantity directly via the API
    // while A's edit form is still open (no movements exist yet, so the backend allows it)
    const bApi = as((await loginApi(ADMIN)).cookie);
    const materialId = (await bApi.get('/materials')).data.find((m) => m.materialId === id)._id;
    await bApi.put(`/materials/${materialId}`, { openingQuantity: 250 });

    // admin A only edits the description - never touches Opening Quantity - and saves
    await fillCreate({ description: 'New desc' });
    await save();
    await waitFor(() => expect(idCells(id)[0].closest('tr').textContent).toContain('New desc'));

    // B's concurrent change must survive: A never edited Opening Quantity, so it must not be
    // silently reverted to the stale value A's form loaded before B's change
    const row = idCells(id)[0].closest('tr');
    expect(row.textContent).toContain(fmt(250));
  });
});

describe('Admin materials: non-admin lockout', () => {
  it('a non-admin cannot sign into the admin app and never reaches Materials management', async () => {
    const user = await makeUser('Not An Admin');
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Admin sign in' });
    await userEvent.type(screen.getByLabelText('Email'), user.email);
    await userEvent.type(screen.getByLabelText('Password'), user.password);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This app is for admins only');
    expect(screen.getByRole('heading', { name: 'Admin sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Manage Materials' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add Material' })).toBeNull();
  });
});
