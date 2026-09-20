// Import page against a MOCKED api (backend built in parallel): contract-shaped data only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import api from '../src/api';
import Import from '../src/pages/Import';

const mv = (o) => ({ row: 2, edp: 'E1', description: 'Bolt', type: 'IN', quantity: 5, rate: 10, movementDate: '2025-01-02', status: 'ok', newMaterial: false, ...o });
const PLAN = {
  filename: 'a.xlsx', parseErrors: [{ row: 9, message: 'bad date' }],
  materials: [{ edp: 'N1', description: 'Nut', unit: 'TBD', openingQuantity: 0, openingRate: 0 }],
  movements: [
    mv({ id: 'r1', status: 'ok' }),
    mv({ id: 'r2', edp: 'N1', status: 'new-material', newMaterial: true }),
    mv({ id: 'r3', status: 'duplicate-skip' }),
    mv({ id: 'r4', status: 'rejected', rate: null, reason: 'IN requires a rate', newMaterial: true, edp: 'N1' }),
    mv({ id: 'r5', type: 'OUT', status: 'rejected', reason: 'Insufficient stock' }),
    mv({ id: 'r6', warning: 'balance mismatch' }),
  ],
  summary: { totalRows: 6, newMaterials: 1, willCreate: 3, willSkip: 1, willReject: 2, parseErrors: 1 },
};
const HIST = { data: [{ _id: 'h1', filename: 'old.xlsx', uploadedBy: { _id: 'u', name: 'Asha' }, uploadedAt: '2025-01-01T00:00:00Z', rowCount: 7, createdCount: 5, skippedCount: 1, rejectedCount: 1 }], total: 1, page: 1, limit: 20, totalPages: 1 };
const RESULT = { batchId: 'b', filename: 'a.xlsx', summary: { rowCount: 42, created: 30, skipped: 7, failed: 5, newMaterials: 3 },
  createdMaterials: [{ materialId: 'N1', description: 'Nut', unit: 'TBD' }],
  results: [{ id: 'r1', row: 2, edp: 'E1', type: 'IN', status: 'created' }, { id: 'r2', row: 3, edp: 'E2', type: 'OUT', status: 'failed', reason: 'boom reason' }, { id: 'r3', row: 4, edp: 'E3', type: 'IN', status: 'skipped-duplicate' }] };

let post;
function mock(plan = PLAN) {
  vi.spyOn(api, 'get').mockResolvedValue({ data: HIST });
  post = vi.spyOn(api, 'post').mockImplementation(async (url) => ({ data: url === '/imports/preview' ? plan : RESULT }));
}
async function upload() {
  render(<MemoryRouter><Import /></MemoryRouter>);
  const user = userEvent.setup();
  await user.upload(document.querySelector('input[type=file]'), new File(['x'], 'a.xlsx'));
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  await screen.findByTestId('import-summary');
  return user;
}
const commitBtn = () => screen.getByRole('button', { name: /Commit Import/ });

describe('Import page', () => {
  beforeEach(() => mock());

  it('renders preview rows, statuses, parse errors, new-material note', async () => {
    await upload();
    expect(screen.getAllByTestId('preview-row')).toHaveLength(6);
    expect(post.mock.calls[0][0]).toBe('/imports/preview');
    expect(post.mock.calls[0][1].get('file').name).toBe('a.xlsx');
    expect(screen.getByText('Rows that could not be read (skipped)')).toBeInTheDocument();
    expect(screen.getByText(/Row 9: bad date/)).toBeInTheDocument();
    expect(screen.getByText(/1 new materials will be created with unit "TBD"/)).toBeInTheDocument();
    expect(screen.getByText('balance mismatch')).toBeInTheDocument();
    expect(screen.getByText('duplicate (skip)')).toBeInTheDocument();
    expect(screen.getAllByText('rejected')).toHaveLength(2);
    expect(screen.getByText('Insufficient stock')).toBeVisible();
    expect(screen.getByTestId('import-summary')).toHaveTextContent('6 rows read · 1 new materials · 3 will be created · 1 already imported (skipped) · 2 rejected — they will be skipped');
  });

  it('missing-rate row is editable; flips to new-material, updates counts, and body carries the rate', async () => {
    const user = await upload();
    expect(screen.queryByLabelText('Rate for r5')).toBeNull();
    const box = screen.getByLabelText('Rate for r4');
    await user.type(box, '12.5');
    expect(screen.getByTestId('import-summary')).toHaveTextContent('4 will be created · 1 already imported (skipped) · 1 rejected');
    await user.clear(box);
    expect(screen.getByTestId('import-summary')).toHaveTextContent('3 will be created');
    await user.type(box, '12.5');
    await user.click(commitBtn());
    const [url, body] = post.mock.calls.at(-1);
    expect(url).toBe('/imports/commit');
    expect(body.movements.find((m) => m.id === 'r4')).toMatchObject({ rate: 12.5, status: 'new-material' });
    expect(body.filename).toBe('a.xlsx');
    expect(body.materials).toHaveLength(1);
  });

  it('commit enabled iff at least one creatable row', async () => {
    mock({ ...PLAN, movements: [mv({ id: 'a', status: 'duplicate-skip' }), mv({ id: 'b', status: 'rejected', reason: 'IN requires a rate', rate: null })] });
    const user = await upload();
    expect(commitBtn()).toBeDisabled();
    await user.type(screen.getByLabelText('Rate for b'), '3');
    expect(commitBtn()).toBeEnabled();
  });

  it('shows the server response after commit, not client counts; history refreshes', async () => {
    const user = await upload();
    const gets = api.get.mock.calls.length;
    await user.click(commitBtn());
    const res = await screen.findByRole('region', { name: 'Import result' });
    expect(res).toHaveTextContent('30 created, 7 skipped, 5 failed (42 rows, 3 new materials)');
    expect(within(res).getByText(/unit TBD — fix on Materials page/)).toBeInTheDocument();
    expect(within(res).getByText('boom reason')).toBeInTheDocument();
    expect(within(res).getByText('skipped-duplicate')).toBeInTheDocument();
    expect(within(res).getByRole('link', { name: /Materials/ })).toHaveAttribute('href', '/materials');
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(gets));
    await user.click(screen.getByRole('button', { name: 'Import another file' }));
    expect(screen.queryByRole('region', { name: 'Import result' })).toBeNull();
  });

  it('renders import history', async () => {
    render(<MemoryRouter><Import /></MemoryRouter>);
    const row = (await screen.findByText('old.xlsx')).closest('tr');
    expect(within(row).getByText('Asha')).toBeInTheDocument();
    expect(row).toHaveTextContent('2025-01-01');
  });

  it('shows server error in an alert', async () => {
    api.post.mockRejectedValue({ response: { data: { message: 'Could not find a table in the document' } } });
    render(<MemoryRouter><Import /></MemoryRouter>);
    const user = userEvent.setup();
    await user.upload(document.querySelector('input[type=file]'), new File(['x'], 'a.docx'));
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not find a table');
  });
});
