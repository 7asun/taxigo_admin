import { z } from 'zod';

/**
 * One reference line on the invoice PDF (Bezugszeichen row).
 * Stored on `clients.reference_fields` and snapshotted on `invoices.client_reference_fields_snapshot`.
 */
export const ClientReferenceFieldSchema = z.object({
  label: z.string().min(1),
  value: z.string()
});

export const ClientReferenceFieldsSchema = z.array(ClientReferenceFieldSchema);

export type ClientReferenceField = z.infer<typeof ClientReferenceFieldSchema>;

/** Rows with empty/whitespace-only labels (mid-entry in UI) — drop before persist or snapshot. */
export function stripReferenceRowsWithEmptyLabels(
  rows: { label: string; value: string }[]
): { label: string; value: string }[] {
  return rows.filter((r) => r.label.trim().length > 0);
}

/**
 * Coerce unknown JSON from DB into typed rows, strip empty labels, validate.
 * @returns `null` when nothing to store or render (matches DB NULL convention, not []).
 */
export function parseClientReferenceFieldsFromDb(
  json: unknown
): ClientReferenceField[] | null {
  if (json == null) return null;
  if (!Array.isArray(json)) return null;

  const stripped = stripReferenceRowsWithEmptyLabels(
    json.map((item) => {
      const o = item as Record<string, unknown>;
      return {
        label: typeof o?.label === 'string' ? o.label : '',
        value: typeof o?.value === 'string' ? o.value : ''
      };
    })
  );
  if (stripped.length === 0) return null;

  const parsed = ClientReferenceFieldsSchema.safeParse(stripped);
  return parsed.success ? parsed.data : null;
}

/** Alias for invoice snapshot JSON — same rules as client column. */
export function parseClientReferenceFieldsSnapshot(
  json: unknown
): ClientReferenceField[] | null {
  return parseClientReferenceFieldsFromDb(json);
}
