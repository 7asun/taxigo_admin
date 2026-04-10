/**
 * Parse frozen `rechnungsempfaenger_snapshot` JSON for PDF address blocks.
 */

export interface PdfCoverRecipient {
  companyName: string;
  personName: string;
  displayName: string;
  street: string;
  streetNumber: string;
  zipCode: string;
  city: string;
  phone: string | null;
  /** Optional second address line (e.g. c/o) */
  addressLine2: string | null;
  /** Structured name fields for salutation */
  anrede: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Department/Abteilung for address block */
  abteilung: string | null;
}

export interface PdfSecondaryLegalRecipient {
  label: string;
  displayName: string;
  lines: string[];
}

/**
 * Single-line address / phone fields: NBSP, ZWSP, newlines → normal space, collapsed.
 * Prevents react-pdf from breaking extra lines inside one {@link Text} with unnormalized data.
 */
export function collapseWhitespaceForPdf(
  value: string | null | undefined
): string {
  if (value == null || typeof value !== 'string') return '';
  return value
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function str(v: unknown): string {
  return typeof v === 'string' ? collapseWhitespaceForPdf(v) : '';
}

/** Drop a lone leading dash / dot block before the first digit (PDF kerning looked like “-” through “0”). */
function stripLeadingDashBeforeFirstDigit(s: string): string {
  const i = s.search(/\d/);
  if (i <= 0) return s;
  const prefix = s.slice(0, i);
  if (/^[\s.\-–—‐‑‒―]+$/u.test(prefix)) {
    return s.slice(i).trimStart();
  }
  return s;
}

/** Remove anything after the last ASCII digit (trailing comma, “,” variants, full stop). */
function stripTrailingAfterLastDigit(s: string): string {
  let last = -1;
  for (let j = 0; j < s.length; j++) {
    const c = s[j]!;
    if (c >= '0' && c <= '9') last = j;
  }
  if (last < 0) return s;
  return s.slice(0, last + 1).trimEnd();
}

/**
 * Normalizes Rechnungsempfänger (or client) phone for PDF/UI: collapses whitespace,
 * strips invisible chars, removes comma-like glyphs, leading orphan dashes, and
 * trailing punctuation after the last digit.
 */
export function normalizeInvoiceRecipientPhone(
  value: string | null | undefined
): string | null {
  if (value == null || typeof value !== 'string') return null;
  let s = collapseWhitespaceForPdf(value);
  if (!s) return null;
  // Common + obscure comma / separator glyphs from Excel, macOS, Unicode
  s = s.replace(
    /[\u002C\uFF0C\u201A\uFE50\u060C\u3001\u037E\u00B7\u2219\u22C5]/g,
    ''
  );
  s = s.replace(/^[,;.:·\s]+|[,;.:·\s]+$/g, '').trim();
  s = stripLeadingDashBeforeFirstDigit(s);
  s = stripTrailingAfterLastDigit(s);
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > 0 ? s : null;
}

/** Trailing " -" / " –" often appears when Tel. was split onto the next line in Stammdaten. */
function trimTrailingAddressJoiner(s: string): string {
  return s.replace(/\s*[-–—]\s*$/u, '').trim();
}

/**
 * Returns a window-address shape from snapshot, or null if empty / invalid.
 */
export function recipientFromRechnungsempfaengerSnapshot(
  snap: Record<string, unknown> | null | undefined
): PdfCoverRecipient | null {
  if (!snap || typeof snap !== 'object') return null;
  const name = str(snap.name);
  const a1 = str(snap.address_line1);
  const a2 = str(snap.address_line2);
  const pc = trimTrailingAddressJoiner(
    str(snap.postal_code).replace(/,/g, '').trim()
  );
  const city = trimTrailingAddressJoiner(
    str(snap.city).replace(/,/g, '').trim()
  );
  const phone = normalizeInvoiceRecipientPhone(str(snap.phone));
  const anrede = str(snap.anrede) || null;
  const firstName = str(snap.first_name) || null;
  const lastName = str(snap.last_name) || null;
  const companyName = str(snap.company_name);
  const abteilung = str(snap.abteilung) || null;
  if (!name && !a1 && !pc && !city) return null;

  // Build display name from structured fields if available
  let displayName = name || a1 || 'Rechnungsempfänger';
  if (companyName) {
    displayName = companyName;
  } else if (anrede || firstName || lastName) {
    const parts = [anrede, firstName, lastName].filter(Boolean);
    if (parts.length > 0) {
      displayName = parts.join(' ');
    }
  }

  return {
    companyName: companyName || '',
    personName: name,
    displayName,
    street: a1,
    streetNumber: '',
    zipCode: pc,
    city,
    phone: phone || null,
    addressLine2: a2 || null,
    anrede,
    firstName,
    lastName,
    abteilung
  };
}

/**
 * Generate salutation from snapshot data.
 * Priority: 1) anrede + last_name, 2) last_name with gender detection, 3) default
 */
export function salutationFromSnapshot(
  snap: Record<string, unknown> | null | undefined,
  defaultSalutation = 'Sehr geehrte Damen und Herren,'
): string {
  if (!snap || typeof snap !== 'object') return defaultSalutation;

  const anrede = str(snap.anrede);
  const lastName = str(snap.last_name);

  // If we have anrede and last_name, use them
  if (anrede && lastName) {
    const normalized = anrede.toLowerCase();
    if (normalized === 'herr') {
      return `Sehr geehrter Herr ${lastName},`;
    } else if (normalized === 'frau') {
      return `Sehr geehrte Frau ${lastName},`;
    } else {
      // Custom anrede (e.g., Dr., Prof.)
      return `Sehr geehrte${anrede.toLowerCase().startsWith('herr') ? 'r' : ''} ${anrede} ${lastName},`;
    }
  }

  // If only last_name, try to detect from first_name
  if (lastName) {
    const firstName = str(snap.first_name);
    // Common German first name patterns (very basic)
    const maleIndicators = ['mann', 'bert', 'fried', 'hard', 'winf'];
    const femaleIndicators = ['linde', 'gunde', 'trude', 'friede', 'hilde'];
    const fnLower = firstName.toLowerCase();
    const isLikelyMale = maleIndicators.some((ind) => fnLower.endsWith(ind));
    const isLikelyFemale = femaleIndicators.some((ind) =>
      fnLower.endsWith(ind)
    );

    if (isLikelyMale) {
      return `Sehr geehrter Herr ${lastName},`;
    } else if (isLikelyFemale) {
      return `Sehr geehrte Frau ${lastName},`;
    }
  }

  return defaultSalutation;
}

/**
 * Build Briefkopf address lines in German format.
 * Order: Firmenname → First + Lastname → Abteilung → Street → Zip + City → Phone
 */
export function buildBriefkopfLines(r: PdfCoverRecipient | null): string[] {
  if (!r) return [];
  const lines: string[] = [];

  // 1. Firmenname (if exists)
  if (r.companyName) {
    lines.push(r.companyName);
  }

  // 2. First + Lastname (if exists)
  const personName = [r.firstName, r.lastName].filter(Boolean).join(' ');
  if (personName) {
    lines.push(personName);
  }

  // 3. Abteilung (if exists)
  if (r.abteilung) {
    lines.push(r.abteilung);
  }

  // 4. Streetname + Streetnumber
  if (r.street) {
    lines.push(r.street);
  }

  // 5. Zipcode + City
  const zipCity = [r.zipCode, r.city].filter(Boolean).join(' ');
  if (zipCity) {
    lines.push(zipCity);
  }

  // 6. Phone number (if exists)
  if (r.phone) {
    lines.push(r.phone);
  }

  return lines;
}

/** Secondary labeled block (per_client + snapshot). */
export function secondaryLegalFromSnapshot(
  snap: Record<string, unknown> | null | undefined
): PdfSecondaryLegalRecipient | null {
  const r = recipientFromRechnungsempfaengerSnapshot(snap);
  if (!r) return null;
  const lines: string[] = [];
  if (r.street) lines.push(r.street);
  if (r.addressLine2) lines.push(r.addressLine2);
  const zc = [r.zipCode, r.city].filter(Boolean).join(' ');
  if (zc) lines.push(zc);
  return {
    label: 'Rechnungsempfänger / Zahlungspflichtiger',
    displayName: r.displayName,
    lines
  };
}
