// Daily report: Reports page date picker + Dashboard shortcut (real backend).
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN, adminApi, session, renderApp, uid, captureDownloads, blobBuffer, backendRequire } from './helpers';
import api, { localToday } from '../src/api';

const ExcelJS = backendRequire('exceljs');

describe('daily report', () => {
  it('Reports downloads the chosen date and the file has that material row', async () => {
    const a = await adminApi();
    const id = uid('DR');
    const { data: m } = await a.post('/materials', { materialId: id, description: 'Daily', unit: 'Nos' });
    await a.post('/movements', { material: m._id, type: 'IN', quantity: 12, rate: 3, movementDate: '2026-04-11' });
    await session(ADMIN);
    const files = captureDownloads();
    const spy = vi.spyOn(api, 'get');
    renderApp('/reports');
    const input = await screen.findByLabelText('Date');
    expect(input.value).toBe(localToday());
    fireEvent.change(input, { target: { value: '2026-04-11' } });
    await userEvent.click(screen.getByRole('button', { name: 'Download Daily Report' }));
    await waitFor(() => expect(files).toHaveLength(1));
    expect(spy).toHaveBeenCalledWith('/reports/daily-summary', expect.objectContaining({ params: { date: '2026-04-11' } }));
    expect(files[0].name).toBe('daily-summary-2026-04-11.xlsx');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await blobBuffer(files[0].blob));
    const row = wb.worksheets[0].getRows(2, wb.worksheets[0].rowCount - 1).find((r) => r.getCell(1).value === id);
    expect(row.values.slice(4, 9)).toEqual([0, 12, 0, 12, 'Available']);
  });

  it('Dashboard shortcut requests today (local calendar date)', async () => {
    await session(ADMIN);
    const files = captureDownloads();
    const spy = vi.spyOn(api, 'get');
    renderApp('/');
    await screen.findByTestId('total-materials');
    await userEvent.click(screen.getByRole('button', { name: 'Daily Report' }));
    await waitFor(() => expect(files).toHaveLength(1));
    expect(spy).toHaveBeenCalledWith('/reports/daily-summary', expect.objectContaining({ params: { date: localToday() } }));
    expect(files[0].name).toBe(`daily-summary-${localToday()}.xlsx`);
  });

  it('localToday uses local calendar, not UTC', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 5, 23, 59)); // local 23:59
    expect(localToday()).toBe('2026-01-05');
    vi.useRealTimers();
  });
});
