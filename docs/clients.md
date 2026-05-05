# Clients (Fahrgäste)

## `client_km_overrides` (manual distance catalog)

Optional per-client fixed distances for invoicing when routing returns the wrong km. Table: `public.client_km_overrides` (`company_id`, `client_id`, optional `payer_id`, optional `billing_variant_id`, `distance_km`, `is_active`, timestamps). Resolution priority and RLS mirror `client_price_tags`.

- **UI:** Fahrgast detail panel — section **KM-Overrides** opens [`PricingRuleDialog`](../src/features/payers/components/pricing-rule-dialog/index.tsx) with pseudo-strategy `client_km_override` ([`ClientKmOverrideStep`](../src/features/payers/components/pricing-rule-dialog/client-km-override-step.tsx)). Query cache: `referenceKeys.clientKmOverridesManager(clientId)`.
- **Builder:** Active rows are loaded in `fetchTripsForBuilder` and passed as `clientKmOverrides` into `buildLineItemsFromTrips` (see [manual-km-overrides.md](manual-km-overrides.md)).

## `reference_fields` (Bezugszeichen / Referenzfelder)

Optional JSON column on `public.clients`: ordered array of `{ "label": string, "value": string }`.

- **UI:** Edited in the client form under **“Bezugszeichen / Referenzfelder”** ([`client-form.tsx`](../src/features/clients/components/client-form.tsx)). Rows can be added or removed; **labels** that are empty or whitespace-only are **silently dropped on save** (no field-level validation while typing). If nothing remains, the column is stored as **`NULL`** (not an empty array).
- **Invoices:** Values are **snapshotted** onto `invoices.client_reference_fields_snapshot` when an invoice is created with a `client_id`. Issued PDFs read only that snapshot — see [invoices-module.md § 1.4](invoices-module.md#14-client-reference-fields-bezugszeichen).
- **Validation:** Shared Zod schemas live in [`client-reference-fields.schema.ts`](../src/features/clients/lib/client-reference-fields.schema.ts).
