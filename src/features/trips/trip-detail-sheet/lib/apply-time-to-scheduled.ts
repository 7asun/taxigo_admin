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
