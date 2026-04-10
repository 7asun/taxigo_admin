/**
 * Two-row horizontal reference strip: row 1 = labels (small, bold, muted), row 2 = values.
 * Data must come from `invoices.client_reference_fields_snapshot` only — never from live `clients`.
 *
 * Layout: right-aligned under Rechnungsdaten, auto width (content-sized columns), not full page width.
 */

import { View, Text, StyleSheet } from '@react-pdf/renderer';

import type { ClientReferenceField } from '@/features/clients/lib/client-reference-fields.schema';

import { styles } from './pdf-styles';

const barLayout = StyleSheet.create({
  outer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    width: '100%',
    marginTop: 4
  },
  inner: {
    flexDirection: 'row'
  },
  cell: {
    paddingVertical: 3
  }
});

export interface InvoicePdfReferenceBarProps {
  fields: ClientReferenceField[];
}

export function InvoicePdfReferenceBar({
  fields
}: InvoicePdfReferenceBarProps) {
  if (fields.length === 0) return null;

  return (
    <View style={barLayout.outer}>
      <View style={barLayout.inner}>
        {fields.map((f, i) => (
          <View
            key={`ref-col-${i}`}
            style={[barLayout.cell, i > 0 ? { marginLeft: 24 } : {}]}
            wrap={false}
          >
            <Text style={styles.referenceBarLabel}>{f.label}</Text>
            <Text style={styles.referenceBarValue}>{f.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
