/**
 * Helpers for Angebot line-item text cells stored as Tiptap HTML (bold, etc.).
 * Keeps parity with `templateContentToHtml` in angebot-tiptap-field (HTML detection).
 */

/**
 * True when the string likely contains HTML markup (Tiptap / pasted).
 *
 * Matches tags anywhere in the string so leading NBSP/indent before `<p>` still counts.
 * Avoids casual "a < b" (`<` not followed by a tag name start).
 */
export function looksLikeRichTextHtml(s: string): boolean {
  const t = s.replace(/^\uFEFF/, '').trim();
  if (!t) return false;
  return /<(?:\/\s*)?[a-z][a-z0-9:-]*(?:\s[^>]*)?>/i.test(t);
}

/** Empty document / whitespace-only visible text — maps to DB null. */
export function isEffectivelyEmptyRichText(html: string): boolean {
  if (typeof document === 'undefined') {
    const c = html.replace(/\s/g, '');
    return c === '' || c === '<p></p>' || c === '<p><br></p>';
  }
  const el = document.createElement('div');
  el.innerHTML = html;
  return (el.textContent ?? '').trim() === '';
}

/** Escape plain text for embedding in HTML fragments (PDF / safety). */
export function escapeXmlForHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * HTML fragment for an Angebot PDF table cell (`pdfRenderType === 'text'`).
 * Rich markup from Tiptap is passed through; plain text is wrapped in a safe `<p>`.
 */
export function angebotTextCellHtmlForPdf(raw: string): string | null {
  if (!raw.trim()) return null;
  if (looksLikeRichTextHtml(raw)) return raw;
  return `<p>${escapeXmlForHtml(raw).replace(/\n/g, '<br />')}</p>`;
}

/** Preview plain text in non-rendering contexts (computed cells, etc.). */
export function plainTextFromPossibleHtml(s: string): string {
  if (!looksLikeRichTextHtml(s)) return s;
  if (typeof document === 'undefined') {
    return s
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const el = document.createElement('div');
  el.innerHTML = s;
  return (el.textContent ?? '').trim();
}
