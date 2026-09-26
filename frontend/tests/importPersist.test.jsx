// The Import page's in-progress state (file, preview, inline edits, result) is held in ImportContext at the app
// root, not in the page's own state, so it survives navigating away and back — this is a client-side router,
// navigating never reloads the browser, it only unmounts <Import/>.
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { adminApi, backendRequire, makeUser, session, renderApp, uid } from './helpers';
import api from '../src/api';

const goTo = (name) => userEvent.click(screen.getByRole('link', { name }));
const type = async (label, text) => { const el = await screen.findByLabelText(label); await userEvent.clear(el); await userEvent.type(el, text); };

async function login() {
  const u = await makeUser('Import Persist');
  await session(u);
  return u;
}

// waits for the page (and the auth check that gates it) to actually mount, then returns the file input
async function openImport() {
  renderApp('/import');
  await screen.findByRole('button', { name: 'Preview' });
  return document.querySelector('input[type=file]');
}

function xlsx(headers, row) {
  const ExcelJS = backendRequire('exceljs');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
  ws.addRow(headers); ws.addRow(row);
  return wb.xlsx.writeBuffer();
}

describe('Import page state survives navigation', () => {
  it('a preview stays put across navigating away and back, and is not re-fetched', async () => {
    await login();
    const edp = uid('IP');
    const input = await openImport();
    const buf = await xlsx(['EDP No', 'Current Qty'], [edp, 5]);
    const file = new File([buf], `${edp}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await userEvent.upload(input, file);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByTestId('import-summary'); // a real preview against the real backend

    const postSpy = vi.spyOn(api, 'post');
    await goTo('Dashboard');
    await screen.findByRole('heading', { name: 'Dashboard' });
    await goTo('Import');

    expect(await screen.findByText(`${edp}.xlsx`)).toBeInTheDocument(); // the file name, still shown
    expect(screen.getByTestId('import-summary')).toBeInTheDocument(); // the preview table, still there
    expect(postSpy).not.toHaveBeenCalledWith('/imports/preview', expect.anything()); // not re-uploaded, not re-parsed
    postSpy.mockRestore();
  });

  it('an inline rate fix survives the round trip too', async () => {
    await login();
    const edp = uid('IR');
    const input = await openImport();
    // a new EDP with a Receipt but no Rate column: the IN row previews as "needs rate", fixable inline
    const buf = await xlsx(['EDP No', 'Receipt Qty', 'Receive Date'], [edp, 5, new Date('2025-01-02')]);
    const file = new File([buf], 'rate.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    await userEvent.upload(input, file);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByTestId('import-summary');
    const rateInput = await screen.findByLabelText(/^Rate for /);
    await userEvent.type(rateInput, '7.5');
    await waitFor(() => expect(rateInput).toHaveValue(7.5));

    await goTo('Dashboard');
    await screen.findByRole('heading', { name: 'Dashboard' });
    await goTo('Import');

    const restored = await screen.findByLabelText(/^Rate for /);
    expect(restored).toHaveValue(7.5);
  });

  it('the explicit Clear action resets to the empty upload form', async () => {
    await login();
    const input = await openImport();
    const file = new File(['x'], 'clear-me.xlsx');
    await userEvent.upload(input, file);
    expect(await screen.findByText('clear-me.xlsx')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('clear-me.xlsx')).toBeNull();
    expect(screen.queryByTestId('import-summary')).toBeNull();

    await goTo('Dashboard');
    await screen.findByRole('heading', { name: 'Dashboard' });
    await goTo('Import');
    expect(screen.queryByText('clear-me.xlsx')).toBeNull(); // cleared state does not reappear
  });

  it('a successful commit clears the form automatically', async () => {
    await login();
    const edp = uid('CM');
    const input = await openImport();
    const buf = await xlsx(['EDP No', 'Receipt Qty', 'Rate', 'Receive Date'], [edp, 4, 2, new Date('2025-01-02')]);
    const file = new File([buf], 'commit-me.xlsx');

    await userEvent.upload(input, file);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByTestId('import-summary');
    await userEvent.click(screen.getByRole('button', { name: 'Commit Import' }));
    await screen.findByRole('status');

    expect(screen.queryByText('commit-me.xlsx')).toBeNull();
    expect(screen.queryByTestId('import-summary')).toBeNull();

    await goTo('Materials');
    await goTo('Import');
    expect(screen.queryByText('commit-me.xlsx')).toBeNull(); // the cleared state stayed cleared
  });

  it('logging out clears the in-progress import so it cannot leak into the next session (same browser tab, one continuous tree)', async () => {
    const u1 = await login();
    const input = await openImport();
    const file = new File(['x'], 'leaky.xlsx');
    await userEvent.upload(input, file);
    expect(await screen.findByText('leaky.xlsx')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await screen.findByRole('heading', { name: 'Log in' });

    // a second user logs in through the same live app (no fresh render, no fresh ImportProvider) and lands on
    // Import: the first user's selected file must not still be sitting there
    const u2 = { email: `${uid('u').toLowerCase()}@test.com`, password: 'Secret#123' };
    const su = await api.post('/auth/signup', { name: 'Second User', email: u2.email, password: u2.password });
    await (await adminApi()).patch(`/users/${su.data.id}/approve`);
    await type('Email', u2.email); await type('Password', u2.password);
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(u1.email).not.toBe(u2.email);

    await goTo('Import');
    await screen.findByRole('button', { name: 'Preview' });
    expect(screen.queryByText('leaky.xlsx')).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
  });

  it('a fresh, never-used Import page starts empty', async () => {
    await login();
    await openImport();
    expect(screen.queryByTestId('import-summary')).toBeNull();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
  });
});
