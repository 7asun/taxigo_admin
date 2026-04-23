# Invoice Price Override — Audit

**Date:** 2026-04-23
**Scope:** Read-only. No code changes. Files examined in full:

- `src/app/dashboard/invoices/new/page.tsx`
- `src/features/invoices/components/invoice-builder/index.tsx`
- `src/features/invoices/hooks/use-invoice-builder.ts`
- `src/features/invoices/api/invoice-line-items.api.ts`
- `src/features/invoices/api/invoices.api.ts`
- `src/features/invoices/components/invoice-builder/step-3-line-items.tsx`
- `src/features/invoices/types/invoice.types.ts`
- `src/features/invoices/lib/resolve-pricing-rule.ts`
- `src/features/invoices/lib/resolve-trip-price.ts`
- `src/features/trips/lib/trip-price-engine.ts`
- `src/features/trips/api/trips.service.ts`
- `src/features/trips/hooks/use-update-trip-mutation.ts`
- `src/types/database.types.ts` — `trips`, `billing_pricing_rules` table definitions
- `docs/access-control.md`
- `docs/plans/price-calculation-audit.md`
- `docs/plans/billing-type-backfill-audit.md`
- `docs/plans/price-engine-resolution-audit.md`

---

## 1. Invoice Creation Flow

### Component tree

```
src/app/dashboard/invoices/new/page.tsx        ← Server component
  └── InvoiceBuilder                            ← src/features/invoices/components/invoice-builder/index.tsx
        ├── Step1Mode         (mode selection)
        ├── Step2Params       (payer, billing type, date range, client)
        ├── Step3LineItems    ← inline-editable price table
        ├── Step4Vorlage      (PDF template, intro/outro blocks)
        └── Step4Confirm      (submit)
```

`useInvoiceBuilder` (`use-invoice-builder.ts`) is the single client-side state machine for all four steps. It owns:
- `step2Values` — the payer + date range params
- `lineItems: BuilderLineItem[]` — the in-memory price rows
- `totals` — computed netto/MwSt/brutto shown in step 3
- `updateLineItemPrice(position, price)` — inline edit handler
- `createMutation` — `useMutation` that calls `createInvoice` + `insertLineItems`

### When does the pricing engine run?

**Client-side, on user action (Step 2 submit), via `useQuery`.**

When the user submits Step 2, `step2Values` is set. A `useQuery` keyed on those params fires `buildLineItemsFromTrips(trips, rules, clientPriceTags)`, which calls `resolvePricingRule` + `resolveTripPricePure` for every trip. This is entirely in-browser — there is no server action or API route involved. Persistence is done directly from the browser to Supabase via `createClient()`.

The engine runs **again** whenever the user edits a price inline in Step 3 (via `applyManualUnitNetToResolution`), but this is a pure in-memory recomputation scoped to the edited line item only.

### Where does the calculated price enter form state?

`buildLineItemsFromTrips` returns `BuilderLineItem[]`. Each item's `unit_price` is `priceResolution.unit_price_net` (net amount per trip or per km). `setLineItems(items)` is called from the `queryFn`, populating the `lineItems` state in `useInvoiceBuilder`. Step 3 receives `lineItems` as a prop; `onUpdatePrice` is wired back to `updateLineItemPrice` in the hook. There is **no React Hook Form involved for line items** — they are plain `useState`.

At save time, `insertLineItems` freezes `item.unit_price` and `frozenPriceResolutionForInsert(item)` into `invoice_line_items.unit_price` and `invoice_line_items.price_resolution_snapshot` respectively.

---

## 2. Trip Data Model

### Price-related fields in `trips` (from `database.types.ts` `trips.Row`)

