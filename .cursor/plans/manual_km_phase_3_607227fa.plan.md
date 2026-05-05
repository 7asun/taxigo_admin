---
name: Manual KM Phase 3
overview: "Phase 3 completes manual KM: payer toggle, `client_km_overrides` CRUD (with your new `billing_variant_id` migration), PDF effective km, and full per-km repricing via `resolved_rule` on `BuilderLineItem`. This plan reconciles the original spec with codebase facts (import paths, `buildLineItemsFromTrips` arity, `fetchTripsForBuilder` batching, Taxameter guard, `resetKmOverride`)."
todos:
  - id: migration-variant
    content: Add SQL migration billing_variant_id + index; update database.types.ts
    status: completed
  - id: resolver-variant
    content: Extend ClientKmOverrideLike + resolveEffectiveDistanceKm + tests
    status: completed
  - id: payer-toggle
    content: updatePayerManualKmEnabled + getPayers select + payer.types + payer-details-sheet UI
    status: completed
  - id: km-api
    content: New client-km-overrides.api.ts CRUD + batch fetch for builder
    status: completed
  - id: fetch-build
    content: fetchTripsForBuilder returns overrides; pass 4th arg to buildLineItemsFromTrips; fetchBuilderTripsAndRules
    status: completed
  - id: resolved-rule
    content: BuilderLineItem.resolved_rule + buildLineItemsFromTrips assignment
    status: completed
  - id: apply-reset-km
    content: use-invoice-builder tripInputFromLineItem, Taxameter guard, full repricing, resetKmOverride restore original
    status: completed
  - id: pdf-effective
    content: pdf-column-catalog dataField; build-invoice-pdf-summary all total_km sites
    status: completed
  - id: ui-dialog
    content: ClientKmOverrideStep; PRICING_STRATEGIES + labels + zod + PricingRuleDialog; client-detail-panel + query keys
    status: completed
  - id: docs-tests
    content: Docs updates; fixture/test fixes; final build + test
    status: completed
isProject: false
---

# Manual KM Override — Phase 3 (implementation plan)

## 0. Schema: `billing_variant_id` on `client_km_overrides`

**New migration file** (e.g. `supabase/migrations/YYYYMMDDHHMMSS_client_km_overrides_billing_variant.sql`) with your DDL:

```sql
-- Add billing_variant_id to client_km_overrides so KM overrides can be
-- scoped to a specific billing variant (Unterart), matching the scope model
-- of client_price_tags. nullable = override applies to all variants under
-- the selected payer when null.

ALTER TABLE client_km_overrides
  ADD COLUMN billing_variant_id uuid
    REFERENCES billing_variants(id)
    ON DELETE CASCADE;

-- Index for resolver lookup: client + variant scope
CREATE INDEX IF NOT EXISTS idx_client_km_overrides_variant
  ON client_km_overrides(client_id, billing_variant_id)
  WHERE billing_variant_id IS NOT NULL;

-- Update the existing RLS policy to cover the new column (no change needed —
-- the existing admin policy covers all columns on the table already).
```

RLS: **no migration change** — existing admin policy already applies to all columns on `client_km_overrides`.

**After migrate:** regenerate or hand-update [`src/types/database.types.ts`](src/types/database.types.ts) `client_km_overrides` Row/Insert/Update + Relationships for `billing_variant_id`.

**Resolver:** extend [`src/features/invoices/lib/resolve-effective-distance.ts`](src/features/invoices/lib/resolve-effective-distance.ts) — `ClientKmOverrideLike` must include optional `billing_variant_id: string | null` (import from types or inline). Precedence when `manualDistanceKm` absent (mirror `client_price_tags` mental model):

1. Same client, **variant match** (`billing_variant_id === trip.billing_variant_id`) — among those, prefer payer match when `payer_id` matches trip’s payer, then consider rows with `payer_id` null if your product rule says global payer for that variant (spec: nullable payer on row = global across payers for that client; align with how you store inserts).
2. Then **payer-scoped** row with `payer_id === trip.payer_id` and `billing_variant_id` null (all variants under payer).
3. Then **global** row (`payer_id` null, `billing_variant_id` null).

Document precedence in `// why` comments and extend [`src/features/invoices/lib/__tests__/resolve-effective-distance.test.ts`](src/features/invoices/lib/__tests__/resolve-effective-distance.test.ts) with variant vs payer vs global cases.

---

## 1. Payer toggle

- [`src/features/payers/api/payers.service.ts`](src/features/payers/api/payers.service.ts): Add **`updatePayerManualKmEnabled(payerId, enabled, supabase)`** (or static `PayersService` method — match existing `toQueryError` / patterns in file; user spec asked standalone + `SupabaseClient` — prefer consistency with [`client-price-tags.service.ts`](src/features/payers/api/client-price-tags.service.ts) if sheet already uses `createClient()`).
- Extend **`PayersService.getPayers()`** `.select(...)` to include `manual_km_enabled`.
- [`src/features/payers/types/payer.types.ts`](src/features/payers/types/payer.types.ts): add `manual_km_enabled?: boolean | null` on `Payer` / `PayerWithBillingCount`.
- [`src/features/payers/components/payer-details-sheet.tsx`](src/features/payers/components/payer-details-sheet.tsx): Switch **„Manuelle KM-Eingabe“** after KTS / same save-disabled pattern as other toggles; invalidate same queries as other payer mutations (`usePayers` / `referenceKeys.payers()` as used elsewhere in sheet).

