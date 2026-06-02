# Invoice Builder Tax Rate UI + Write-Back Audit

**Status:** Implemented (Step 3 override + write-back, 2026-06).

Read-only audit of Step 3 MwSt display/editing and trip write-back after invoice create/save.  
Companion: [`tax-rate-audit.md`](tax-rate-audit.md) (global tax model).

---

## A. Current Tax Rate UI in Step 3

### 1. How `tax_rate` is rendered per line item

**Read-only text — no dropdown, input, or select for MwSt.**

| Location | Rendering | Lines (approx.) |
|----------|-----------|-----------------|
| **Expanded panel** (after chevron) | `<span className='text-muted-foreground text-xs'>MwSt {formatTaxRate(item.tax_rate)}</span>` | `step-3-line-items.tsx` L890–892 |
| **Expanded breakdown** (when row open and gross &gt; 0) | Row label `MwSt ({formatTaxRate(item.tax_rate)})` + computed VAT amount | L1041–1045 |

`formatTaxRate` comes from `src/features/invoices/lib/tax-calculator.ts` (e.g. `0.07` → `"7 %"`).

**Not shown in the collapsed row** — only position `#n`, client, date, routing km, optional manual km input, and **Bruttopreis** `<Input>`.

**Layout:** Not a `<table>`. Each trip is a **`Collapsible` card** inside a scrollable `div` with `divide-y`. Collapsed row uses **CSS grid** `grid-cols-[auto_1fr_auto_auto]` (checkbox | meta | km column | price column). Expanded content is a bordered panel below (`CollapsibleContent`).

**Editable controls on the row (other fields):**

| Control | Field | Where |
|---------|-------|--------|
| `<Checkbox>` | Billing inclusion | Collapsed, left column |
| `<Input>` | Manual km (if `manual_km_enabled`) | Collapsed, km column |
| `<Input>` | Bruttopreis (gross total) | Collapsed, price column |
| `<Input>` | Anfahrtskosten brutto | Expanded panel only |
| `<Dialog>` + `<Textarea>` | Exclusion reason | Opt-out flow |
| Buttons | Reset Taxameter / KM override | `<X>` next to badges |

**No `<Select>`** is imported or used anywhere in `step-3-line-items.tsx`.

---

### 2. Single line item row structure

**Collapsed row (always visible):**

1. Inclusion checkbox  
2. `#position`, optional Maps link, client name, formatted date  
3. Opt-out badge + reason (if excluded)  
4. Routing km label (`original_distance_km` or `distance_km`)  
5. Optional manual km `<Input>` + “KM manuell” badge + reset  
6. Taxameter badge + warning tooltip + Bruttopreis `<Input>`  
7. Chevron (expand/collapse)

**Expanded panel (optional):**

- Pickup / dropoff addresses (2-column grid)  
- Time + **pricing strategy badge** (`priceResolutionBadge`) + **MwSt text**  
- Billing variant / KTS / “Keine Rechn.” badges  
- Anfahrt gross `<Input>`  
- Net/VAT/gross **breakdown** (derived from `price_resolution.net` + `tax_rate`)  
- Inline warning list (`item.warnings`)

**Footer (all rows):** sticky Netto / MwSt / Brutto totals for **included** lines only (from hook props).

**Editing model:** **Inline** on the card — no sheet/modal for normal trips. Opt-out uses a **Dialog**. Cancelled trips use a separate collapsible section with similar inline gross/km patterns.

**No dedicated “tax_rate column”** in the grid; MwSt is secondary text in the expanded section only.

---

### 3. KM change → tax and price updates

**UI path (`step-3-line-items.tsx`):**

- Debounced commit (`KM_INPUT_DEBOUNCE_MS = 600`) calls `onApplyKmOverride(position, parsed)` (L324 area).  
- Reset: `onResetKmOverride(position)`.

**Hook handler: `applyKmOverride`** — `use-invoice-builder.ts` **L404–469**.

