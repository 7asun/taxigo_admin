/**
 * normalise-invoice-number.ts
 *
 * why: payers write invoice numbers in at least five formats.
 * This module is the single normalisation point — all downstream code
 * receives canonical RE-YYYY-MM-NNNN strings only.
 * Branch B is evaluated first because its pattern is more specific;
 * Branch A would also match the separated portion of a no-separator string
 * if evaluated first.
 *
 * Supported formats → canonical output:
 *   RE-2026-04-0004   → RE-2026-04-0004  (Branch A — canonical, unchanged)
 *   R:2026-04-0004    → RE-2026-04-0004  (Branch A — colon-prefix variant)
 *   RE 2026-04-0004   → RE-2026-04-0004  (Branch A — space-separator variant)
 *   RE2026-04-0004    → RE-2026-04-0004  (Branch A — no separator after prefix)
 *   RE2026040004      → RE-2026-04-0004  (Branch B — no separators at all)
 */

// ── Branch B — No-separator variant ─────────────────────────────────────────
// Matches RE or re followed immediately by 4-digit year, 2-digit month, 4-digit
// sequence number with no intervening separators.
// \b before RE/re and after the 10 digits prevents partial matches inside
// longer unrelated digit runs.
const BRANCH_B_REGEX = /\b[Rr][Ee](\d{4})(\d{2})(\d{4})\b/g;

// ── Branch A — Separated variants ────────────────────────────────────────────
// Matches any of: RE-, R:, RE<space>, RE directly followed by the year+separators.
// Capture group 1 always contains YYYY-MM-NNNN.
const BRANCH_A_REGEX = /\b[Rr][Ee]?[-:\s]?(\d{4}-\d{2}-\d{4})\b/g;

/**
 * Extracts all invoice-number variants from `raw` and returns them as
 * canonical RE-YYYY-MM-NNNN strings, deduplicated.
 */
export function extractAndNormaliseInvoiceNumbers(raw: string): string[] {
  const seen = new Set<string>();

  // Branch B first — RE followed by 10 contiguous digits (more specific)
  for (const match of raw.matchAll(new RegExp(BRANCH_B_REGEX.source, 'g'))) {
    const [, year, month, seq] = match;
    seen.add(`RE-${year}-${month}-${seq}`);
  }

  // Branch A second — RE/R: prefix with YYYY-MM-NNNN numeric core already separated
  for (const match of raw.matchAll(new RegExp(BRANCH_A_REGEX.source, 'g'))) {
    const [, core] = match;
    seen.add(`RE-${core}`);
  }

  return [...seen];
}