**Note:** Original spec said “no migrations” — **superseded** by §0 + this payer column already exists from Phase 1.

---

## 2. Client KM overrides API

- **New** [`src/features/invoices/api/client-km-overrides.api.ts`](src/features/invoices/api/client-km-overrides.api.ts) (or mirror location of [`client-price-tags.service.ts`](src/features/payers/api/client-price-tags.service.ts) if you prefer one folder — user asked `invoices/api`; follow that but copy patterns: `getSessionCompanyId`, `toQueryError`, `company_id` on insert, `updated_at` on update).
- Exports: `listClientKmOverridesForManager`, `insertClientKmOverride`, `updateClientKmOverride`, `deleteClientKmOverride`, **`listClientKmOverridesForClientIds`** (batch for builder — same idea as price tags).
- **Do not** redefine `ClientKmOverrideLike` — extend it in `resolve-effective-distance.ts` and map DB rows in API.

---

## 3. Wire overrides into trip fetch / `buildLineItemsFromTrips`

- [`src/features/invoices/api/invoice-line-items.api.ts`](src/features/invoices/api/invoice-line-items.api.ts): In **`fetchTripsForBuilder`**, after you have `trips`, collect unique `clientIds` (already done for price tags), call **`listClientKmOverridesForClientIds(clientIds)`** (or N parallel calls — prefer one query with `.in('client_id', clientIds)`).
- Return `{ trips, clientPriceTags, clientKmOverrides }` from `fetchTripsForBuilder` **or** keep return shape and merge overrides inside — minimal churn: extend return tuple and update call sites.
- **`buildLineItemsFromTrips(trips, rules, clientPriceTags, clientKmOverrides)`** — fourth argument (not second). Today [`use-invoice-builder.ts`](src/features/invoices/hooks/use-invoice-builder.ts) calls `buildLineItemsFromTrips(trips, rules, clientPriceTags)` — add fourth array.
- Update **`fetchBuilderTripsAndRules`** if it composes the same path.

Pass into `resolveEffectiveDistanceKm` **trip’s** `billing_variant_id` once resolver accepts variant-aware overrides.

---

## 4. `resolved_rule` on `BuilderLineItem`

- [`src/features/invoices/types/invoice.types.ts`](src/features/invoices/types/invoice.types.ts): After `price_resolution`, add optional `resolved_rule?: BillingPricingRuleLike | null`.
- **Import** `BillingPricingRuleLike` from [`src/features/invoices/types/pricing.types.ts`](src/features/invoices/types/pricing.types.ts) — **not** `payers/types` (that path does not exist for this type).
- [`invoice-line-items.api.ts`](src/features/invoices/api/invoice-line-items.api.ts) **`buildLineItemsFromTrips`**: set `resolved_rule: rule ?? null` using the **existing** `const rule = resolvePricingRule(...)` in scope before/after `resolveTripPricePure`.

---

## 5. Full repricing: `applyKmOverride` + `resetKmOverride`

**Pre-flight (original price snapshot — no new field):** [`BuilderLineItem`](src/features/invoices/types/invoice.types.ts) already has **`originalPriceResolution?: PriceResolution`** — “Snapshot of the engine-computed `PriceResolution` before any admin override”, used by **`resetLineItemOverride`**. It is set once in [`buildLineItemsFromTrips`](src/features/invoices/api/invoice-line-items.api.ts) as `originalPriceResolution: priceResolution` (same object as initial `price_resolution`). **Do not add** `original_price_resolution`; **`applyKmOverride` must never assign to `originalPriceResolution`**. Phase 3 **`resetKmOverride`** should restore line pricing from **`const orig = item.originalPriceResolution ?? item.price_resolution`** (mirror gross reset), then set `effective_distance_km` / `tax_rate` / `approach_fee_*` / `unit_price` / `quantity` / `kts_override` / `price_source` consistently with `orig`. *Edge case:* if gross override and KM override stack, product intent for “reset KM” may need a follow-up; minimal scope is restore engine snapshot + original distance.