| Step | Behavior |
|------|----------|
| 1 | `resolveTaxRate(km)` — **L410** |
| 2 | Sets `effective_distance_km`, `manualDistanceKm`, `isManualKmOverride: true`, **`tax_rate: newTaxRate`** |
| 3 | **Taxameter** (`price_resolution.source === 'manual_gross_price'`): repricing **skipped**; only km + tax_rate + approach gross refresh (L414–430) |
| 4 | **Otherwise:** `resolveTripPricePure(..., newTaxRate, resolved_rule)` (L433–441) → updates `unit_price`, `quantity`, `approach_fee_net`, `approach_fee_gross`, `price_resolution`, `kts_override` |
| 5 | Re-runs `validateLineItem` on patched row |

**`resetKmOverride`** — L472–498: `resolveTaxRate(item.original_distance_km)` → restores `tax_rate`, distances, and `originalPriceResolution`.

**Cancelled trips:** `handleCancelledTripKmOverride` — L597–681 (same `resolveTaxRate` at L609).

**Does it update `net_price` on the builder object?**  
There is **no** top-level `net_price` field on `BuilderLineItem`. Net lives on **`price_resolution.net`** (and display uses `lineItemGrossTotalForDisplay`). Gross display uses `manualGrossTotal` when overridden, else resolution gross + approach.

**Builder line item fields in hook state** (from `BuilderLineItem` + runtime usage):

| Field | Set at build / edited in Step 3 |
|-------|----------------------------------|
| `trip_id`, `position`, `line_date`, `description` | Build |
| `client_name`, `pickup_address`, `dropoff_address` | Build |
| `distance_km`, `effective_distance_km`, `original_distance_km` | Build / KM override |
| `manual_km_enabled` | Build (payer flag) |
| `manualDistanceKm`, `isManualKmOverride` | KM override |
| `unit_price`, `quantity`, `tax_rate` | Build / KM / gross override |
| `approach_fee_net`, `approach_fee_gross` | Build / KM / gross override |
| `billing_variant_*`, `billing_type_name` | Build |
| `kts_document_applies`, `no_invoice_warning` | Build |
| `price_resolution`, `resolved_rule`, `kts_override` | Build / KM / gross override |
| `trip_meta`, `price_source`, `warnings` | Build / validators |
| `billingInclusion` | Inclusion UI |
| `originalPriceResolution` | Build |
| `manualGrossTotal`, `manualApproachFeeGross`, `isManualOverride` | Gross override |

---

### 4. `is_wheelchair` on builder line items

| Layer | Present? |
|-------|----------|
| **`BuilderLineItem`** (`invoice.types.ts` L539–695) | **No** `is_wheelchair` field |
| **`TripForInvoice`** (L286–344) | **No** `is_wheelchair` |
| **`fetchTripsForBuilder` select** (`invoice-line-items.api.ts` L288–315) | **Does not fetch** `is_wheelchair` |
| **`buildLineItemsFromTrips`** (L651–704 return object) | **Does not map** wheelchair |

**Conclusion:** Step 3 has **no access** to wheelchair flag today unless you extend the fetch + `BuilderLineItem` + mapper. The hook only holds `lineItems: BuilderLineItem[]` and does not retain raw `TripForInvoice[]` after the trips query resolves (items are copied into state via `setLineItems(buildLineItemsFromTrips(...))`).

---

## B. Write-Back: Invoice → Trip

### 5. Every `tripsService.updateTrip` call in `use-invoice-builder.ts`

**Two identical blocks** — create and draft update. **No other** `updateTrip` usage in this file.

#### Call A — `createMutation` success path (inside `mutationFn`, after `insertLineItems`)

| Aspect | Detail |
|--------|--------|
| **Trigger** | User completes Step 4/5 and `createMutation.mutate` runs |
| **When** | After `createInvoice` + `await insertLineItems(...)` — L845 |
| **Concurrency** | `void Promise.allSettled([...])` — **fire-and-forget** (L851) |
| **Filter** | `lineItems.filter((item) => item.trip_id !== null)` — **all** normal rows with a trip id, **including opted-out** (`billingInclusion.included === false`) |
| **Patch** (L857–868) | See table below |
| **Error handling** | **None** — failures swallowed by `allSettled`; invoice creation still succeeds |

