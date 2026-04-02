/**
 * Client-side QR PNG (data URL) for SEPA payment block on the invoice PDF.
 */

import QRCode from 'qrcode';

import type { InvoiceDetail } from '../../types/invoice.types';
import { buildSepaQrPayload } from './build-sepa-qr-payload';

/**
 * Returns a PNG data URL for embedding in @react-pdf, or null if IBAN/name missing or encoding fails.
 */
export async function generatePaymentQrDataUrl(
  invoice: InvoiceDetail
): Promise<string | null> {
  const cp = invoice.company_profile;
  if (!cp?.bank_iban?.trim() || !cp.legal_name?.trim()) return null;

  const payload = buildSepaQrPayload({
    beneficiaryName: cp.legal_name,
    iban: cp.bank_iban,
    bic: cp.bank_bic,
    amountEur: invoice.total,
    remittance: invoice.invoice_number
  });
  if (!payload) return null;

  try {
    return await QRCode.toDataURL(payload, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: 'M'
    });
  } catch {
    return null;
  }
}
