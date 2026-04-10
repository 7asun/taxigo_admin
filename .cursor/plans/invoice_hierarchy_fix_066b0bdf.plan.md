---
name: invoice_hierarchy_fix
overview: Fix per_client Unterart selection bug, persist Unterart scope on invoices, correct line-item snapshots (Unterart vs Familie), and update PDF grouping to show Unterart labels.
todos:
  - id: A_fix_useClientPayers
    content: Fix `use-client-payers.ts` to return `billing_variant_id` and update Step 2 per_client combined selector + labels.
    status: completed
  - id: B_add_billing_variant_to_builder
    content: Add `billing_variant_id` to Step 2 Zod schema, canonical builder schema, and builder state/types; pass through onNext and query keys.
    status: completed
  - id: C_fetchTrips_variant_filter
    content: Extend `fetchTripsForBuilder` params and implement variant-first filtering logic.
    status: completed
  - id: D_snapshot_variant_and_family_names
    content: Change line-item snapshot to store Unterart name in `billing_variant_name` and add `billing_type_name` field through types and inserts (migration later).
    status: completed
  - id: E_migrate_invoices_billing_variant_id
    content: Add invoices.billing_variant_id migration + types + createInvoice insert.
    status: completed
  - id: F_migrate_line_items_billing_type_name
    content: Add invoice_line_items.billing_type_name migration + types + insertLineItems.
    status: completed
  - id: F2_storno_new_columns
    content: Check storno.ts — if invoice_line_items columns are copied explicitly (not via *), add billing_type_name to the copy list. If invoices columns are copied explicitly, add billing_variant_id to that list. Ensure Stornorechnung mirrors the originals new columns per §14 UStG.
    status: completed
  - id: G_update_pdf_grouping
    content: Update grouped_by_billing_type grouping to use Unterart label; confirm appendix/Step3 behavior.
    status: completed
  - id: H_recipient_resolution
    content: Keep recipient resolution post-fetch; ensure new field doesn’t regress behavior.
    status: completed
  - id: I_update_docs
    content: Update invoice docs to reflect corrected hierarchy semantics and new columns.
    status: completed
  - id: J_inline_comments
    content: Add or update inline comments in every file touched by Parts A–F2 to document the corrected semantics. billing_variant_name = Unterart name, billing_type_name = Abrechnungsfamilie name. Document the per_client billing_variant_id fix with a note explaining the old bug.
    status: completed
  - id: K_update_docs
    content: Update all relevant docs files to reflect the corrected hierarchy semantics and new columns.
    status: completed
isProject: false
---

## Constraints

- No behavior changes outside Parts A–K.
- Implement strictly in order A→K.
- After each part, run typecheck/build checks as appropriate and summarize changes.

## Key code paths (current)

- Step 2 per_client combined selector: `src/features/invoices/components/invoice-builder/step-2-params.tsx`
- per_client historical combinations: `src/features/invoices/hooks/use-client-payers.ts`
- Trip fetch + joins + line-item snapshot: `src/features/invoices/api/invoice-line-items.api.ts`
- Invoice header insert: `src/features/invoices/api/invoices.api.ts`
- Types + builder schema: `src/features/invoices/types/invoice.types.ts`
- PDF grouped_by_billing_type grouping: `src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts`

## Part A — Fix per_client bug in `use-client-payers.ts`

- Monthly and single_trip modes are unaffected. In those modes, billing_variant_id is always null in Step 2 (no Unterart picker is shown). The existing optional Abrechnungsart field still sets billing_type_id only. No UI changes are needed for those modes — only per_client gets the new combined selector with Unterart labels.
- Update `PayerCombination` to `{ payer_id: string; billing_variant_id: string | null }`.
- Update query mapping to store `billing_variant_id` (currently incorrectly assigned to `billing_type_id`).
  - Current bug: `billing_type_id: t.billing_variant_id` in `use-client-payers.ts`.
- Update consumer `step-2-params.tsx` per_client flow:
  - Read `comb.billing_variant_id`.
  - On selection set:
    - `form.setValue('billing_variant_id', comb.billing_variant_id)`
    - `form.setValue('billing_type_id', null)`
  - Update option labels to show `payer.name — variant.name`.
    - Implement by extending `useClientPayers` to also return `billing_variant_name` (and optionally code) by joining `billing_variants(name)` in the hook queries.