#### Call B — `updateMutation` (draft edit save)

| Aspect | Detail |
|--------|--------|
| **Trigger** | `updateInvoice` → `updateMutation.mutate` |
| **When** | After `await updateDraftInvoice({...})` — L951–959 |
| **Concurrency** | Same `void Promise.allSettled` — L963 |
| **Filter / patch** | **Same** as Call A — L969–980 |

**Exact `updateTrip` payload (both calls):**

```typescript
{
  gross_price: item.manualGrossTotal ?? item.price_resolution.gross,
  tax_rate: item.tax_rate,
  base_net_price: baseNet,  // item.price_resolution.net (transport net)
  approach_fee_net: approachNet,  // item.approach_fee_net ?? 0
  ...(item.isManualOverride && item.manualGrossTotal !== null
    ? { manual_gross_price: item.manualGrossTotal }
    : {}),
  ...(item.isManualKmOverride && item.manualDistanceKm != null
    ? { manual_distance_km: item.manualDistanceKm }
    : {})
}
```

**Not written:** `net_price` (generated column), `driving_distance_km`, `is_wheelchair`, `billing_*`.

**Cancelled trips:** opted-in cancelled rows are persisted on the invoice but **do not** get a `updateTrip` in this hook (only `lineItems` array is iterated).

---

### 6. Write-back from `invoice-line-items.api.ts`

**`insertLineItems` (L1025–1051):** Inserts into `invoice_line_items` only. **No** trip table updates.

All trip write-back is **exclusively** in `use-invoice-builder.ts` (create + draft update mutations).

---

### 7. Draft update path

| Step | Trip write-back? |
|------|------------------|
| `updateDraftInvoice` → RPC `replace_draft_invoice_line_items` | **No** — lines + server totals only (`invoices.api.ts` L355–405) |
| `updateMutation` after RPC | **Yes** — same `Promise.allSettled` + `updateTrip` as create (L961–982) |

Saving a draft edit **does** run trip write-back when the user saves from the edit builder.

---

### 8. Which trip fields are written today

| Field | Written? | Source on write-back |
|-------|----------|----------------------|
| `tax_rate` | **Yes** | `item.tax_rate` (builder state, possibly changed by KM override) |
| `gross_price` | **Yes** | `manualGrossTotal` or `price_resolution.gross` (line gross anchor, not always “full trip gross” if approach stored separately) |
| `base_net_price` | **Yes** | `price_resolution.net` (transport net only) |
| `approach_fee_net` | **Yes** | `item.approach_fee_net ?? 0` |
| `manual_gross_price` | **Conditional** | Only if `isManualOverride && manualGrossTotal != null` |
| `manual_distance_km` | **Conditional** | Only if `isManualKmOverride && manualDistanceKm != null` |

**`updateTrip` + `shouldRecalculatePrice`:**  
`tax_rate`, `gross_price`, `base_net_price`, `approach_fee_net`, `manual_gross_price`, and `manual_distance_km` are **not** in `PRICING_RELEVANT_FIELDS` (`trip-price-engine.ts` L292–307). A write-back patch with **only** these fields **does not** invoke `computeTripPrice` — explicit values from the invoice builder are persisted as sent.

**Exception:** If a future write-back accidentally included e.g. `driving_distance_km` or `payer_id`, `updateTrip` would merge via `resolveTripForPricing` and **overwrite** price fields with engine output.

---

### 9. `updateTrip` signature and guards

```typescript
async updateTrip(id: string, trip: UpdateTrip)
```

- `UpdateTrip` = Supabase `trips` **Update** type (partial row).  
- **No** app-level allowlist — any updatable column can be passed.  
- **No** rejection of `gross_price` / `base_net_price` from “outside” the engine when pricing-relevant fields are absent.  
- **RLS** applies (tenant scope); no special invoice-builder guard.  
- **`net_price`:** must not be sent (generated); write-back correctly omits it.

