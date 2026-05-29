---
name: Draft invoice hydration mapper
overview: Add a reversible InvoiceLineItemRow -> BuilderLineItem mapper plus builder hydration from an existing draft invoiceId (payer locked, no price recalculation on load), backed by mandatory no-op round-trip tests. No save path, no edit route.
todos:
  - id: mapper
    content: Create map-line-item-row-to-builder-line-item.ts with mapLineItemRowToBuilderLineItem + mapLineItemRowToBuilderCancelledTrip (snapshot-verbatim copy; NO note-string detection; manualGrossTotal/isManualOverride NOT reconstructed so manual overrides flow through net-anchor exactly as the RPC; originalPriceResolution=snapshot, resolved_rule=null, KM badge UI-only). Export lineItemToInsertRow + cancelledTripToInsertRow from invoice-line-items.api.ts. Run bun run build.
    status: completed
  - id: tests
    content: Create map-line-item-row-to-builder-line-item.test.ts with no-op round-trip cases (normal, manual gross override, KM override, billing excluded, cancelled trip, manual line no trip_id) asserting total_price + header totals unchanged. Run bun test until green.
    status: completed
  - id: hydration
    content: "Extend use-invoice-builder.ts with optional invoiceId: hydration query (getInvoiceDetail -> mappers -> seed lineItems/cancelledTrips/step2Values/catalogRecipientId, hydrate-once guard), disable trips fetch + state-clear effect in edit mode, expose isEditMode/editInvoiceNumber. Run bun run build + bun test."
    status: completed
  - id: shell
    content: "Extend invoice-builder/index.tsx: optional invoiceId prop, lock payer + mode (Step1Mode/Step2Params disabled), edit-mode indicator with invoice number; keep create mode identical. Run bun run build + bun test."
    status: pending
  - id: docs
    content: Update docs/invoices-module.md (Phase B hydration & inverse mapper) and docs/plans/revision-invoice-audit.md (Step 2 status, cross-link D1). Add why-comments to all reconstruction paths.
    status: pending
isProject: false
---

# Draft Invoice Editing — Step 2: Reversible Mapping & Builder Hydration

## Validation: is the mapper still the safest approach? (Yes — with one simplification)

After reading the real persistence code, the mapper is the correct and lowest-risk approach, because the persisted row already contains everything needed:

- `invoice_line_items.price_resolution_snapshot` **is** the frozen `PriceResolution` (see `lineItemToInsertRow` writing `frozen` into that column in [invoice-line-items.api.ts](src/features/invoices/api/invoice-line-items.api.ts)). So `builder.price_resolution = row.price_resolution_snapshot` verbatim — no re-derivation.
- `lineItemToInsertRow` recomputes `total_price` **only** from `frozen` + `unit_price`/`quantity`/`tax_rate`/`approach_fee_net`. It never reads `manualGrossTotal`, `isManualKmOverride`, or `resolved_rule`. Therefore line-row fidelity needs only the snapshot + numeric columns.

Lower-risk refinement adopted: the mapper copies the snapshot as the source of truth and sets `unit_price = snapshot.unit_price_net` so that `frozenPriceResolutionForInsert` returns the snapshot unchanged on re-save (the `Math.abs(prev - u) > 0.0001` guard stays false). This guarantees a bit-identical `total_price` round-trip without recomputing prices.

The only fields with no column (builder-only) and how we reconstruct them are documented under "Reconstruction rules" — these affect header-totals exactness and Step-3 UI badges, never the persisted line row.

## 1. Inverse mapper — `map-line-item-row-to-builder-line-item.ts` (new)

Create [src/features/invoices/utils/map-line-item-row-to-builder-line-item.ts](src/features/invoices/utils/map-line-item-row-to-builder-line-item.ts) exporting:

- `mapLineItemRowToBuilderLineItem(row, ctx)` -> `BuilderLineItem` (for `is_cancelled_trip !== true` rows)
- `mapLineItemRowToBuilderCancelledTrip(row, ctx)` -> `BuilderCancelledTripRow` (for `is_cancelled_trip === true` rows; opted-in)

`ctx` carries the few non-column values: `{ manualKmEnabled: boolean }` (from the payer) and optionally client display fields.

### Reconstruction rules (faithful copy + documented heuristics)

