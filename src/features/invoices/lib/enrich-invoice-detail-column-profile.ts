/**
 * enrich-invoice-detail-column-profile.ts
 *
 * **`getInvoiceDetail`** (`invoices.api.ts`) is frozen — it must not grow Vorlage fetches. This helper
 * runs **after** the detail response and attaches **`column_profile`** for PDF preview and print.
 *
 * **Flow:** parse `pdf_column_override` with Zod; **`Promise.all`** fetches (a) payer’s Vorlage row when
 * `payer.pdf_vorlage_id` is set, and (b) company default Vorlage — parallel to avoid serial latency.
 * Then {@link resolvePdfColumnProfile} merges the 4-level chain into one profile.
 *
 * **Returns** a shallow copy `{ ...detail, column_profile }` (does not mutate the input object).
 *
 * **Caller:** `useInvoiceDetail` queryFn only.
 */

import {
  getDefaultVorlageForCompany,
  getPdfVorlage
} from '@/features/invoices/api/pdf-vorlagen.api';
import { resolvePdfColumnProfile } from '@/features/invoices/lib/resolve-pdf-column-profile';
import type { InvoiceDetail } from '@/features/invoices/types/invoice.types';
import {
  pdfColumnOverrideSchema,
  type PdfColumnOverridePayload
} from '@/features/invoices/types/pdf-vorlage.types';

/**
 * @param detail — invoice row from `getInvoiceDetail` (unchanged on failure paths)
 */
export async function enrichInvoiceDetailWithColumnProfile(
  detail: InvoiceDetail
): Promise<InvoiceDetail> {
  const raw = detail.pdf_column_override;
  let override: PdfColumnOverridePayload | null = null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const parsed = pdfColumnOverrideSchema.safeParse(raw);
    if (parsed.success) override = parsed.data;
  }

  const payerVid =
    detail.payer &&
    typeof detail.payer === 'object' &&
    'pdf_vorlage_id' in detail.payer
      ? ((detail.payer as { pdf_vorlage_id?: string | null }).pdf_vorlage_id ??
        null)
      : null;

  const [payerVorlage, companyDefault] = await Promise.all([
    payerVid ? getPdfVorlage(payerVid) : Promise.resolve(null),
    getDefaultVorlageForCompany(detail.company_id)
  ]);

  const column_profile = resolvePdfColumnProfile(
    override,
    payerVorlage,
    companyDefault
  );

  return { ...detail, column_profile };
}