---

### 10. Risk: overwriting `manual_gross_price` / taxameter trips

| Scenario | Behavior |
|----------|----------|
| Trip already has DB `manual_gross_price` (taxameter), user **does not** use gross override in builder | Write-back sets `gross_price` from `price_resolution.gross`; **does not** set `manual_gross_price` unless `isManualOverride` |
| User commits **gross override** in Step 3 | Sets `manual_gross_price` on trip to `manualGrossTotal` — **intended** sync |
| User only changes **KM** on taxameter line | `applyKmOverride` keeps gross resolution; write-back still sends `gross_price` from resolution + new `tax_rate` |
| User changes **tax_rate** manually (future) without repricing | Would write inconsistent `gross_price` unless UI also recomputes `price_resolution` / gross |

**No `pricing_mode` column** on trips. Taxameter is represented by `manual_gross_price` + `price_resolution.source === 'manual_gross_price'`.

**Opted-out trips still written:** Write-back does **not** check `billingInclusion.included`. Excluded trips still update trip price columns on invoice create/save — may surprise dispatchers who thought exclusion was invoice-only.

---

## C. Design Context

### 11. Existing warning / badge patterns on Step 3 rows

| Pattern | Implementation |
|---------|----------------|
| **Pricing strategy** | `priceResolutionBadge(item)` → colored `Badge` (Taxameter, KTS · 0 €, Kunden-Preis, Staffel km, …) — L75–142, L874–888 |
| **KTS** | Badge “KTS” when `kts_document_applies` — L907–914 |
| **No invoice** | Amber “Keine Rechn.” when `no_invoice_warning` — L916–923 |
| **Opted out** | “Ausgeschlossen” badge + reason snippet — L639–652 |
| **KM manual** | Amber “KM manuell” + reset — L717–737 |
| **Taxameter override** | Amber “Taxameter” + reset — L743–766 |
| **Validator warnings** | `AlertTriangle` tooltip (collapsed) + inline list (expanded) — `item.warnings` / `getWarningLabel` |
| **Missing price** | Left border `border-destructive`, amber row bg — L537–542, L556–558 |
| **KTS invoice banner** | Top `Alert` when any line has `kts_document_applies` — L461–482 |
| **Manual override border** | `border-amber-400` when `isManualOverride` — L541–542 |

**No wheelchair-specific badge today.**

---

### 12. shadcn/ui (and related) imports in `step-3-line-items.tsx`

From file header imports:

- `Button`
- `Input`
- `Badge`
- `Checkbox`
- `Label`
- `Textarea`
- `Dialog`, `DialogContent`, `DialogFooter`, `DialogHeader`, `DialogTitle`
- `Collapsible`, `CollapsibleContent`, `CollapsibleTrigger`
- `Tooltip`, `TooltipContent`, `TooltipProvider`, `TooltipTrigger`
- `Alert`, `AlertDescription`

**Not imported:** `Select`, `Popover`, `RadioGroup`, `Switch`, `Tabs`, `Sheet`.

Lucide icons: `AlertTriangle`, `ChevronDown`, `Info`, `Map`, `X`.

Adding a tax-rate dropdown would typically use `@/components/ui/select` (not yet used in this file).

---

### 13. `BuilderLineItem` type (full)

From `src/features/invoices/types/invoice.types.ts`:

