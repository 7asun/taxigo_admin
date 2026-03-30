/** Keeps calendar day from `scheduledIso`, replaces clock time with `HH:mm`. */
export function applyTimeToScheduledDate(
  scheduledIso: string,
  timeHHmm: string
): Date {
  const d = new Date(scheduledIso);
  const [hStr, mStr] = timeHHmm.split(':');
  const h = parseInt(hStr ?? '0', 10);
  const m = parseInt(mStr ?? '0', 10);
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

/** Local calendar `yyyy-MM-dd` + `HH:mm` → `Date` (same basis as details PATCH). */
export function buildScheduledAtFromYmdAndHm(
  dateYmd: string,
  timeHHmm: string
): Date {
  const [y, mo, d] = dateYmd.split('-').map((x) => parseInt(x, 10));
  const next = new Date(y, mo - 1, d);
  const [hh, mm] = timeHHmm.split(':').map((x) => parseInt(x, 10));
  next.setHours(
    Number.isFinite(hh) ? hh : 0,
    Number.isFinite(mm) ? mm : 0,
    0,
    0
  );
  return next;
}
