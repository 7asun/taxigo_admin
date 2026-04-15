/**
 * InvoicePdfCoverHeaderBrief
 *
 * Brief mode header (DIN 5008 Form B): renders **only** `InvoicePdfBrandingBlock`
 * and `InvoicePdfMetaGrid`. It must **not** render `InvoicePdfRecipientBlock`,
 * any address lines, or any recipient content — the recipient is rendered
 * exclusively at page level by `InvoicePdfDocument` / `AngebotPdfDocument` as an
 * absolute `View` at `PDF_DIN5008.addressWindowTop` (Path C).
 */

import { View } from '@react-pdf/renderer';

import {
  InvoicePdfBrandingBlock,
  InvoicePdfMetaGrid,
  type InvoicePdfCoverHeaderProps
} from './invoice-pdf-cover-header';
import { styles } from './pdf-styles';

export function InvoicePdfCoverHeaderBrief({
  companyProfile: cp,
  senderFit,
  renderMode: _renderMode,
  recipient: _recipient,
  secondaryLegalRecipient: _secondaryLegalRecipient = null,
  invoiceNumber,
  invoiceCreatedAtIso,
  periodFromIso,
  periodToIso,
  customerNumber,
  isStorno = false,
  metaConfig
}: InvoicePdfCoverHeaderProps) {
  return (
    <View style={styles.headerRow}>
      <View style={styles.headerLeft}>
        <InvoicePdfBrandingBlock companyProfile={cp} senderFit={senderFit} />
      </View>

      <View style={styles.headerRight}>
        <InvoicePdfMetaGrid
          companyProfile={cp}
          invoiceNumber={invoiceNumber}
          invoiceCreatedAtIso={invoiceCreatedAtIso}
          periodFromIso={periodFromIso}
          periodToIso={periodToIso}
          customerNumber={customerNumber}
          isStorno={isStorno}
          metaConfig={metaConfig}
        />
      </View>
    </View>
  );
}