```typescript
export interface BuilderLineItem {
  /** Source trip ID — null for manually added items. */
  trip_id: string | null;
  /** 1-based row order; assigned when building from the fetched trip list. */
  position: number;
  /** Snapshot of `trips.scheduled_at` (ISO) for display and PDF. */
  line_date: string | null;
  /** Human-readable line title built in `buildLineItemsFromTrips` (date + client). */
  description: string;
  /** Passenger name snapshot from `trips.client` at build time. */
  client_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  /**
   * Snapshot of `trips.driving_distance_km` for Step 3 / PDF / detail display.
   * Pricing and VAT use `effective_distance_km`.
   */
  distance_km: number | null;
  /**
   * Effective distance used for pricing and VAT in this line item.
   * Resolved from: manual_distance_km → client_km_overrides → driving_distance_km.
   * Snapshotted to invoice_line_items.effective_distance_km on insert.
   */
  effective_distance_km: number | null;
  /**
   * Snapshot of trips.driving_distance_km at build time — the routing provider value.
   * Always preserved regardless of any override. Displayed read-only in Step 3
   * alongside the manual KM input. Snapshotted to invoice_line_items.original_distance_km.
   */
  original_distance_km: number | null;
  /**
   * `payers.manual_km_enabled` at build time — Step 3 shows KM input when true.
   * Same payer for all rows in a session; avoids threading payer through Step 3 props.
   */
  manual_km_enabled?: boolean;

  // ── In-session KM override (set by admin in Step 3) ─────────────────────────

  /**
   * KM value committed by the admin in this builder session via the Step 3
   * inline input. null = not overridden in this session.
   * Written back to trips.manual_distance_km on invoice save (fire-and-forget)
   * so the same effective KM pre-resolves in future sessions.
   */
  manualDistanceKm?: number | null;

  /**
   * true when the admin has committed a KM override via applyKmOverride in
   * this session. Drives the amber "KM manuell" badge and × reset button.
   */
  isManualKmOverride?: boolean;
  /**
   * Net unit price for the line (€). Mirrors `price_resolution.unit_price_net` until the
   * user overrides in step 3; `null` means unresolved / missing (step-3 `missing_price`).
   */
  unit_price: number | null;
  /** Net Anfahrtspreis for this trip. Null if resolver omitted it (no rule fee or tag/KTS path). */
  approach_fee_net: number | null;
  /**
   * Billing quantity from `PriceResolution.quantity` (usually `1`; equals km for per-km rules).
   */
  quantity: number;
  /** VAT rate from `resolveTaxRate(effective_distance_km)` — not from the pricing rule. */
  tax_rate: number;
  /** From joined `billing_variants.code` on the trip. */
  billing_variant_code: string | null;
  /** From joined `billing_variants.name` on the trip. */
  billing_variant_name: string | null;
  /** From joined `billing_types.name` via billing_variants.billing_type (family label). */
  billing_type_name: string | null;
  /**
   * Copy of `trips.kts_document_applies` — informational badge; actual €0 KTS pricing is
   * reflected in `price_resolution` / `kts_override`.
   */
  kts_document_applies: boolean;
  /**
   * Copy of `trips.no_invoice_required` — soft advisory only; does not block the wizard.
   */
  no_invoice_warning: boolean;
  /**
   * Full output of `resolveTripPrice` for this trip (strategy, source, net, gross, notes).
   * Persisted as `invoice_line_items.price_resolution_snapshot` on insert; step-4 tooltips
   * read `strategy_used` and `source` from here.
   */
  price_resolution: PriceResolution;
  /**
   * Rule passed to `resolveTripPrice` at build time so `applyKmOverride` can reprice with a
   * new effective KM without inferring config from the snapshot. Null when no active rule applied.
   */
  resolved_rule?: BillingPricingRuleLike | null;
  /**
   * `true` when `price_resolution.strategy_used === 'kts_override'` (KTS branch in
   * `resolveTripPrice`). Skips the `zero_price` validator warning for €0 lines.
   */
  kts_override: boolean;

  /**
   * Trip-only PDF snapshot; persisted as `trip_meta_snapshot` on insert — §14 UStG.
   */
  trip_meta: TripMetaSnapshot | null;

  /**
   * Legacy subset of `price_resolution.source` for incremental UI migration
   * (`client_price_tag` | `trip_price` only).
   * @deprecated Prefer `price_resolution.source` and DB `pricing_source`.
   */
  price_source: 'client_price_tag' | 'trip_price' | null;

  /**
   * Advisory codes from `validateLineItem` (missing price, distance, no-invoice trip, …).
   */
  warnings: LineItemWarning[];

  /**
   * Billing inclusion state for this trip.
   * Default: `{ included: true, reason: '' }` (all normal trips are included by default).
   * When the admin opts out, `included` becomes false and `reason` is the required text.
   * Opted-out rows stay in the array — they are never spliced; they are excluded from totals only.
   */
  billingInclusion: BillingInclusionState;

  // ── Gross override fields (set by admin in Step 3) ──────────────────────────

  /**
   * Gross representation of `approach_fee_net × (1 + tax_rate)`; pre-computed at
   * build time in `buildLineItemsFromTrips`. Used to pre-fill the Anfahrt input
   * in edit mode without requiring a runtime multiplication.
   */
  approach_fee_gross?: number | null;

  /**
   * Snapshot of the engine-computed `PriceResolution` before any admin override.
   * Used by `resetLineItemOverride` to restore the original pricing.
   * Always set by `buildLineItemsFromTrips`; optional here only to avoid breaking
   * existing code paths before initialization.
   */
  originalPriceResolution?: PriceResolution;

  /**
   * Admin-entered gross total (transport + Anfahrt combined). `null` = not overridden;
   * engine-priced value is used instead.
   */
  manualGrossTotal?: number | null;

  /**
   * Admin-entered Anfahrtskosten gross. `null` = not overridden.
   */
  manualApproachFeeGross?: number | null;

  /**
   * `true` when the admin has committed a gross override via `applyGrossOverride`.
   * Drives the amber "Manuell" badge and the × reset button in Step 3.
   */
  isManualOverride?: boolean;
}
```