| Field | Type | Purpose |
|---|---|---|
| `net_price` | `number \| null` | Engine-computed net fare (Spec C output). Also used as P3 fallback in `resolveTripPrice` when no rule matches. |
| `gross_price` | `number \| null` | Engine-computed gross fare (`net_price × (1 + tax_rate) + approach_fee_net × (1 + tax_rate)`). |
| `tax_rate` | `number \| null` | VAT rate (0.07 or 0.19) computed from `driving_distance_km`. Null when `net_price` is null. |
| `driving_distance_km` | `number \| null` | Route distance; input to tiered-km strategies and tax rate resolver. |
| `kts_document_applies` | `boolean` | KTS flag → engine returns net=0 / gross=0 (P0 priority). |
| `selbstzahler_collected_amount` | `number \| null` | Cash collected for Selbstzahler trips — not a pricing input, billing bookkeeping only. |
| `no_invoice_required` | `boolean` | Soft advisory; does not affect engine output, only emits a warning in Step 3. |
| `billing_variant_id` | `string \| null` | Discriminator for rule resolution STEP 1. |
| `billing_type_id` | `string \| null` | Denormalized from `billing_variants.billing_type_id`; discriminator for rule resolution STEP 2. |
| `payer_id` | `string \| null` | Required for engine entry; discriminator for STEP 3 payer-wide fallback. |
| `client_id` | `string \| null` | Client-price-tag resolution (STEP 0). |

### Is there a `manual_price` or `price_override` field?

**No.** There is no column named `manual_price`, `price_override`, `manual_override_net`, or any equivalent in the `trips` table. The only manual override mechanism currently in the codebase is **the inline editor in Step 3 of the invoice builder** — it lives in-memory only and is never written back to the trip row.

### `updated_at` and audit trail on trips

**No `updated_at` column exists on `trips`** in `database.types.ts`. There is `created_at` and `created_by`, but no timestamp for last modification. There is no existing audit trail mechanism (no shadow table, no event log) for price changes on individual trips.

---

## 3. Invoice Line Item Structure

### Schema

Line items are a **separate table** (`invoice_line_items`), not embedded in the invoice row. The `InvoiceLineItemRow` type (from `invoice.types.ts`) maps the table exactly:

| Field | Type | Purpose |
|---|---|---|
| `id` | `string` | PK |
| `invoice_id` | `string` | FK → `invoices.id` |
| `trip_id` | `string \| null` | FK → `trips.id`; null for manually-added items |
| `position` | `number` | 1-based PDF sort order |
| `unit_price` | `number` | Net price per unit (frozen from `BuilderLineItem.unit_price`) |
| `quantity` | `number` | 1 for fixed-price; `driving_distance_km` for per-km strategies |
| `total_price` | `number` | Gross line total = `(unit_price × qty + approach_fee_net) × (1 + tax_rate)` |
| `tax_rate` | `number` | VAT rate (decimal) |
| `approach_fee_net` | `number \| null` | Anfahrtspreis (net) |
| `pricing_strategy_used` | `string \| null` | Frozen strategy enum value (`tiered_km`, `manual_trip_price`, etc.) |
| `pricing_source` | `string \| null` | Frozen source (`trip_price`, `client_price_tag`, etc.) |
| `kts_override` | `boolean` | True when strategy is `kts_override` (€0 KTS line) |
| `price_resolution_snapshot` | `Record<string, unknown> \| null` | Full `PriceResolution` object frozen at creation |
| `trip_meta_snapshot` | `TripMetaSnapshot \| null` | Driver, direction, etc. — §14 UStG snapshot |

### Which field holds the price sourced from the trip?

`invoice_line_items.unit_price` holds the net unit price as sourced from the trip at invoice creation time. It is frozen via `frozenPriceResolutionForInsert(item)` in `insertLineItems`. The full resolution provenance is in `price_resolution_snapshot.strategy_used` and `pricing_source`.

### Is there anything preventing drift between line item price and trip price?

**Yes — the snapshot principle.** The file header of `invoice-line-items.api.ts` states the design explicitly:

> "Line items are always created FROM trips, never edited after creation. If the data is wrong, the invoice must be storniert and a new one created. This is intentional — it matches German legal requirements (§14 UStG)."

After `insertLineItems` completes, the `invoice_line_items` row is **immutable** by design. Subsequent edits to the `trips` row cannot propagate back. The `invoices` / `invoice_line_items` tables have no database triggers that would sync changes. The only mutation path for a persisted line item is a Storno (cancellation + new invoice).

---

## 4. Pricing Engine Summary

### Location

The engine is a set of **pure TypeScript utility functions** spread across two files:

| File | Exports |
|------|---------|
| `src/features/trips/lib/trip-price-engine.ts` | `loadPricingContext`, `computeTripPrice`, `shouldRecalculatePrice`, `resolveTripForPricing` |
| `src/features/invoices/lib/resolve-pricing-rule.ts` | `resolvePricingRule` |
| `src/features/invoices/lib/resolve-trip-price.ts` | `resolveTripPrice` |
| `src/features/invoices/lib/tax-calculator.ts` | `resolveTaxRate` |

There is no Supabase Edge Function — all pricing logic is TypeScript executed in the browser (invoice builder) or in the Next.js server-side (trip create/edit paths).

### Return shape — full breakdown, not a single total

The engine returns a `PriceResolution` object:

```typescript
interface PriceResolution {
  unit_price_net: number | null;   // net per unit
  quantity: number;                // 1 or distance_km
  net: number | null;              // total net
  gross: number | null;            // total gross
  tax_rate: number;
  strategy_used: PricingStrategy | 'kts_override' | 'trip_price_fallback' | 'manual_trip_price' | 'no_price';
  source: 'client_price_tag' | 'trip_price' | 'rule' | ...;
  approach_fee_net: number | null;
  note: string | null;
}
```

### Is price read from the trip record or re-calculated?

**Both paths exist, separated by context:**

1. **Invoice builder (invoice creation):** Price is **re-calculated from scratch** via `buildLineItemsFromTrips`. It reads `trip.net_price` only as a P3 fallback (if all rule-based resolution fails). The engine does NOT use the stored `trips.gross_price`.

2. **Trip create/edit (`tripsService.updateTrip`):** `computeTripPrice` is called and the result is written back to `trips.net_price`, `trips.gross_price`, `trips.tax_rate`. On every subsequent edit that touches a `PRICING_RELEVANT_FIELD`, `resolveTripForPricing` intentionally **zeros `net_price`** before recomputing, preventing the stored snapshot from bleeding into the P3 fallback.

---

## 5. Current Update Path

### Mutation for updating a trip

`useUpdateTripMutation` (`src/features/trips/hooks/use-update-trip-mutation.ts`) — the only `useMutation` wrapper for trip updates:

```typescript
useMutation({
  mutationFn: ({ id, patch }: { id: string; patch: UpdateTrip }) =>
    tripsService.updateTrip(id, patch),
  onSuccess: (_data, { id }) =>
    queryClient.invalidateQueries({ queryKey: tripKeys.detail(id) })
});
```

`tripsService.updateTrip` (`trips.service.ts`) contains the auto-recalculate guard:

```typescript
if (shouldRecalculatePrice(trip)) {
  const tripInput = await resolveTripForPricing(supabase, id, trip);
  if (tripInput) {
    const context = await loadPricingContext(...).catch(() => null);
    if (context) Object.assign(trip, computeTripPrice(tripInput, context));
  }
}
```

`shouldRecalculatePrice` fires when the patch contains any of:
`payer_id`, `billing_type_id`, `billing_variant_id`, `client_id`, `kts_document_applies`,
`driving_distance_km`, `pickup_lat`, `pickup_lng`, `dropoff_lat`, `dropoff_lng`, `scheduled_at`.

Writing `net_price` directly in a patch does **not** appear in `PRICING_RELEVANT_FIELDS`, so it would NOT trigger recalculation — but the stored `net_price` would be overwritten the next time any of the above fields are touched.

