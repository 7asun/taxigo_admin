/**
 * Standard currency rounding to 2 decimals — shared by trip pricing and catalog normalization.
 */
export function roundMoneyOnce(raw: number): number {
  return Math.round(raw * 100) / 100;
}
