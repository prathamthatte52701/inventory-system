// Reports page: Low Stock and Out of Stock downloads, filtered by the real backend.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN, adminApi, session, renderApp, uid, captureDownloads, blobBuffer, backendRequire } from './helpers';

const ExcelJS = backendRequire('exceljs');
const ids = async (blob) => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await blobBuffer(blob));
  const out = []; wb.worksheets[0].eachRow((r, i) => { if (i > 1) out.push(r.getCell(1).value); });
  return out;
};

describe('Reports: stock lists', () => {
  it('Low Stock and Out of Stock buttons download only their own materials; the valuation report is labelled', async () => {
    const api = await adminApi();
    const p = uid('SL');
    const mk = (suffix, q, min) => api.post('/materials', { materialId: `${p}-${suffix}`, description: suffix, unit: 'Nos', openingQuantity: q, openingRate: 2, minimumQuantity: min });
    await mk('OK', 100, 10); await mk('LOW', 5, 10); await mk('EDGE', 10, 10); await mk('ZERO', 0, 10);
    await session(ADMIN);
    const files = captureDownloads();
    renderApp('/reports');

    expect(await screen.findByText('Stock Value / Valuation Report')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download Low Stock (Excel)' }));
    await waitFor(() => expect(files).toHaveLength(1));
    expect(files[0].name).toMatch(/^low-stock-.*\.xlsx$/);
    const low = (await ids(files[0].blob)).filter((x) => x.startsWith(p));
    expect(low).toEqual([`${p}-EDGE`, `${p}-LOW`]);

    await userEvent.click(screen.getByRole('button', { name: 'Download Out of Stock (Excel)' }));
    await waitFor(() => expect(files).toHaveLength(2));
    expect(files[1].name).toMatch(/^out-of-stock-.*\.xlsx$/);
    expect((await ids(files[1].blob)).filter((x) => x.startsWith(p))).toEqual([`${p}-ZERO`]);
  });
});
