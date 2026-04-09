/**
 * angebot-pdf-columns.ts
 *
 * Column definitions for the Angebot PDF line-items table.
 * Self-contained — does not extend or depend on the invoice pdf-column-catalog.
 *
 * Portrait A4 usable width: 515 pt (same as invoice PDFs).
 * Column widths must sum to ≤ 515 pt across the active profile.
 */

import type { AngebotColumnKey } from '../../types/angebot.types';

export interface AngebotColumnDef {
  key: AngebotColumnKey;
  /** German column header rendered in the PDF table */
  label: string;
  /** Default column width in PDF points for portrait A4 */
  defaultWidthPt: number;
  /** Minimum column width — never shrink below this regardless of column count */
  minWidthPt: number;
  /** Text alignment in the PDF cell */
  align: 'left' | 'right' | 'center';
  /** How the raw value is formatted */
  format: 'integer' | 'text' | 'currency' | 'currency_per_km';
}

export const ANGEBOT_COLUMN_CATALOG: AngebotColumnDef[] = [
  {
    key: 'position',
    label: 'Pos.',
    defaultWidthPt: 28,
    minWidthPt: 24,
    align: 'center',
    format: 'integer'
  },
  {
    key: 'leistung',
    label: 'Leistung',
    defaultWidthPt: 220,
    minWidthPt: 100,
    align: 'left',
    format: 'text'
  },
  {
    key: 'anfahrtkosten',
    label: 'Anfahrtkosten',
    defaultWidthPt: 80,
    minWidthPt: 52,
    align: 'center',
    format: 'currency'
  },
  {
    key: 'price_first_5km',
    label: 'erste 5 km (je km)',
    defaultWidthPt: 80,
    minWidthPt: 52,
    align: 'center',
    format: 'currency_per_km'
  },
  {
    key: 'price_per_km_after_5',
    label: 'ab 5 km (je km)',
    defaultWidthPt: 80,
    minWidthPt: 52,
    align: 'center',
    format: 'currency_per_km'
  },
  {
    key: 'notes',
    label: 'Hinweis',
    defaultWidthPt: 120,
    minWidthPt: 80,
    align: 'left',
    format: 'text'
  }
];

export const ANGEBOT_COLUMN_MAP: Record<AngebotColumnKey, AngebotColumnDef> =
  Object.fromEntries(
    ANGEBOT_COLUMN_CATALOG.map((col) => [col.key, col])
  ) as Record<AngebotColumnKey, AngebotColumnDef>;

const PORTRAIT_USABLE_PT = 515;

/**
 * Distributes usable portrait width proportionally across the active columns.
 * Respects minWidthPt for each column. Mirrors calcColumnWidths in pdf-column-layout.ts.
 *
 * @param columnKeys - Ordered list of column keys to include.
 * @returns Map from column key to computed width in PDF points.
 */
export function calcAngebotColumnWidths(
  columnKeys: AngebotColumnKey[]
): Record<AngebotColumnKey, number> {
  const defs = columnKeys.map(
    (k) => ANGEBOT_COLUMN_MAP[k] ?? ANGEBOT_COLUMN_CATALOG[0]
  );

  const minTotal = defs.reduce((sum, d) => sum + d.minWidthPt, 0);
  const defaultTotal = defs.reduce((sum, d) => sum + d.defaultWidthPt, 0);
  const available = PORTRAIT_USABLE_PT;

  const result: Partial<Record<AngebotColumnKey, number>> = {};

  if (defaultTotal <= available) {
    // Enough space — use defaults as-is
    defs.forEach((d) => {
      result[d.key] = d.defaultWidthPt;
    });
  } else if (minTotal <= available) {
    // Scale between min and default proportionally
    const extra = available - minTotal;
    const flexTotal = defaultTotal - minTotal;
    defs.forEach((d) => {
      const flex = d.defaultWidthPt - d.minWidthPt;
      result[d.key] =
        d.minWidthPt + (flexTotal > 0 ? (flex / flexTotal) * extra : 0);
    });
  } else {
    // Fall back to equal distribution
    const equalWidth = Math.floor(available / defs.length);
    defs.forEach((d) => {
      result[d.key] = equalWidth;
    });
  }

  return result as Record<AngebotColumnKey, number>;
}
