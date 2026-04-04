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
}

export interface PdfSecondaryLegalRecipient {
  label: string;
  displayName: string;
  lines: string[];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
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
  const pc = str(snap.postal_code);
  const city = str(snap.city);
  if (!name && !a1 && !pc && !city) return null;
  return {
    companyName: '',
    personName: name,
    displayName: name || a1 || 'Rechnungsempfänger',
    street: a1,
    streetNumber: '',
    zipCode: pc,
    city,
    phone: null,
    addressLine2: a2 || null
  };
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
