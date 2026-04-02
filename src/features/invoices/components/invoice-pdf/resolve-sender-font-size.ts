/**
 * Absenderzeile: single-line fit — shrink font before truncating (Helvetica ~0.45–0.5 em avg width).
 * Max usable width ≈ 52% of A4 content (~268 pt at 45+45 margin).
 */

const MAX_LINE_WIDTH_PT = 268;
const MIN_PT = 6;
const FONT_CANDIDATES = [7.5, 7, 6.5, 6] as const;

/** Approximate chars that fit at given font size (pt) on one line. */
function approxMaxChars(fontPt: number): number {
  const avgCharWidthPt = fontPt * 0.48;
  return Math.max(20, Math.floor(MAX_LINE_WIDTH_PT / avgCharWidthPt));
}

export interface FitSenderLineResult {
  line: string;
  fontSize: number;
}

/**
 * Returns display line and font size so the Absenderzeile stays on one line.
 * Truncates with "…" only if still too long at {@link MIN_PT}.
 */
export function fitSenderLine(raw: string): FitSenderLineResult {
  const text = raw.trim();
  if (!text) return { line: '', fontSize: 7 };

  for (const fs of FONT_CANDIDATES) {
    const max = approxMaxChars(fs);
    if (text.length <= max) {
      return { line: text, fontSize: fs };
    }
  }

  const max = approxMaxChars(MIN_PT);
  if (text.length <= max) {
    return { line: text, fontSize: MIN_PT };
  }

  return {
    line: `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`,
    fontSize: MIN_PT
  };
}