---

### 14. “Dirty / manually overridden” flags

| Flag | Meaning |
|------|---------|
| `isManualOverride` | Gross total committed via `applyGrossOverride` |
| `isManualKmOverride` | KM committed via `applyKmOverride` |
| `manualGrossTotal` / `manualApproachFeeGross` | Session gross override values |
| `manualDistanceKm` | Session km override value |
| `originalPriceResolution` | Reset target for gross override |

**No** generic `userModified`, `isDirty`, or `taxRateOverridden` flag.  
**No** dedicated flag for manual **tax rate** change (would need to be added alongside UI).

Hydration note (edit mode): `manualGrossTotal` / `isManualOverride` are **not** reconstructed from DB notes per `docs/invoices-module.md` — override lines may not show Taxameter reset UI after re-open.

---

## D. Risk Surface

### Adding an editable `tax_rate` dropdown per line (Step 3)

| Risk | Severity | Notes |
|------|----------|-------|
| **UI/state drift** | High | Changing only `tax_rate` without repricing `price_resolution` breaks breakdown (L1009–1023), `calculateInvoiceTotals`, and `lineItemToInsertRow` gross formula `(net + approach) × (1 + rate)` |
| **Taxameter lines** | High | Must mirror `applyKmOverride` branch — gross is fixed; only VAT split changes |
| **Gross-anchor `client_price_tag`** | Medium | Totals use `gross × qty` — changing rate changes implied net, not stored gross |
| **KTS €0 lines** | Low | Rate change is meaningless for money; still affects PDF VAT display |
| **Missing `is_wheelchair` on line** | Medium | Auto 0% from trip flag requires fetch + type extension |
| **Edit-mode hydration** | Medium | Mapper must round-trip custom rate if persisted only on line items |

### Extending write-back (`tax_rate` + `gross_price` + `base_net_price`)

| Risk | Severity | Notes |
|------|----------|-------|
| **`gross_price` semantics** | High | Current write uses `manualGrossTotal ?? price_resolution.gross` — may **not** equal full trip gross when approach is non-zero (engine stores combined gross in `computeTripPrice` but resolution.gross may be transport-only — verify per strategy) |
| **Opted-out trips still updated** | Medium | Write-back ignores `billingInclusion.included` |
| **Fire-and-forget failures** | Medium | Silent trip/invoice mismatch; no toast |
| **`computeTripPrice` not triggered** | Low (benefit) | Direct writes stick; unless patch includes `driving_distance_km` etc. |
| **Accidental engine overwrite** | Medium | Future write-back must avoid pricing-relevant fields in same patch |
| **`manual_gross_price` cleared** | Medium | Need explicit policy when rate changes without `isManualOverride` |
| **Draft RPC vs trip** | Low | RPC totals recompute from lines; trips updated separately — transient inconsistency if write-back fails |

