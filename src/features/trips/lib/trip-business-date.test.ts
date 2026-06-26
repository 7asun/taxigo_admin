import { describe, expect, it } from 'bun:test';

import { getNextBusinessDayYmd } from './trip-business-date';

describe('getNextBusinessDayYmd', () => {
  it('Monday → Tuesday', () =>
    expect(getNextBusinessDayYmd('2026-06-29')).toBe('2026-06-30'));
  it('Tuesday → Wednesday', () =>
    expect(getNextBusinessDayYmd('2026-06-30')).toBe('2026-07-01'));
  it('Wednesday → Thursday', () =>
    expect(getNextBusinessDayYmd('2026-07-01')).toBe('2026-07-02'));
  it('Thursday → Friday', () =>
    expect(getNextBusinessDayYmd('2026-07-02')).toBe('2026-07-03'));
  it('Friday → Monday', () =>
    expect(getNextBusinessDayYmd('2026-07-03')).toBe('2026-07-06'));
  it('Saturday → Monday', () =>
    expect(getNextBusinessDayYmd('2026-07-04')).toBe('2026-07-06'));
  it('Sunday → Monday', () =>
    expect(getNextBusinessDayYmd('2026-07-05')).toBe('2026-07-06'));
});
