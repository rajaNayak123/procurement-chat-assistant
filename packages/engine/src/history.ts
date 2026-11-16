import { POHistoryRow, SupplierMaster } from './types.js';
import { getCalendarDaysDiff } from './utils/dates.js';

export function getPOsInWindow(
  history: POHistoryRow[],
  itemCode: string,
  asOfDate: string, // YYYY-MM-DD
  lookbackDays: number = 365
): POHistoryRow[] {
  const code = itemCode.toUpperCase();
  return history.filter((po) => {
    if (po.item_code.toUpperCase() !== code) return false;
    // Strictly before the asOfDate
    const daysDiff = getCalendarDaysDiff(asOfDate, po.po_date);
    return daysDiff > 0 && daysDiff <= lookbackDays;
  });
}

export function getMostRecentPO(
  history: POHistoryRow[],
  itemCode: string,
  asOfDate: string,
  lookbackDays: number = 365
): POHistoryRow | null {
  const pos = getPOsInWindow(history, itemCode, asOfDate, lookbackDays);
  if (pos.length === 0) return null;

  // Sort descending by po_date, then po_number descending
  pos.sort((a, b) => {
    const dDiff = getCalendarDaysDiff(b.po_date, a.po_date);
    if (dDiff !== 0) return dDiff;
    // If equal dates, tie-break by higher po_number (e.g. Example 11)
    return b.po_number.localeCompare(a.po_number, undefined, { numeric: true });
  });

  return pos[0];
}

export function hasBoughtFromActiveSupplier(
  history: POHistoryRow[],
  suppliers: SupplierMaster[],
  itemCode: string,
  asOfDate: string,
  days: number = 365
): boolean {
  const activeSupplierIds = new Set(
    suppliers.filter((s) => s.status === 'Active').map((s) => s.supplier_id)
  );

  const pos = getPOsInWindow(history, itemCode, asOfDate, days);
  return pos.some((po) => activeSupplierIds.has(po.supplier_id));
}
