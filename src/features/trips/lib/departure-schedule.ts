/**
 * Create-trip departure: calendar day (yyyy-MM-dd, local) + optional HH:mm,
 * aligned with bulk CSV `parseDateAndTime` → `scheduled_at` / `requested_date`.
 */

export function parseYmdToLocalDate(ymd: string): Date | undefined {
  const t = ymd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return undefined;
  const [y, m, d] = t.split('-').map(Number);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return undefined;
  return new Date(y, m - 1, d);
}

export function formatLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function combineDepartureForTripInsert(
  departureDateYmd: string,
  departureTimeHhmm: string
): { scheduled_at: string | null; requested_date: string | null } {
  const ymd = departureDateYmd.trim();
  if (!ymd) {
    return { scheduled_at: null, requested_date: null };
  }

  const base = parseYmdToLocalDate(ymd);
  if (!base) {
    return { scheduled_at: null, requested_date: null };
  }

  const requested_date = ymd;
  const timePart = departureTimeHhmm.trim();
  if (!timePart) {
    return { scheduled_at: null, requested_date };
  }

  const parts = timePart.split(':');
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return { scheduled_at: null, requested_date };
  }

  const full = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    hours,
    minutes,
    0,
    0
  );
  if (Number.isNaN(full.getTime())) {
    return { scheduled_at: null, requested_date };
  }

  return { scheduled_at: full.toISOString(), requested_date };
}