- [`src/features/invoices/hooks/use-invoice-builder.ts`](src/features/invoices/hooks/use-invoice-builder.ts):
  - Import **`resolveTripPrice` as `resolveTripPricePure`** from [`resolve-trip-price.ts`](src/features/invoices/lib/resolve-trip-price.ts).
  - **`tripInputFromLineItem(item)`** private helper: build [`TripPriceInput`](src/features/invoices/lib/resolve-trip-price.ts) (`kts_document_applies`, `net_price`/`base_net_price` — use `null` with `// why` if not on `BuilderLineItem`; `manual_gross_price` only if you can derive safely).
  - **Guard:** If `item.price_resolution.source === 'manual_gross_price'` (Taxameter), **do not** re-run full `resolveTripPricePure` on KM change — keep Phase 2 behavior (tax tier + `approach_fee_gross` sync + `price_resolution.tax_rate` patch only). // why: P0 gross is all-in; km repricing would corrupt the metered contract.
  - If `item.resolved_rule` and not Taxameter: `resolveTripPricePure({ ...tripInput, driving_distance_km: km }, newTaxRate, item.resolved_rule)` then patch `price_resolution`, `unit_price`, `quantity`, `approach_fee_net`, `approach_fee_gross` (from new approach net × (1+rate)), `tax_rate`, `kts_override` / `price_source` from resolution.
  - **`resetKmOverride`:** After repricing, reset must restore **`originalPriceResolution`**, `unit_price` from original, `approach_fee_net` / `approach_fee_gross`, `effective_distance_km` / `original_distance_km`, `tax_rate` from `resolveTaxRate(original_distance_km)`, not only patch `tax_rate` on current resolution (otherwise unit_price stays wrong).

---

## 6. PDF: effective km

- [`pdf-column-catalog.ts`](src/features/invoices/lib/pdf-column-catalog.ts): `distance_km` entry — change **`dataField`** to `'effective_distance_km'`, update **description** (billed distance); **key stays** `distance_km`.
- [`build-invoice-pdf-summary.ts`](src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts): Replace **all** accumulations of `item.distance_km` for `total_km` / `has_null_km` with **`item.effective_distance_km`** (lines ~215–218, ~306–309, ~412–415) and update JSDoc comments that still say `distance_km`.
- [`InvoicePdfDocument.tsx`](src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx): Verify `effective_distance_km: li.effective_distance_km ?? li.distance_km` — keep.

---

## 7. `ClientKmOverrideStep` + dialog + client panel

- **New** [`client-km-override-step.tsx`](src/features/payers/components/pricing-rule-dialog/client-km-override-step.tsx): Clone [`client-price-tag-step.tsx`](src/features/payers/components/pricing-rule-dialog/client-price-tag-step.tsx); distance field; **no** `is_active` toggle if table still has it — use soft-delete via `is_active: false` **or** hard delete only; DB has `is_active` — either support toggle via `update` or delete-only (spec said no toggle — then use delete + list; if rows are `is_active`, filter list like price tags or always true on insert).
- Save branches: **global** `payer_id null`, `billing_variant_id null`; **payer-only** `payer_id set`, `billing_variant_id null`; **variant** `payer_id null`, `billing_variant_id set` (match `insertClientPriceTag` pattern) — align with DB columns after migration.
- [`pricing.types.ts`](src/features/invoices/types/pricing.types.ts): Add **`client_km_override`** to `PRICING_STRATEGIES` (with `client_price_tag` in Step 1 grid).
- [`pricing-strategy-labels-de.ts`](src/features/invoices/lib/pricing-strategy-labels-de.ts) + [`pricing-rule-dialog.types.ts`](src/features/payers/components/pricing-rule-dialog/pricing-rule-dialog.types.ts) `STRATEGY_DESCRIPTION`: new entries.
- [`pricing-rule-config.schema.ts`](src/features/invoices/lib/pricing-rule-config.schema.ts): Add Zod branch `client_km_override` with `emptyConfigSchema`; extend **`parseConfigForStrategy`** `case` (never persisted to `billing_pricing_rules` — only for exhaustiveness if something parses).
- [`pricing-rule-dialog/index.tsx`](src/features/payers/components/pricing-rule-dialog/index.tsx): Mirror **`client_price_tag`** — `isClientKmOverrideManager`, `showFertig`, **no** `createPricingRule` submit for this strategy; render `ClientKmOverrideStep`.
- [`client-detail-panel.tsx`](src/features/clients/components/client-detail-panel.tsx): „KM-Overrides“ section + second `PricingRuleDialog` with `initialStrategy='client_km_override'`; **`onSaved`** should invalidate **`referenceKeys`** for km manager (add `clientKmOverridesManager(clientId)` in [`src/query/keys/reference.ts`](src/query/keys/reference.ts)) — not only close dialog.

---

## 8. Tests and docs

- [`calculate-invoice-totals.test.ts`](src/features/invoices/api/__tests__/calculate-invoice-totals.test.ts) / any `BuilderLineItem` fixtures: add `resolved_rule` optional; fix km fields if assertions depend on routing km.
- Docs: [`docs/manual-km-overrides.md`](docs/manual-km-overrides.md), [`docs/invoices-module.md`](docs/invoices-module.md), [`docs/clients.md`](docs/clients.md), [`docs/pricing-engine.md`](docs/pricing-engine.md) — Phase 3, migration note, repricing, PDF.

---

## Hard rules (unchanged)

- Never write `trips.driving_distance_km`; never overwrite `BuilderLineItem.distance_km`.
- PDF column **key** remains `distance_km`.
- Do not change `ClientPriceTagStep` / `Step2ScopePicker` / gross override mutators.

---

## Gates

- `bun run build` after each major step; final **`bun test`**.