### RLS on `trips`

From `docs/access-control.md`:

| Role | `trips` access |
|------|---------------|
| `driver` | SELECT/UPDATE own trips (`driver_id = auth.uid()` or via `trip_assignments`) |
| `admin` | **Full CRUD, company-scoped** |

The admin role (which operates the invoice builder and dispatcher UI) can SELECT, INSERT, UPDATE, and DELETE trips directly from the browser via the Supabase browser client — no server action proxy required. Writing a new column to a trip row from the admin frontend is straightforward under existing RLS.

---

## 6. UI Patterns Available

### Existing editable price cell in Step 3

`Step3LineItems` already implements a **click-to-edit inline price cell** (the exact pattern needed for a price override):

```
price cell (button)
  → onClick: startEdit(position, item)
  → renders <Input type="number" autoFocus>
    → onBlur / Enter: commitEdit(position)
    → onKeyDown Escape: cancel
  → calls onUpdatePrice(position, newNet) → hook's updateLineItemPrice
```

The `Input` component is shadcn's `<Input>` from `src/components/ui/input`. No custom editable cell — pure shadcn + local state (`useState<number | null>(null)` for which position is editing).

### Other patterns in the codebase

| Location | Pattern |
|----------|---------|
| `text-block-card.tsx` | `Pencil` icon (lucide-react) to enter edit mode |
| `driver-select-cell.tsx` (`trips-tables/`) | Inline select cell in a TanStack Table column |
| `step-2-params.tsx`, `step-4-confirm.tsx` | Standard `<Input>` fields inside React Hook Form |
| `src/components/ui/input.tsx` | shadcn `Input` — base component for all inputs |
| `src/components/ui/popover.tsx` | shadcn `Popover` — used for popovers/dropdowns elsewhere |

The established convention for inline cell editing is: `<button>` showing display value → click opens `<Input>` → blur/Enter/Escape commits or cancels. No custom `EditableCell` abstraction exists; it is re-implemented per callsite.

---

## 7. Senior-Level Recommendation

### The feature scope matters — two different features share this name

Before recommending an approach, it is critical to distinguish between two interpretations of "price override":

**Interpretation A — Invoice-builder override (ephemeral, per invoice)**
An admin sets a custom price during invoice creation. The override lives only for the duration of the builder session and is frozen into the line item at save. **This feature already exists.** Step 3's click-to-edit cell calls `applyManualUnitNetToResolution`, which stamps `strategy_used: 'manual_trip_price'` on the `PriceResolution`. The line item's `price_resolution_snapshot` records the provenance. Nothing more is needed here.

**Interpretation B — Persistent trip-level override (durable, pre-invoice)**
An admin marks a specific trip with a manually set price that should take precedence over all pricing rules and survive across invoice rebuilds. This feature **does not exist** and requires schema and engine changes.

The analysis below focuses on Interpretation B, as that is the meaningful open feature.

---

### Where should the override input live?

**On the trip edit form / trip detail sheet**, not in the invoice builder. The invoice builder is downstream — it should simply consume whatever override is stored on the trip. Duplicating override UI in the builder is the wrong level of abstraction.

Concretely: add a collapsible "Manueller Preis" section to the existing trip edit form. A single `<Input type="number" step="0.01">` labelled **"Manueller Nettopreis (€)"** with a clear "Überschreibt Preisregel" sub-label. If filled, the badge in Step 3 should show "Manuell" (the `manual_trip_price` badge already exists in `priceResolutionBadge`).

---

### When should the trip record be updated?

**On explicit Save**, not on change (no auto-save). Rationale:

1. The trip edit form already follows a Save pattern via `useUpdateTripMutation` — inline autosave is not established for any field.
2. The pricing engine (`tripsService.updateTrip`) recalculates on save if `shouldRecalculatePrice` fires. A new `manual_price_net` field must NOT be in `PRICING_RELEVANT_FIELDS` — it takes effect via the new priority level in `resolveTripPrice`, not by triggering an engine recompute.

