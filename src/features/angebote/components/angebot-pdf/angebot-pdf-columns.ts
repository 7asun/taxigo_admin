/**
 * angebot-pdf-columns.ts
 *
 * Column definitions for the Angebot PDF line-items table (legacy catalog + dynamic schema widths).
 * Self-contained catalog — does not extend the invoice pdf-column-catalog.
 *
 * Portrait: invoice main table uses 499pt inner width (pdf-column-layout — after tableHeader paddingHorizontal 8×2).
 * Angebot uses ANGEBOT_PDF_AVAILABLE_WIDTH (515pt): the offer table follows the established Angebot layout and
 * styles.angebotPage padding (45+45) differs from how invoice rows inset their cells — verify pdf-styles
 * `angebotPage` / `tableHeader` when adjusting this constant.
 */

import type {
  AngebotColumnDef,
  AngebotColumnKey
} from '../../types/angebot.types';
import { resolveColumnLayout } from '../../lib/angebot-column-presets';

export interface AngebotPdfCatalogColumnDef {
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

/*
 * Legacy fallback. Used by AngebotPdfDocument when table_schema_snapshot is null (pre-Phase-2a offers). Do not remove until all offers have a snapshot.
 */
export const ANGEBOT_COLUMN_CATALOG: AngebotPdfCatalogColumnDef[] = [
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

export const ANGEBOT_COLUMN_MAP: Record<
  AngebotColumnKey,
  AngebotPdfCatalogColumnDef
> = Object.fromEntries(
  ANGEBOT_COLUMN_CATALOG.map((col) => [col.key, col])
) as Record<AngebotColumnKey, AngebotPdfCatalogColumnDef>;

/** Usable table width (pt) — same constant for calcAngebotColumnWidths, tests, and settings live preview. */
export const ANGEBOT_PDF_AVAILABLE_WIDTH = 515;

/**
 * Legacy width calc: distributes usable portrait width using catalog defaultWidthPt / minWidthPt.
 * Differs from {@link calcAngebotColumnWidths} (dynamic schema): invoice-style default scaling vs weight + minWidth redistribution.
 */
export function calcAngebotPdfCatalogColumnWidths(
  columnKeys: AngebotColumnKey[]
): Record<AngebotColumnKey, number> {
  const defs = columnKeys.map(
    (k) => ANGEBOT_COLUMN_MAP[k] ?? ANGEBOT_COLUMN_CATALOG[0]
  );

  const minTotal = defs.reduce((sum, d) => sum + d.minWidthPt, 0);
  const defaultTotal = defs.reduce((sum, d) => sum + d.defaultWidthPt, 0);
  const available = ANGEBOT_PDF_AVAILABLE_WIDTH;

  const result: Partial<Record<AngebotColumnKey, number>> = {};

  if (defaultTotal <= available) {
    defs.forEach((d) => {
      result[d.key] = d.defaultWidthPt;
    });
  } else if (minTotal <= available) {
    const extra = available - minTotal;
    const flexTotal = defaultTotal - minTotal;
    defs.forEach((d) => {
      const flex = d.defaultWidthPt - d.minWidthPt;
      result[d.key] =
        d.minWidthPt + (flexTotal > 0 ? (flex / flexTotal) * extra : 0);
    });
  } else {
    const equalWidth = Math.floor(available / defs.length);
    defs.forEach((d) => {
      result[d.key] = equalWidth;
    });
  }

  return result as Record<AngebotColumnKey, number>;
}

/**
 * Weight + minWidth based widths for dynamic templates.
 * Deviates from invoice `calcColumnWidths` / {@link calcAngebotPdfCatalogColumnWidths}: those scale catalog defaults;
 * this uses proportional weights with minWidth floors plus overflow / spare redistribution.
 */
export function calcAngebotColumnWidths(
  columns: AngebotColumnDef[]
): Record<string, number> {
  const available = ANGEBOT_PDF_AVAILABLE_WIDTH;

  if (columns.length === 0) return {};

  // Step 1: Resolve layout spec for every column via resolveColumnLayout — never read col.preset directly
  const specs = columns.map((col) => ({ col, spec: resolveColumnLayout(col) }));

  // Step 2: Partition columns into fixed and flex groups
  const fixed = specs.filter((x) => x.spec.width.mode === 'fixed');
  const flex = specs.filter((x) => x.spec.width.mode === 'flex');

  // Step 3: fixedTotal = sum of all fixed column pt values
  const fixedTotal = fixed.reduce(
    (sum, x) => sum + (x.spec.width.mode === 'fixed' ? x.spec.width.pt : 0),
    0
  );

  // Step 4: remaining = ANGEBOT_PDF_AVAILABLE_WIDTH (515) − fixedTotal
  const remaining = available - fixedTotal;

  const widths: Record<string, number> = {};

  // Step 5: If remaining <= 0 → console.warn, scale all fixed widths proportionally to fit 515, return early
  if (remaining <= 0) {
    console.warn(
      '[calcAngebotColumnWidths] Fixed columns exceed available width; scaling fixed widths.'
    );
    const raw = fixed.map((x) => ({
      id: x.col.id,
      pt: x.spec.width.mode === 'fixed' ? x.spec.width.pt : 0
    }));
    const sumFixed = raw.reduce((s, x) => s + x.pt, 0);
    const scale = sumFixed > 0 ? available / sumFixed : 1;
    raw.forEach((x) => {
      widths[x.id] = Math.max(1, Math.floor(x.pt * scale));
    });
    const sum = Object.values(widths).reduce((s, v) => s + v, 0);
    const delta = available - sum;
    if (raw.length > 0) {
      const widestId = raw.reduce((acc, x) => {
        return (widths[x.id] ?? 0) > (widths[acc] ?? 0) ? x.id : acc;
      }, raw[0]!.id);
      widths[widestId] = Math.max(1, (widths[widestId] ?? 0) + delta);
    }
    return widths;
  }

  fixed.forEach((x) => {
    if (x.spec.width.mode === 'fixed') widths[x.col.id] = x.spec.width.pt;
  });

  // Step 6: flexTotal = sum of all flex values among flex columns
  const flexTotal = flex.reduce(
    (sum, x) => sum + (x.spec.width.mode === 'flex' ? x.spec.width.flex : 0),
    0
  );
  const safeFlexTotal = flexTotal > 0 ? flexTotal : flex.length;

  // Step 7: If no flex columns → distribute remaining to widest fixed column, return
  if (flex.length === 0) {
    if (fixed.length > 0) {
      const widestId = fixed.reduce((acc, x) => {
        const id = x.col.id;
        return (widths[id] ?? 0) > (widths[acc] ?? 0) ? id : acc;
      }, fixed[0]!.col.id);
      widths[widestId] = Math.max(1, (widths[widestId] ?? 0) + remaining);
    }
    return widths;
  }

  // Step 8: Each flex column width = Math.floor((col.flex / flexTotal) * remaining)
  flex.forEach((x) => {
    const f = x.spec.width.mode === 'flex' ? x.spec.width.flex : 0;
    widths[x.col.id] = Math.max(1, Math.floor((f / safeFlexTotal) * remaining));
  });

  // Step 9: floatRemainder = 515 − (fixedTotal + sum of floored flex widths) → add to highest-flex column
  const assigned = Object.values(widths).reduce((s, v) => s + v, 0);
  const floatRemainder = available - assigned;
  const highestFlexId = flex.reduce((accId, x) => {
    const id = x.col.id;
    const v = x.spec.width.mode === 'flex' ? x.spec.width.flex : 0;
    const acc = flex.find((y) => y.col.id === accId);
    const accV = acc?.spec.width.mode === 'flex' ? acc.spec.width.flex : 0;
    return v > accV ? id : accId;
  }, flex[0]!.col.id);
  widths[highestFlexId] = Math.max(
    1,
    (widths[highestFlexId] ?? 0) + floatRemainder
  );

  // Step 10: Assert sum === 515 (console.error if not — never silently wrong)
  const finalSum = Object.values(widths).reduce((s, v) => s + v, 0);
  if (finalSum !== available) {
    console.error(
      `[calcAngebotColumnWidths] width sum mismatch: ${finalSum} != ${available}`
    );
  }

  // Step 11: Return complete width map — every column id present, every value a positive integer
  for (const c of columns) {
    widths[c.id] = Math.max(1, Math.trunc(widths[c.id] ?? 1));
  }
  return widths;
}
