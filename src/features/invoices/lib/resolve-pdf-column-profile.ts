/**
 * resolve-pdf-column-profile.ts
 *
 * Pure function (no I/O): given optional override + Vorlage rows, returns the **`PdfColumnProfile`**
 * that wins the priority chain. Callers load data from Supabase and pass it in.
 *
 * **4-level priority (first tier that yields both non-empty `main_columns` and `appendix_columns`):**
 * 1. **Invoice override** — `invoices.pdf_column_override` (builder Step 4 “Spalten anpassen”).
 *    Wins when the payload has valid main + appendix key arrays after `sanitizeKeys`.
 * 2. **Kostenträger Vorlage** — `payers.pdf_vorlage_id` → `pdf_vorlagen` row (assigned in payer settings).
 * 3. **Company default** — `pdf_vorlagen.is_default = true` for the tenant.
 * 4. **System fallback** — `SYSTEM_DEFAULT_MAIN_COLUMNS` + `SYSTEM_DEFAULT_APPENDIX_COLUMNS`
 *    (grouped layout; legacy 5-column main table).
 *
 * **`sanitizeKeys`** drops keys that are not in {@link PDF_COLUMN_MAP} (typos / removed catalog entries)
 * and **deduplicates** (first occurrence wins).
 * It does **not** filter by `flatOnly` / `groupedOnly` / `main_layout`. **The resolver preserves user
 * intent:** column order from stored arrays is preserved (minus unknown keys and duplicate keys).
 * Layout compatibility filtering happens only at **render time** in `InvoicePdfCoverBody` via
 * `mainTableKeys`, so saved JSON is never silently rewritten here.
 *
 * **`appendix_is_landscape`** is derived when `appendix_columns.length > APPENDIX_LANDSCAPE_THRESHOLD` (7).
 *
 * @see pdf-vorlagen.api.ts — persistence and row mapping
 */

import {
  APPENDIX_LANDSCAPE_THRESHOLD,
  PDF_COLUMN_MAP,
  SYSTEM_DEFAULT_APPENDIX_COLUMNS,
  SYSTEM_DEFAULT_MAIN_COLUMNS,
  type PdfColumnKey
} from '@/features/invoices/lib/pdf-column-catalog';
import type {
  PdfColumnOverridePayload,
  PdfColumnProfile,
  PdfVorlageRow
} from '@/features/invoices/types/pdf-vorlage.types';

/** Keeps only known keys in first-seen order, deduplicated; does not apply layout rules. */
function sanitizeKeys(keys: string[] | undefined): PdfColumnKey[] {
  if (!keys?.length) return [];
  const seen = new Set<string>();
  const out: PdfColumnKey[] = [];
  for (const k of keys) {
    if (PDF_COLUMN_MAP[k] && !seen.has(k)) {
      seen.add(k);
      out.push(k as PdfColumnKey);
    }
  }
  return out;
}

/**
 * Builds the effective profile: columns, main_layout, landscape flag, source label.
 *
 * @param override — parsed pdf_column_override or null
 * @param payerVorlage — pdf_vorlagen row for payer.pdf_vorlage_id or null
 * @param companyDefaultVorlage — company default Vorlage row or null
 * @returns PdfColumnProfile for PDF rendering and preview
 */
export function resolvePdfColumnProfile(
  override: PdfColumnOverridePayload | null,
  payerVorlage: PdfVorlageRow | null,
  companyDefaultVorlage: PdfVorlageRow | null
): PdfColumnProfile {
  let main: PdfColumnKey[] = [];
  let appendix: PdfColumnKey[] = [];
  let source: PdfColumnProfile['source'] = 'system';
  let main_layout: PdfColumnProfile['main_layout'] = 'grouped';

  if (override?.main_columns?.length && override.appendix_columns?.length) {
    const m = sanitizeKeys(override.main_columns);
    const a = sanitizeKeys(override.appendix_columns);
    if (m.length && a.length) {
      main = m;
      appendix = a;
      source = 'invoice_override';
      main_layout = override.main_layout ?? 'grouped';
    }
  }

  if (!main.length || !appendix.length) {
    const v = payerVorlage;
    if (v) {
      const m = sanitizeKeys(v.main_columns);
      const a = sanitizeKeys(v.appendix_columns);
      if (m.length && a.length) {
        main = m;
        appendix = a;
        source = 'payer_vorlage';
        main_layout = v.main_layout;
      }
    }
  }

  if (!main.length || !appendix.length) {
    const v = companyDefaultVorlage;
    if (v) {
      const m = sanitizeKeys(v.main_columns);
      const a = sanitizeKeys(v.appendix_columns);
      if (m.length && a.length) {
        main = m;
        appendix = a;
        source = 'company_default';
        main_layout = v.main_layout;
      }
    }
  }

  if (!main.length) {
    main = [...SYSTEM_DEFAULT_MAIN_COLUMNS];
  }
  if (!appendix.length) {
    appendix = [...SYSTEM_DEFAULT_APPENDIX_COLUMNS];
  }

  if (source === 'system') {
    main_layout = 'grouped';
  }

  const appendix_is_landscape = appendix.length > APPENDIX_LANDSCAPE_THRESHOLD;

  return {
    main_columns: main,
    appendix_columns: appendix,
    main_layout,
    appendix_is_landscape,
    source
  };
}
