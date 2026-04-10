# Clients (Fahrgäste)

## `reference_fields` (Bezugszeichen / Referenzfelder)

Optional JSON column on `public.clients`: ordered array of `{ "label": string, "value": string }`.

- **UI:** Edited in the client form under **“Bezugszeichen / Referenzfelder”** ([`client-form.tsx`](../src/features/clients/components/client-form.tsx)). Rows can be added or removed; **labels** that are empty or whitespace-only are **silently dropped on save** (no field-level validation while typing). If nothing remains, the column is stored as **`NULL`** (not an empty array).
- **Invoices:** Values are **snapshotted** onto `invoices.client_reference_fields_snapshot` when an invoice is created with a `client_id`. Issued PDFs read only that snapshot — see [invoices-module.md § 1.4](invoices-module.md#14-client-reference-fields-bezugszeichen).
- **Validation:** Shared Zod schemas live in [`client-reference-fields.schema.ts`](../src/features/clients/lib/client-reference-fields.schema.ts).
