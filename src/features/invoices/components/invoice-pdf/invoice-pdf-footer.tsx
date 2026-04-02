/**
 * Footer: `fixed` column block + `fixed` page line. Page `Text` uses `top` (not `bottom`)
 * in styles — react-pdf 4.3.x can omit `render` output when positioned with `bottom`.
 */

import { View, Text } from '@react-pdf/renderer';

import type { InvoiceDetail } from '../../types/invoice.types';

import { formatInvoicePdfIbanDisplay } from './lib/invoice-pdf-format';
import { styles } from './pdf-styles';

export interface InvoicePdfFooterProps {
  companyProfile: InvoiceDetail['company_profile'];
  notes: string | null;
}

export function InvoicePdfFooter({
  companyProfile: cp,
  notes
}: InvoicePdfFooterProps) {
  return (
    <>
      <View style={styles.footer} fixed>
        <View style={styles.footerColThird}>
          <Text style={styles.footerBold}>{cp?.legal_name ?? '—'}</Text>
          {cp?.inhaber?.trim() ? (
            <Text style={styles.footerText}>Inhaber: {cp.inhaber}</Text>
          ) : null}
          {cp?.street ? (
            <Text style={styles.footerText}>
              {cp.street} {cp.street_number}
            </Text>
          ) : null}
          {cp?.zip_code ? (
            <Text style={styles.footerText}>
              {cp.zip_code} {cp.city}
            </Text>
          ) : null}
        </View>
        <View style={styles.footerColThird}>
          <Text style={styles.footerKontaktHeading}>Kontakt</Text>
          {cp?.phone?.trim() ? (
            <Text style={styles.footerText}>Tel.: {cp.phone}</Text>
          ) : null}
          {cp?.email?.trim() ? (
            <Text style={styles.footerText}>E-Mail: {cp.email}</Text>
          ) : null}
          {cp?.website?.trim() ? (
            <Text style={styles.footerText}>Web: {cp.website}</Text>
          ) : null}
          {notes?.trim() ? (
            <Text style={styles.footerNote}>Hinweis: {notes}</Text>
          ) : null}
        </View>
        <View style={styles.footerColThird}>
          {cp?.bank_name?.trim() ? (
            <Text style={styles.footerText}>{cp.bank_name}</Text>
          ) : null}
          {cp?.bank_iban?.trim() ? (
            <Text style={styles.footerText}>
              IBAN: {formatInvoicePdfIbanDisplay(cp.bank_iban)}
            </Text>
          ) : null}
          {cp?.tax_id ? (
            <Text style={styles.footerText}>St.-Nr.: {cp.tax_id}</Text>
          ) : null}
          {cp?.vat_id ? (
            <Text style={styles.footerText}>USt-IdNr.: {cp.vat_id}</Text>
          ) : null}
        </View>
      </View>
      <Text
        style={styles.footerPageNumber}
        fixed
        render={({ pageNumber, totalPages }) =>
          `Seite ${pageNumber} von ${totalPages}`
        }
      />
    </>
  );
}