- `price_resolution` = `row.price_resolution_snapshot as PriceResolution` (verbatim). If null (legacy rows), synthesize a minimal net-anchor resolution from columns; document as fallback.
- `unit_price` = `pr.unit_price_net` (NOT `row.unit_price`) so re-save `frozen` equals the snapshot. `quantity`, `tax_rate`, `approach_fee_net`, `effective_distance_km`, `original_distance_km`, `distance_km`, descriptions/addresses/variant labels = direct column copies.
- `approach_fee_gross` = `approach_fee_net != null ? round(approach_fee_net * (1 + tax_rate)) : null` (mirrors `buildLineItemsFromTrips`).
- `billingInclusion` = `{ included: row.billing_included ?? true, reason: row.billing_exclusion_reason ?? '' }` (exact, drives totals filtering).
- `originalPriceResolution` = the snapshot. why: the pre-override original is not persisted; "reset override" in edit mode restores the last saved state. Documented assumption.
- `kts_override` = `row.kts_override`; `kts_document_applies` = `pr.strategy_used === 'kts_override'` (best-effort; informational badge only).
- `price_source` = legacy map of `pr.source`; `trip_meta` = `row.trip_meta_snapshot`; `no_invoice_warning` = false (not persisted).
- `resolved_rule` = `null`. why: per-line rule/`billing_variant_id`/`client_id` are not stored, so it cannot be reliably reconstructed for monthly invoices. Leaving it null means KM-edit reprice falls back to tax-rate-only adjustment in edit mode. Live reprice of edited lines is deferred to the save-path phase (honors "no silent price recalculation on load").
- Manual gross override: NOT reconstructed. `manualGrossTotal = null`, `isManualOverride = false`. why (decision, per Step-1 consistency): we do NOT reintroduce the `note.includes('Manuell überschrieben (Bruttoeingabe)')` string coupling that Step 1 deliberately removed from the RPC. Manual-override lines instead flow through `calculateInvoiceTotals` exactly as the RPC persists them — `client_price_tag` lines via the gross-anchor branch (`isGrossAnchorClientPriceTag`, exact because tag lines are qty 1 / approach 0) and all other lines via net-anchor. The builder-displayed total therefore equals the persisted total (both net-anchor), and the ≤1-cent edge on mixed-rate manual overrides is the SAME documented deferred item D1 in both the RPC and here. This eliminates the note-string coupling from the codebase until D1 (a persisted `is_manual_gross_override` flag) is implemented. Trade-off: the Step-3 "Manuell" badge/reset is not shown for hydrated override lines (cosmetic only — financials unaffected).
- KM override (Step-3 badge only, no column, no financial effect): `isManualKmOverride = effective_distance_km != null && original_distance_km != null && effective_distance_km !== original_distance_km`; `manualDistanceKm = effective_distance_km` when overridden. Documented as cosmetic/UI-only for this step.
- Run `validateLineItem(item)` to populate `warnings`, matching how the hook patches items after edits.

Cancelled-trip mapper mirrors the inverse of `cancelledTripToInsertRow` into `BuilderCancelledTripRow` with `billingInclusion = { included: true, reason: row.cancelled_billing_reason ?? '' }` and `includeApproachFee = true`.

### Required export change

Export the currently module-private `lineItemToInsertRow` and `cancelledTripToInsertRow` from [invoice-line-items.api.ts](src/features/invoices/api/invoice-line-items.api.ts) so the round-trip tests can call them. (Behavior unchanged; only visibility.)

Build gate: `bun run build`.

## 2. No-op round-trip tests — `map-line-item-row-to-builder-line-item.test.ts` (new)

Create [src/features/invoices/utils/__tests__/map-line-item-row-to-builder-line-item.test.ts](src/features/invoices/utils/__tests__/map-line-item-row-to-builder-line-item.test.ts) (Bun test, mirroring [calculate-invoice-totals.test.ts](src/features/invoices/api/__tests__/calculate-invoice-totals.test.ts)).

For each case: start from an `InvoiceLineItemRow`, map to builder, map back via `lineItemToInsertRow`/`cancelledTripToInsertRow`, and assert the financial fields are preserved: `total_price`, `unit_price`, `quantity`, `tax_rate`, `approach_fee_net`, `price_resolution_snapshot`, `billing_included`, `billing_exclusion_reason`, `is_cancelled_trip`. Plus a totals invariant: `calculateInvoiceTotals(mappedRows)` equals the stored `{subtotal, taxAmount, total}`.

Mandatory cases: normal trip, manual gross override, KM override, billing excluded, cancelled trip, manual line (`trip_id = null`). The manual-gross-override case asserts the mapper does NOT set `manualGrossTotal` and that the net-anchor (or `client_price_tag` gross-anchor) total equals the persisted total — i.e. no note-string detection.

Hard invariant under test: a no-op edit must not change `total_price` or header totals (within the documented D1 ≤1-cent net-anchor tolerance for mixed-rate manual overrides).

Build gate: `bun test` until green.

## 3. Builder hydration mode — extend `use-invoice-builder.ts`

