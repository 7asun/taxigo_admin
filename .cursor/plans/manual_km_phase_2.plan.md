# Manual KM override — Phase 2 (Step 3 inline editing UI)

## Prerequisite

Phase 1 foundation must be merged: migration `20260505180000_manual_km_overrides_foundation.sql`, `resolveEffectiveDistanceKm`, `buildLineItemsFromTrips` / `insertLineItems` snapshot columns, types, docs.

## Files to read completely before implementation

1. [`src/features/invoices/components/invoice-builder/step-3-line-items.tsx`](src/features/invoices/components/invoice-builder/step-3-line-items.tsx)
2. [`src/features/invoices/hooks/use-invoice-builder.ts`](src/features/invoices/hooks/use-invoice-builder.ts)
3. [`src/features/invoices/api/invoice-line-items.api.ts`](src/features/invoices/api/invoice-line-items.api.ts)
4. [`src/features/invoices/types/invoice.types.ts`](src/features/invoices/types/invoice.types.ts)
5. [`src/features/invoices/lib/resolve-effective-distance.ts`](src/features/invoices/lib/resolve-effective-distance.ts)
6. [`src/features/invoices/lib/resolve-trip-price.ts`](src/features/invoices/lib/resolve-trip-price.ts)
7. [`src/features/invoices/lib/tax-calculator.ts`](src/features/invoices/lib/tax-calculator.ts)
8. [`src/types/database.types.ts`](src/types/database.types.ts) — `payers.Row` block only
9. [`docs/manual-km-overrides.md`](docs/manual-km-overrides.md)

## Objective

Redesign Step 3 trip row layout and wire manual KM editing. Collapsed row: three-column layout. Expanded panel: address block at top. When `payer.manual_km_enabled` is true, middle column shows an editable KM input.

### Target layout — collapsed row

- **Left:** position, passenger name, date — unchanged.
- **Middle:** Google KM (muted, read-only) always; below it, KM input only when `manual_km_enabled`; amber “KM manuell” badge with × reset only when `isManualKmOverride`.
- **Right:** price input — unchanged. Remove the muted km label that currently sits **below** the price input.

### Target layout — expanded panel

1. **First:** address line (pickup → dropoff), moved from collapsed row.
2. **Then:** existing content unchanged (time, Staffel km badge, MwSt, Anfahrtskosten, Netto breakdown, warnings).

### Deferred (Phase 3)

- `payers.manual_km_enabled` toggle UI
- `client_km_overrides` CRUD and wiring into `buildLineItemsFromTrips`
- Full per-km repricing when KM changes (needs rule on `BuilderLineItem`)

## Files changed

| File | Change |
|------|--------|
| [`invoice-line-items.api.ts`](src/features/invoices/api/invoice-line-items.api.ts) | Payer join: add `manual_km_enabled`; populate `manual_km_enabled` on each line in `buildLineItemsFromTrips` |
| [`invoice.types.ts`](src/features/invoices/types/invoice.types.ts) | `TripForInvoice.payer.manual_km_enabled`; `BuilderLineItem`: `manual_km_enabled`, `manualDistanceKm`, `isManualKmOverride` |
| [`use-invoice-builder.ts`](src/features/invoices/hooks/use-invoice-builder.ts) | `applyKmOverride`, `resetKmOverride`; extend save writeback with `manual_distance_km` |
| [`step-3-line-items.tsx`](src/features/invoices/components/invoice-builder/step-3-line-items.tsx) | Grid, middle KM column, km editing state, address in expanded panel |
| [`invoice-builder/index.tsx`](src/features/invoices/components/invoice-builder/index.tsx) | Wire `onApplyKmOverride` / `onResetKmOverride` from hook |
| [`docs/manual-km-overrides.md`](docs/manual-km-overrides.md) | Phase 2 status + Step 3 UX |
| [`docs/invoices-module.md`](docs/invoices-module.md) | KM editing + writeback |

Optional: test fixtures (`line-item-net-display.test.ts`, `calculate-invoice-totals.test.ts`), [`InvoicePdfDocument.tsx`](src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx) if strict typing requires `manual_km_enabled` on mapped `BuilderLineItem`.

## Implementation steps

### Step 1 — Expose `manual_km_enabled` from payer join

- In `fetchTripsForBuilder`, change payer embed from `payer:payers(rechnungsempfaenger_id)` to `payer:payers(rechnungsempfaenger_id, manual_km_enabled)`.
- On `TripForInvoice`, add `manual_km_enabled: boolean` to the joined `payer` object.
- On `BuilderLineItem`, add optional `manual_km_enabled?: boolean`; set in `buildLineItemsFromTrips` from `trip.payer?.manual_km_enabled ?? false`.
- **Why:** Same payer for all rows in a session; avoids threading payer through Step 3 props.

**Gate:** `bun run build`

### Step 2 — Extend `BuilderLineItem` with KM override fields

After `effective_distance_km` / `original_distance_km` block, add (optional fields):

- `manualDistanceKm?: number | null` — session-committed km; writeback to `trips.manual_distance_km` on save.
- `isManualKmOverride?: boolean` — drives badge and reset.

**Gate:** `bun run build`

### Step 3 — `applyKmOverride` and `resetKmOverride`

In `use-invoice-builder.ts`, after `applyGrossOverride`, mirror pattern (`useCallback`, `map`):

**`applyKmOverride(position, km)`**