## Part B — Add `billing_variant_id` to Step 2 schema + builder state

- Monthly and single_trip modes are unaffected. In those modes, billing_variant_id is always null in Step 2 (no Unterart picker is shown). The existing optional Abrechnungsart field still sets billing_type_id only. No UI changes are needed for those modes — only per_client gets the new combined selector with Unterart labels.
- `src/features/invoices/components/invoice-builder/step-2-params.tsx`
  - Extend local `step2Schema` with `billing_variant_id: z.string().uuid().nullable()`.
  - Ensure per_client combined selector writes `billing_variant_id` into the form.
  - Include `billing_variant_id` in `onNext` payload.
- `src/features/invoices/types/invoice.types.ts`
  - Extend `invoiceBuilderSchema` to include `billing_variant_id: z.string().uuid().nullable()`.
  - Extend `InvoiceBuilderFormValues` (inferred) and any dependent picks.
- `src/features/invoices/hooks/use-invoice-builder.ts`
  - Extend the local `Step2Values` pick to include `billing_variant_id`.
  - Include `billing_variant_id` in queryKey and in call to `fetchTripsForBuilder`.

## Part C — Update `fetchTripsForBuilder` filtering priority

- `src/features/invoices/api/invoice-line-items.api.ts`
  - Extend `FetchTripsForBuilderParams` with `billing_variant_id?: string | null`.
  - Filter priority:
    - If `billing_variant_id` set → `.eq('billing_variant_id', ...)`.
    - Else if `billing_type_id` set → keep variantIdsForType subquery + `.in('billing_variant_id', ...)`.
    - Else → no variant filter.
  - Ensure the “no variants under family → return []” guard applies only to the family path.

## Part D — Line item snapshot: Unterart name + add family name

- `src/features/invoices/api/invoice-line-items.api.ts` (`buildLineItemsFromTrips`)
  - Change `billing_variant_name` to snapshot Unterart: `trip.billing_variant?.name ?? null`.
  - Add `billing_type_name: trip.billing_variant?.billing_type?.name ?? null` to the builder line item.
- `src/features/invoices/types/invoice.types.ts`
  - Add `billing_type_name: string | null` to `BuilderLineItem` and `InvoiceLineItemRow`.
- `insertLineItems` must persist `billing_type_name` (blocked until Part F migration).

## Part E — Add `billing_variant_id` to invoices table

- Add migration `supabase/migrations/20260410120000_invoices_billing_variant_id.sql` with the provided SQL.
- Update `src/features/invoices/types/invoice.types.ts` `InvoiceRow` to include `billing_variant_id: string | null`.
- Update `src/features/invoices/api/invoices.api.ts` `createInvoice` insert to write `billing_variant_id: payload.formValues.billing_variant_id ?? null`.

## Part F — Add `billing_type_name` to invoice_line_items table

- Add migration `supabase/migrations/20260410120001_invoice_line_items_billing_type_name.sql` with the provided SQL.
- Update `InvoiceLineItemRow` type and `insertLineItems` to insert `billing_type_name: item.billing_type_name`.

## Part F2 — Storno column coverage

- Read `src/features/invoices/lib/storno.ts` fully.
- If line item columns are listed explicitly in the Storno insert, add `billing_type_name` to that list.
- If invoice header columns are listed explicitly, add `billing_variant_id` to that list.
- If the copy uses a spread or wildcard, confirm the new columns are included automatically and add a comment noting this.

## Part G — PDF shows Unterart name; grouped_by_billing_type groups by Unterart

- Update `src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts`:
  - `buildInvoicePdfGroupedByBillingType`: label/key should use `item.billing_variant_name` (now Unterart), not family.
  - `groupLineItemsByBillingType`: group label should use `billing_variant_name` (Unterart).
- No new PDF column key needed (per your choice). Appendix automatically displays Unterart via existing billing column.
- Confirm Step 3 badge (`step-3-line-items.tsx`) now shows Unterart without changes.

## Part H — Rechnungsempfänger resolution