Extend [useInvoiceBuilder](src/features/invoices/hooks/use-invoice-builder.ts) to accept an optional `invoiceId?: string`.

- Add a hydration `useQuery` (enabled only when `invoiceId` present) that calls `getInvoiceDetail(invoiceId)`. Set `staleTime: Infinity`, `gcTime: Infinity`, `refetchOnWindowFocus: false`, `refetchOnReconnect: false`, `refetchOnMount: false`. why: a background/window-focus refetch must never re-emit invoice data after the admin starts editing.
- Seeding into state is the only place that writes `lineItems`/`cancelledTrips`/`step2Values`/`catalogRecipientId`, and it runs strictly inside a `useEffect` gated by a `hasHydratedRef` (set true on first successful seed and never reset). The effect partitions `line_items` by `is_cancelled_trip`, maps via the new mappers, and seeds `step2Values` (from invoice header: `mode`, `payer_id`, `billing_type_id`, `billing_variant_id`, `period_from/to`, `client_id`; `billing_type_ids`/`billing_variant_ids = null` since fetch-only) and `catalogRecipientId` from `rechnungsempfaenger_id`. Even if the query somehow re-resolves, `hasHydratedRef` short-circuits the effect so in-progress edits are never overwritten.
- Critical isolation: gate the existing trips fetch with `enabled: !invoiceId && step2ValuesReadyForTripsFetch(...)`, and gate the existing state-clearing `useEffect` (the one that resets `lineItems`/`cancelledTrips`/`section3Confirmed` when `step2Values` is not ready) with `if (!isEditMode)`. why: in edit mode `step2Values` is set from the invoice, which would otherwise re-fire `buildLineItemsFromTrips` and silently recompute prices from current (mutable) trips — violating "no silent price recalculation on load".
- Expose `isEditMode`, `editInvoiceNumber`, `isHydrating` from the hook. Create-mode return shape and behavior stay byte-for-byte identical when `invoiceId` is undefined.

Build gate: `bun run build` + `bun test`.

## 4. Builder shell — extend `invoice-builder/index.tsx`

Extend [InvoiceBuilder](src/features/invoices/components/invoice-builder/index.tsx):

- Add optional props `invoiceId?: string` (and read `editInvoiceNumber` from the hook). Pass `invoiceId` into `useInvoiceBuilder`.
- Lock payer + mode in edit mode: pass a `payerLocked`/`disabled` flag to `Step1Mode` and [Step2Params](src/features/invoices/components/invoice-builder/step-2-params.tsx) so the payer picker and mode are read-only. why: changing payer/mode would invalidate the frozen snapshots.
- Confirm the lock also prevents state-clearing side effects: locking keeps `step2Values.payer_id` constant, so neither the hook's state-clearing `useEffect` nor the index.tsx payer-change reset effect (`useEffect(..., [step2Values?.payer_id])`, which today resets the PDF column profile/ack) re-fires after hydration. The hook clear effect is additionally guarded by `if (!isEditMode)` (Step 3) as belt-and-suspenders, so even a stray re-render of a locked payer cannot wipe hydrated state.
- Edit-mode indicator: render a visible banner/badge ("Bearbeitung — Rechnung {editInvoiceNumber}") near the section title, only when `isEditMode`.
- Create-mode path unchanged: when `invoiceId` is undefined, render exactly as today. No live route passes `invoiceId` yet (edit route deferred), so this only wires capability.

`invoice.types.ts`: extend only if a small shared type is needed (e.g. a `BuilderHydrationContext`); otherwise no change.

Build gate: `bun run build` + `bun test`.

## 5. Docs (mandatory)

Update [docs/invoices-module.md](docs/invoices-module.md) with a "Draft invoice re-open (Phase B): hydration & inverse mapper" subsection covering the snapshot-verbatim principle, the documented reconstruction decisions (NO note-string detection; manual overrides routed net-anchor exactly like the RPC; originalPriceResolution = snapshot; resolved_rule = null; KM badge UI-only), and the edit-mode trips-fetch isolation + hydrate-once guard. Add a status line to [docs/plans/revision-invoice-audit.md](docs/plans/revision-invoice-audit.md) Step-2 section and cross-link D1 (now the single source of the ≤1-cent manual-override edge for both the RPC and the builder UI).

## Hard rules honored

No save path, no edit route, no invoice-number changes, no silent price recalculation on load (trips fetch disabled in edit mode), create flow intact. Inline "why" comments added on every reconstruction heuristic.

## Out of scope (deferred)

`updateDraftInvoice`, edit route, "Bearbeiten" button, final save integration, persisted `is_manual_gross_override` flag (D1), per-line `resolved_rule` reconstruction.