- Early return if `!Number.isFinite(km) || km <= 0` (align with `resolveEffectiveDistanceKm`).
- For matching row: `resolveTaxRate(km)` → `newTaxRate`.
- Patch: `effective_distance_km: km`, `manualDistanceKm: km`, `isManualKmOverride: true`, `tax_rate: newTaxRate`, `distance_km` unchanged.
- Sync `price_resolution: { ...item.price_resolution, tax_rate: newTaxRate }` so insert snapshot stays coherent.
- **Do not** call `resolveTripPricePure` (repricing deferred — needs rule on line item in Phase 3).
- `warnings: validateLineItem(patched)`.

**`resetKmOverride(position)`**

- `effective_distance_km: item.original_distance_km`, `manualDistanceKm: null`, `isManualKmOverride: false`.
- `tax_rate: resolveTaxRate(item.original_distance_km).rate`, same `price_resolution.tax_rate` sync.
- `validateLineItem(patched)`.

Expose both from hook return. Do not modify `applyGrossOverride` / `resetLineItemOverride`.

**Gate:** `bun run build`

### Step 4 — `trips.manual_distance_km` writeback on invoice save

Extend existing fire-and-forget `updateTrip` payload in `createMutation`:

```ts
...(item.isManualKmOverride && item.manualDistanceKm != null
  ? { manual_distance_km: item.manualDistanceKm }
  : {})
```

- **Why:** Persist admin km for future `resolveEffectiveDistanceKm`; never write `driving_distance_km`.

**Gate:** `bun run build`

### Step 5 — Collapsed row + KM UI (`step-3-line-items.tsx`)

- Grid: e.g. `grid-cols-[1fr_auto_auto]` (tune with existing Tailwind tokens in file).
- Remove pickup/dropoff from collapsed row; remove muted km under price input.
- Middle column: muted Google km (`original_distance_km` ?? `distance_km`); conditional input when `item.manual_km_enabled`; badge + reset when `isManualKmOverride` (amber styling match Taxameter badge).
- **KM local state:** `kmEditing: { position: number; value: string } | null` + refs/timers **separate** from price `editing` state.
- **`beginKmEditing(item)`** initial `value`:

```ts
item.effective_distance_km != null ? String(item.effective_distance_km) : ''
```

- Commit: `parseFloat(value.replace(',', '.'))`; reject `NaN` / `<= 0`; call `onApplyKmOverride(position, parsed)`.
- **Collapsible close guard (must match price edit — one mechanism only):** Today, `handleCollapsibleOpenChange` only removes the row from `openRows` when closing **if** `!isEditingThisRow`; otherwise it no-ops the delete so `open={openRows.has(position)}` stays true and the panel cannot collapse while price/Anfahrt drafts exist:

```349:358:src/features/invoices/components/invoice-builder/step-3-line-items.tsx
                const handleCollapsibleOpenChange = (next: boolean) => {
                  if (next) {
                    ensureRowOpen(item.position);
                  } else if (!isEditingThisRow) {
                    setOpenRows((prev) => {
                      const n = new Set(prev);
                      n.delete(item.position);
                      return n;
                    });
                  }
                };
```

  Phase 2 must **extend this same branch** only: define `isKmEditingThisRow` (e.g. `kmEditing?.position === item.position`) next to `isEditingThisRow`, and change the close condition to `else if (!isEditingThisRow && !isKmEditingThisRow)`. Do **not** add a second pattern (separate `onOpenChange` wrapper, Radix intercept, or ref-only guard) — that would diverge from the existing UX contract for draft edits.
- New props: `onApplyKmOverride`, `onResetKmOverride`; wire from [`invoice-builder/index.tsx`](src/features/invoices/components/invoice-builder/index.tsx).

**Gate:** `bun run build`

### Step 6 — Expanded panel: address first

Inside `CollapsibleContent`, before existing time/badge/Anfahrt block, add two-column address row with border/padding consistent with panel. No other expanded content changes.

**Gate:** `bun run build`

### Step 7 — Documentation + `// why` comments

- Hook mutators, writeback, `manual_km_enabled` on line item.
- Update `docs/manual-km-overrides.md` and `docs/invoices-module.md` as specified.

**Final gate:** `bun run build` && `bun test`

## Hard rules

1. Never write `trips.driving_distance_km`.
2. Never overwrite `BuilderLineItem.distance_km` (Google snapshot).
3. `kmEditing` and price `editing` must not share refs/timers.
4. `applyKmOverride` no-op for non-finite or non-positive km.
5. When `manual_km_enabled` is false: only muted Google km in middle column (no input, no KM badge).
6. Left column and price column behavior/visual parity with today when flag is false.
7. No new magic numbers — reuse file’s Tailwind patterns.
8. Do not change Taxameter / gross override behavior.
9. KM draft state participates in **the same** `handleCollapsibleOpenChange` close guard as price edits (`!isEditingThisRow && !isKmEditingThisRow`); never introduce a parallel close-blocking mechanism.

## Trip price engine note

`manual_distance_km` is not in `PRICING_RELEVANT_FIELDS` today. Invoice writeback still sends explicit `gross_price`, `tax_rate`, `base_net_price`, `approach_fee_net`, so `shouldRecalculatePrice` typically remains false; no forced change unless a future path updates **only** `manual_distance_km`.

## Implementation todos

- [ ] Step 1: payer join + types + `buildLineItemsFromTrips` `manual_km_enabled`
- [ ] Step 2: `BuilderLineItem` km session fields
- [ ] Step 3: `applyKmOverride` / `resetKmOverride` in hook
- [ ] Step 4: writeback `manual_distance_km`
- [ ] Step 5–6: Step 3 UI + parent wiring
- [ ] Step 7: docs + comments; build + test
