/**
 * Shared time helpers for Schichtzettel inline Ist-Zeit row.
 */

export function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToHm(totalMinutes: number): string {
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Paid hours as decimal string with German comma, e.g. "8,0 Std." */
export function formatArbeitsstundenDecimal(
  startTime: string,
  endTime: string,
  breakMinutes: number
): string {
  if (!startTime.trim() || !endTime.trim()) return '—';

  const startMin = parseTimeToMinutes(startTime);
  let endMin = parseTimeToMinutes(endTime);
  if (endMin < startMin) endMin += 24 * 60;

  const totalMin = endMin - startMin - Math.max(0, breakMinutes);
  if (totalMin <= 0) return '—';

  const hoursDecimal = totalMin / 60;
  return (
    new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    }).format(hoursDecimal) + ' Std.'
  );
}

export function calcArbeitsstundenDecimal(
  startTime: string,
  endTime: string,
  breakMinutes: number
): number | null {
  if (!startTime.trim() || !endTime.trim()) return null;

  const startMin = parseTimeToMinutes(startTime);
  let endMin = parseTimeToMinutes(endTime);
  if (endMin < startMin) endMin += 24 * 60;

  const totalMin = endMin - startMin - Math.max(0, breakMinutes);
  if (totalMin <= 0) return null;

  return totalMin / 60;
}

/** Center a single break block within the shift window for shift_events storage. */
export function breakMinutesToPair(
  startTime: string,
  endTime: string,
  breakMinutes: number
): Array<{ start: string; end: string }> | undefined {
  if (breakMinutes <= 0) return undefined;

  const startMin = parseTimeToMinutes(startTime);
  let endMin = parseTimeToMinutes(endTime);
  if (endMin < startMin) endMin += 24 * 60;

  const shiftLen = endMin - startMin;
  const effectiveBreak = Math.min(breakMinutes, Math.max(0, shiftLen - 1));
  if (effectiveBreak <= 0) return undefined;

  const breakStartMin =
    startMin + Math.max(0, Math.floor((shiftLen - effectiveBreak) / 2));
  const breakEndMin = breakStartMin + effectiveBreak;

  return [
    {
      start: minutesToHm(breakStartMin),
      end: minutesToHm(breakEndMin)
    }
  ];
}