- Per your choice (B): keep pre-load behavior unchanged.
  - Still resolve `catalogRecipientId` after trips load from first trip (`use-invoice-builder.ts` already uses `t0.billing_variant?.rechnungsempfaenger_id`).
  - Ensure any new Step 2 `billing_variant_id` does not regress this flow.

## Part I — Docs

- Update `docs/invoices-module.md` (or closest existing invoice docs file) to document:
  - `invoice_line_items.billing_variant_name` = Unterart snapshot.
  - `invoice_line_items.billing_type_name` = Abrechnungsfamilie snapshot.
  - `invoices.billing_variant_id` = Unterart scope when variant-scoped; null otherwise.
  - per_client now carries `billing_variant_id` end-to-end.

## Part J — Inline comments

- `src/features/invoices/hooks/use-client-payers.ts`: add a comment above the mapping explaining the previous bug (`billing_type_id: t.billing_variant_id` was incorrect) and what the fix does.
- `src/features/invoices/api/invoice-line-items.api.ts` — `buildLineItemsFromTrips`: add comments above `billing_variant_name` and `billing_type_name` lines explaining what each stores and why (Unterart vs Familie).
- `src/features/invoices/api/invoice-line-items.api.ts` — `fetchTripsForBuilder`: add a comment above the filter priority block explaining the three cases (variant-first → family → none).
- `src/features/invoices/api/invoices.api.ts` — `createInvoice`: add a comment above `billing_variant_id` insert explaining when it is set vs null.
- Migration files `supabase/migrations/20260410120000_invoices_billing_variant_id.sql` and `supabase/migrations/20260410120001_invoice_line_items_billing_type_name.sql`: ensure the SQL comment headers clearly explain what each column stores and the context of the fix.
- `src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts` — `buildInvoicePdfGroupedByBillingType`: add a comment noting that the grouping key is now Unterart name (not family name) and why.

## Part K — Docs update

- Update the primary invoice docs file (whichever of `docs/invoices-module.md` or equivalent is most complete — check which exists) with a new section titled `## Billing hierarchy — Kostenträger / Abrechnungsfamilie / Unterart` that documents:
  - The three-level hierarchy and what each level maps to in the DB
  - `invoice_line_items.billing_variant_name` = Unterart name snapshot (immutable)
  - `invoice_line_items.billing_type_name` = Abrechnungsfamilie name snapshot (immutable)
  - `invoices.billing_variant_id` = Unterart scope when variant-scoped; null for multi-variant invoices
  - per_client mode now carries `billing_variant_id` end-to-end; explain what was broken before
  - The filter priority in `fetchTripsForBuilder` (variant-first → family → none)
- Update `docs/rechnungsempfaenger.md` (or equivalent): note that the Unterart-level recipient is now correctly resolved in per_client mode because billing_variant_id is passed correctly.
- Add a short post-mortem note: “Before this fix, use-client-payers.ts stored billing_variant_id in a field named billing_type_id, causing per_client invoices for clients with Unterarten to return zero trips.”

## Verification (after all parts)

- `bun run build`
- Manual smoke:
  - per_client: select client with Unterart “Deutsche Rentenversicherung” → trips load.
  - per_client PDF: Unterart label shown.
  - monthly with `grouped_by_billing_type`: groups labeled by Unterart.
  - Header: per_client invoices set `billing_variant_id`; monthly invoices keep it null unless explicitly set.
  - New line items include `billing_type_name`.
  - Storno: check `src/features/invoices/lib/storno.ts` copies new columns if needed.

```mermaid
flowchart TD
  Step2[Step2Params] -->|onNext| BuilderState[useInvoiceBuilder.step2Values]
  BuilderState -->|fetchTripsForBuilder params| FetchTrips[fetchTripsForBuilder]
  FetchTrips -->|TripForInvoice[]| BuildItems[buildLineItemsFromTrips]
  BuildItems -->|BuilderLineItem[]| InsertLines[insertLineItems]
  BuilderState -->|formValues| CreateInvoice[createInvoice]
  CreateInvoice --> InvoicesTable[(invoices)]
  InsertLines --> LineItemsTable[(invoice_line_items)]
```



