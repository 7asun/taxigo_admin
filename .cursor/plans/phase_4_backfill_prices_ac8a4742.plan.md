---
name: Phase 4 Backfill Prices
overview: Modify `scripts/backfill-driving-distance.ts` to add Pass B (price-only backfill for trips that already have distance), two new CLI flags (`--pass-a`, `--pass-b`), ORDER BY on Pass A, a fix-window sub-pass for Phase 1 go-live day, improved summary counters, and two doc updates.
todos:
  - id: pass-a-order-flags
    content: Add CLI flags (RUN_PASS_A, RUN_PASS_B), mode banner, new counters, ORDER BY on Pass A query, wrap Pass A loop in if (RUN_PASS_A)
    status: completed
  - id: pass-b-main
    content: "Add Pass B main while loop: query trips with distance but missing prices, compute and write only price fields, dry-run support"
    status: completed
  - id: pass-b-fix-window
    content: "Add Pass B fix-window sub-pass: same logic but filtered to created_at 2026-04-19, overwrite prices regardless of current value"
    status: completed
  - id: summary-counters
    content: Update summary block to print Pass A and Pass B sections with all new counters
    status: completed
  - id: docs-update
    content: Update docs/plans/price-calculation-audit.md and docs/price-calculation-engine.md with Phase 4 applied notes
    status: completed
isProject: false
---

# Phase 4 — Backfill All Trips with Prices

## Single file changed: [`scripts/backfill-driving-distance.ts`](scripts/backfill-driving-distance.ts)

Current state: 206 lines, one `while (true)` loop selecting `driving_distance_km IS NULL`.

---

## Step 1 — CLI flags and mode banner (top of `main()`)

Replace the single `DRY_RUN` constant with three:

```typescript
const DRY_RUN    = process.argv.includes('--dry-run');
const RUN_PASS_A = !process.argv.includes('--pass-b');
const RUN_PASS_B = !process.argv.includes('--pass-a');
```

Print mode banner after the existing env-check block:

```typescript
console.log('── Backfill mode ─────────────────────────────────');
console.log(`  Pass A (distance+price) : ${RUN_PASS_A ? 'YES' : 'SKIP'}`);
console.log(`  Pass B (price only)     : ${RUN_PASS_B ? 'YES' : 'SKIP'}`);
console.log(`  Dry run                 : ${DRY_RUN ? 'YES — no writes' : 'NO'}`);
console.log('──────────────────────────────────────────────────\n');
```

## Step 2 — New counters

Add alongside the existing counters at the top of `main()`:

```typescript
let totalPriceWritten       = 0; // trips where net_price was written (Pass A + B)
let totalPriceUnresolved    = 0; // computeTripPrice returned null — skip write
let totalFixWindowCorrected = 0; // fix-window sub-pass corrections
```

In Pass A's existing live-write path, after `Object.assign(updatePayload, computeTripPrice(...))`, increment `totalPriceWritten` when `computeTripPrice` returned a non-null `net_price`.

## Step 3 — ORDER BY on Pass A query

Add to the existing query (line 64, after `.not('company_id', 'is', null)`):

```typescript
.order('created_at', { ascending: true })
```

Wrap the existing Pass A `while (true)` loop: `if (RUN_PASS_A) { ... }`.

## Step 4 — Pass B main loop

After Pass A's loop block, add a second `if (RUN_PASS_B)` block containing a new `while (true)` loop:

**Query:**
```typescript
const { data: trips, error } = await supabase
  .from('trips')
  .select(
    'id, company_id, payer_id, client_id, billing_type_id, ' +
    'billing_variant_id, driving_distance_km, scheduled_at, ' +
    'kts_document_applies'
  )
  .not('driving_distance_km', 'is', null)
  .not('payer_id', 'is', null)
  .not('company_id', 'is', null)
  .or('net_price.is.null,gross_price.is.null,tax_rate.is.null')
  .order('created_at', { ascending: true })
  .limit(BATCH_SIZE);
```

**Per-trip logic (no distance resolution):**
```typescript
const priceInput: ComputeTripPriceInput = {
  payer_id:             trip.payer_id,
  billing_type_id:      trip.billing_type_id ?? null,
  billing_variant_id:   trip.billing_variant_id ?? null,
  client_id:            trip.client_id ?? null,
  driving_distance_km:  trip.driving_distance_km,
  scheduled_at:         trip.scheduled_at ?? null,
  kts_document_applies: trip.kts_document_applies ?? false,
  net_price:            null   // never inherit stored value
};
const context = await loadPricingContext({ supabase,
  companyId: trip.company_id!, payerId: trip.payer_id,
  clientId: trip.client_id ?? null }).catch(...);
const priceFields = computeTripPrice(priceInput, context ?? emptyCtx);

if (priceFields.net_price === null) { totalPriceUnresolved++; continue; }
// write ONLY the three price fields
const updatePayload = { net_price: priceFields.net_price,
  gross_price: priceFields.gross_price, tax_rate: priceFields.tax_rate };
```

**Dry-run log format for Pass B:**

The SELECT does not fetch `net_price`, `gross_price`, or `tax_rate` — those are the fields being written, not read. The dry-run log line must therefore show the **computed** values from `computeTripPrice`, not the current DB values (which are not in scope). Use:

```typescript
if (DRY_RUN) {
  console.log(
    `[dry-run] Would set trip ${trip.id} ` +
    `net_price=${priceFields.net_price} ` +
    `gross_price=${priceFields.gross_price} ` +
    `tax_rate=${priceFields.tax_rate}`
  );
  totalPriceWritten++;
  continue;
}
```

This ensures dry-run output is a truthful preview of what the live run would write. Reading back stored values and logging them would be misleading when stored values are null or incorrect (exactly the cases Pass B targets).

Live mode writes and increments `totalPriceWritten`.

Note: `resolveTripForPricing` / `shouldRecalculatePrice` are NOT needed here — all required fields are already in the SELECT and the patch is always the three price fields only.

## Step 5 — Pass B fix-window sub-pass

After the main Pass B `while` loop completes (but still inside `if (RUN_PASS_B)`), add a second `while (true)` loop with the same per-trip logic but a different query:

- Same base filters (`driving_distance_km IS NOT NULL`, `payer_id IS NOT NULL`, `company_id IS NOT NULL`)
- **Remove** `.or('net_price.is.null,...')` — overwrite even populated prices
- **Add** `.gte('created_at', '2026-04-19T00:00:00Z').lte('created_at', '2026-04-19T23:59:59Z')`

This sub-pass overwrites prices written during the Phase 1 go-live day (approach_fee_net was missing at that time). Increments `totalFixWindowCorrected` instead of `totalPriceWritten`.

## Step 6 — Updated summary block

```
── Backfill summary ──────────────────────────────
  Pass A — distance backfill
    Trips processed : X
    Cache hits      : X (X%)
    Google calls    : X
    Errors / skipped: X
  Pass B — price backfill
    Prices written  : X
    Unresolved      : X
    Fix-window fixes: X
    Errors          : X
  Mode            : DRY RUN — no writes made   (only if DRY_RUN)
──────────────────────────────────────────────────
```

---

## Doc updates

- [`docs/plans/price-calculation-audit.md`](docs/plans/price-calculation-audit.md) — add "Phase 4 (applied)" note
- [`docs/price-calculation-engine.md`](docs/price-calculation-engine.md) — note backfill path as complete under "Wired creation paths" or a new "Backfill" section

---

## Build gate

`bun run build` must pass at the end. `shouldRecalculatePrice` and `resolveTripForPricing` remain imported (they are used in Pass A) so no unused-import issues.
