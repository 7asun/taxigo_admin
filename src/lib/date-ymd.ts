import { format } from 'date-fns';

/** Parses `yyyy-MM-dd` to a local calendar `Date` (no UTC shift). */
export function parseYmdToLocalDate(ymd: string): Date | undefined {
  const t = ymd.trim();
  if (!t) return undefined;
  const [y, m, d] = t.split('-').map(Number);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return undefined;
  return new Date(y, m - 1, d);
}

/** Local calendar day as `yyyy-MM-dd` (matches `DatePicker` / invoice periods). */
export function formatLocalDateToYmd(d: Date): string {
  return format(
    new Date(d.getFullYear(), d.getMonth(), d.getDate()),
    'yyyy-MM-dd'
  );
}