---

### Does the schema need a new field?

**Yes — one new nullable column on `trips`.**

Do NOT reuse `trips.net_price` for manual overrides. The reasons are fundamental to how the engine is designed:

1. `computeTripPrice` / `resolveTripForPricing` **intentionally zeroes `net_price`** before each recalculation (lines 360–362 of `trip-price-engine.ts`). Any value you write to `net_price` as a manual override will be silently erased the next time any `PRICING_RELEVANT_FIELD` is patched on the trip.

2. `trips.net_price` serves as the P3 fallback (last resort when no rule matches). Conflating "engine output" with "human intent" in the same column violates the single-responsibility of that field and makes the cascade logic ambiguous.

**Recommended schema addition:**

```sql
ALTER TABLE public.trips
  ADD COLUMN manual_price_net numeric(12, 4) DEFAULT NULL;
```

**Recommended engine integration** — add a new P0.5 priority level in `resolveTripPrice`, between the KTS check (P0) and the client price tag (P1):

```
P0   — kts_document_applies → net=0, gross=0
P0.5 — trip.manual_price_net IS NOT NULL → use as unit_price_net, strategy_used='manual_trip_price'
P1   — client price tag
P2   — rule strategy
P3   — trip.net_price fallback
P4   — unresolved (null)
```

**Recommended `ComputeTripPriceInput` change** — add `manual_price_net: number | null` to the input type so `computeTripPrice` receives it from `resolveTripForPricing` and passes it through to `resolveTripPrice`.

**Recommended `shouldRecalculatePrice` change** — do NOT add `manual_price_net` to `PRICING_RELEVANT_FIELDS`. The engine does not need to re-evaluate rules when a manual override is set — the override short-circuits rule resolution entirely. Setting or clearing `manual_price_net` should update `trips.net_price` / `gross_price` / `tax_rate` in `tripsService.updateTrip` via a lightweight dedicated write path (or by treating `manual_price_net` patch as a pseudo-pricing recalculation: include it in the `PRICING_RELEVANT_FIELDS` list and handle it explicitly in `resolveTripForPricing` by NOT zeroing `net_price` in this case). The simplest approach is to add `manual_price_net` to `PRICING_RELEVANT_FIELDS` so `updateTrip` recomputes prices when it changes — this produces correct `net_price` / `gross_price` / `tax_rate` on the trip row.

**Recommended `TripForInvoice` change** — add `manual_price_net: number | null` to the SELECT in `fetchTripsForBuilder` and to the `TripForInvoice` type, and pass it into `buildLineItemsFromTrips` → `resolveTripPricePure`.

---

### Summary table

| Question | Answer |
|---|---|
| Override input location | Trip edit form / trip detail sheet — "Manueller Nettopreis" field |
| When trip record updates | On explicit Save (same as all trip edits) |
| Schema change needed? | **Yes** — `manual_price_net numeric(12,4) DEFAULT NULL` on `trips` |
| Engine change needed? | **Yes** — P0.5 priority in `resolveTripPrice`; pass-through in `ComputeTripPriceInput` / `fetchTripsForBuilder` |
| Invoice builder change needed? | Minor — `fetchTripsForBuilder` needs to select the new field; `Step3LineItems` badge already shows "Manuell" for `manual_trip_price` strategy |
| Existing Step 3 inline edit | Keep as-is — it is correct for ephemeral invoice-session overrides and fills the same badge |
| `trips.net_price` reused for override? | **No** — engine zeroes it on every recalculation; conflation would cause silent data loss |
| RLS blocker? | None — admin has full CRUD on `trips` company-scoped |
| Audit trail? | `trips` has no `updated_at`. Consider adding `manual_price_set_at timestamptz` and `manual_price_set_by text` alongside `manual_price_net` for auditability, since `trips` has no general-purpose change log. |