---

## E. Senior Recommendation

### Tax rate UI (Step 3)

1. Add **`applyTaxRateOverride(position, rate)`** in `use-invoice-builder.ts` (parallel to `applyKmOverride`), not raw `setLineItems` in the view.
2. Handler logic by line kind:
   - **Taxameter / `isManualOverride`:** update `tax_rate`, refresh `approach_fee_gross`, adjust `price_resolution.tax_rate`; **do not** call `resolveTripPricePure` on transport gross.
   - **Gross-anchor tag:** update `tax_rate` only; totals already use stored gross.
   - **Net-anchor:** call `resolveTripPricePure` with **same** `effective_distance_km` and new rate (or re-derive gross via `applyGrossOverrideToResolution` if gross was manually set).
3. UI: small **`Select`** (7 % / 19 % / 0 % when legal) in collapsed row or expanded MwSt row; show **`isManualTaxRateOverride`** badge + reset to `resolveTaxRate(effective_distance_km)` (and wheelchair rule when added).
4. Extend **`TripForInvoice` + fetch + `BuilderLineItem`** with `is_wheelchair` if 0 % is trip-driven.

### Write-back extension

1. **Keep** writing `tax_rate`, `base_net_price`, `approach_fee_net` together — they are one logical snapshot.
2. Set **`gross_price`** to the same value the invoice line uses: prefer **`lineItemGrossTotalForDisplay(item)`** (or explicit combined gross helper), not `price_resolution.gross` alone when approach exists.
3. Add **`isManualTaxRateOverride`** (or include in write-back note) if trip list should show dispatcher chose rate ≠ distance rule.
4. **Filter write-back:** only `billingInclusion.included && item.trip_id` (and optionally skip `kts_override` €0 lines if product says trip price irrelevant).
5. **Optional:** log/toast on `Promise.allSettled` failures in dev or aggregate failure count for admins.
6. **Do not** add `tax_rate` to `PRICING_RELEVANT_FIELDS` unless product wants trip edits elsewhere to **re-derive** rate from km and wipe invoice-chosen rate.

### Order of implementation

1. Hook + repricing rules + tests (`applyTaxRateOverride`, totals unchanged).  
2. Select UI + flags.  
3. Align write-back gross helper + inclusion filter.  
4. Fetch `is_wheelchair` + `resolveTaxRate` extension (see [`tax-rate-audit.md`](tax-rate-audit.md)).

This reuses existing patterns (KM/gross override, `lineItemToInsertRow`, fire-and-forget write-back) and avoids fighting `updateTrip`’s price engine unless intentional.

---

## File reference (read for this audit)

| File | Role |
|------|------|
| `step-3-line-items.tsx` | Step 3 UI only — displays MwSt, inline gross/km |
| `use-invoice-builder.ts` | State, KM/gross handlers, write-back |
| `invoice-line-items.api.ts` | Build lines, insert, totals — no trip write |
| `invoice.types.ts` | `BuilderLineItem`, `TripForInvoice` |
| `trips.service.ts` | `updateTrip` + conditional `computeTripPrice` |
| `tax-calculator.ts` | `resolveTaxRate`, `formatTaxRate` |
| `trip-price-engine.ts` | `shouldRecalculatePrice` field list |
| `invoice-builder/index.tsx` | Wires Step 3 props to hook |

Other files in `invoice-builder/`: `step-1-mode.tsx`, `step-2-params.tsx`, `step-4-vorlage.tsx`, `step-4-confirm.tsx`, `invoice-builder-pdf-panel.tsx`, `use-invoice-builder-pdf-preview.tsx` — no per-line tax UI.
