import { differenceInCalendarDays, differenceInHours, parseISO } from 'date-fns';

export function getAppNow(): Date {
  const envNow = process.env.APP_NOW;
  if (envNow) {
    const parsed = new Date(envNow);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

export function parseDateFlexible(val: string | Date): Date {
  if (val instanceof Date) return val;
  if (!val || typeof val !== 'string') return new Date(NaN);

  const trimmed = val.trim();

  // Try standard ISO or YYYY-MM-DD / YYYY-MM-DD HH:MM
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    // If it has space like '2026-11-02 08:10', replace space with 'T'
    const normalized = trimmed.replace(' ', 'T');
    const parsed = parseISO(normalized);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  // Try DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const parsed = new Date(year, month, day);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  const native = new Date(trimmed);
  return native;
}

export function toCalendarDateString(val: string | Date): string {
  const date = parseDateFlexible(val);
  if (isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCalendarDaysDiff(dateA: string | Date, dateB: string | Date): number {
  const dA = parseDateFlexible(dateA);
  const dB = parseDateFlexible(dateB);
  return differenceInCalendarDays(dA, dB);
}

export function getHoursDiff(dateA: string | Date, dateB: string | Date): number {
  const dA = parseDateFlexible(dateA);
  const dB = parseDateFlexible(dateB);
  return differenceInHours(dA, dB);
}
