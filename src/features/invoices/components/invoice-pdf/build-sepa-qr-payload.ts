/**
 * build-sepa-qr-payload.ts
 *
 * EPC069-12 "SEPA Credit Transfer" QR payload (UTF-8) for European banking apps.
 * Used by DE/SEPA Giro-Code style scanners — keep human-readable IBAN/VZ on the PDF too.
 *
 * @see European Payments Council QR Code Guidelines
 */

export interface SepaQrParams {
  /** Creditor / beneficiary name (max 70 chars). */
  beneficiaryName: string;
  /** IBAN without spaces. */
  iban: string;
  /** Optional BIC; include for non-DE IBANs or if your bank requires it. */
  bic: string | null;
  /** Amount in EUR (gross invoice total). */
  amountEur: number;
  /** Remittance / Verwendungszweck (e.g. invoice number). Max 140 chars in practice. */
  remittance: string;
}

/**
 * Builds the newline-separated BCD string for SCT QR codes.
 * Returns null if IBAN is missing or invalid for encoding.
 */
export function buildSepaQrPayload(params: SepaQrParams): string | null {
  const iban = params.iban.replace(/\s/g, '').toUpperCase();
  if (!iban || iban.length < 15) return null;

  const name = params.beneficiaryName.trim().slice(0, 70);
  if (!name) return null;

  const amount = Math.max(0, Math.round(params.amountEur * 100) / 100);
  const amountStr = `EUR${amount.toFixed(2)}`;

  const bic = (params.bic?.replace(/\s/g, '').toUpperCase() ?? '').slice(0, 11);

  const purpose = params.remittance.trim().slice(0, 140);

  // 8 lines per EPC SCT template (BCD 002, UTF-8, SCT)
  const lines = ['BCD', '002', '1', 'SCT', bic, name, iban, amountStr, purpose];

  return lines.join('\n');
}
