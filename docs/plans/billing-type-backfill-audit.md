# Audit: `billing_type_id` Backfill via `billing_variants`

**Date:** 2026-04-19  
**Status:** Implemented — Pass C added 2026-04-19 (`scripts/backfill-driving-distance.ts`)  
**Scope:** `src/types/database.types.ts`, `src/features/trips/`, `src/app/api/trips/`, `scripts/`

---

## Schema Relationships

```
billing_types
  id (PK)
  name
  payer_id → payers.id
  color
  behavior_profile
  rechnungsempfaenger_id → rechnungsempfaenger.id (nullable)
  created_at

billing_variants
  id (PK)
  billing_type_id → billing_types.id   ← NOT NULL, required FK
  name
  code
  sort_order
  kts_default
  no_invoice_required_default
  rechnungsempfaenger_id → rechnungsempfaenger.id (nullable)
  created_at

trips
  billing_variant_id → billing_variants.id  (nullable)
  billing_type_id    → billing_types.id     (nullable)
```

The parent-child direction is `billing_types → billing_variants` (one-to-many).
`billing_variants.billing_type_id` is **NOT NULL** — every variant belongs to exactly one type.
`trips.billing_type_id` is **nullable** — it may be absent even when `billing_variant_id` is set.

There is no join table between the two. The relationship is a direct FK on `billing_variants`.

---

## Q1 — Does `billing_variants` have a `billing_type_id` FK column?

**Yes.**

Column name: `billing_type_id: string` (not nullable).  
FK constraint: `billing_variants_billing_type_id_fkey` → `billing_types(id)`.

This means for any trip row where `billing_variant_id IS NOT NULL`, the parent
`billing_type_id` can always be derived with a single lookup:

```sql
SELECT bv.billing_type_id
FROM billing_variants bv
WHERE bv.id = trips.billing_variant_id;
```

---

## Q2 — How many trips have `billing_variant_id` set but `billing_type_id` NULL?

Exact count requires a live SQL query:

```sql
SELECT count(*)
FROM trips
WHERE billing_variant_id IS NOT NULL
  AND billing_type_id IS NULL;
```

**Reasoning from type definitions and creation-path analysis (no DB access):**

`trips.billing_type_id` is nullable and was not always populated at creation time across
all paths. Based on the code audit below (Q3), the field is written today in all three active
creation paths — but only as of the recent engineering work. Historical trips created before
`billing_type_id` was added to each creation query, or trips where the variant lookup failed,
will have `billing_type_id = null` with `billing_variant_id` set.

The population of affected trips is non-trivial and must be confirmed with the SQL above.

---

## Q3 — Is `billing_type_id` written at trip creation?

### `create-trip-form.tsx`

**Yes — correctly derived from the selected variant.**

```typescript
// line 1258–1259
const ktsVariantRow = billingTypes.find(
  (b) => b.id === values.billing_variant_id
);

// line 1294
billing_type_id: ktsVariantRow?.billing_type_id || null,
```

`billingTypes` is the `BillingVariantOption[]` array returned by
`fetchActiveBillingVariantsForPayer`. Each entry has `id` (the variant UUID) and
`billing_type_id` (the parent type UUID, embedded at load time from the DB join in
`trip-reference-data.ts` line 99). The naming `billingTypes` is misleading — the array
actually holds **variants**, each augmented with their parent type ID.

`ktsVariantRow` is the variant row matching `values.billing_variant_id`. So the form
correctly writes the parent type of the selected variant.

**Risk:** If `billingTypes` is empty or the variant is not found (data not yet loaded),
`ktsVariantRow` is `undefined` and `billing_type_id` is null. This could occur on a slow
network or if the user submits before reference data loads.

### `bulk-upload-dialog.tsx`

**Yes — from a direct billing_type lookup, not from the variant.**

```typescript
// line 985
billing_type_id: matchedType?.id || null,
```

`matchedType` is the `billing_type` row resolved from the CSV import pipeline.
This is the type's own ID, not derived from the variant FK. If no type match is found
during CSV parsing, `billing_type_id` is null — even if `billing_variant_id` is set.

### `generate-recurring-trips/route.ts` (cron)

**Yes — derived via JOIN on `recurring_rules` → `billing_variants`.**

```typescript
// line 95
.select('*, billing_variants(billing_type_id)')

// line 511 / 576
billing_type_id: rule.billing_variants?.billing_type_id || null
```

The cron JOINs `billing_variants` when fetching recurring rules. The `billing_type_id` is
read from the variant join result. If the join returns null (e.g., rule has no
`billing_variant_id`), the field is null — correctly so.

### Historical trips

Any trip created before these creation paths were updated to write `billing_type_id` will
have `null`. The exact go-live date of the field being populated varies per creation path
and is not captured in git history visible here.

### Conclusion for Q3

`billing_type_id` is written today in all three creation paths and is always **derived from
the variant's parent type** (directly from the variant FK or via a list lookup). It was
**not always populated historically**. A backfill that joins `billing_variants` to recover
the parent type is the canonical fix.

---

## Q4 — How does the price engine use `billing_type_id`?

### Read path

`billing_type_id` is read **directly from the trip row** as part of `ComputeTripPriceInput`:

```typescript
// trip-price-engine.ts line 187
billing_type_id: string | null;
```

It is passed unchanged to `resolvePricingRule` as `billingTypeId`.

### Use in `resolvePricingRule` (STEP 2)

```typescript
// resolve-pricing-rule.ts lines 89–98
if (billingTypeId) {
  const t = rules.find(
    (r) =>
      r.billing_type_id === billingTypeId &&
      r.billing_variant_id === null &&
      r.payer_id === null &&
      r.is_active
  );
  if (t) return t;
}
```

STEP 2 is the **type-level fallback**: applies when a payer defines one pricing rule
per `billing_type` (family) rather than per individual variant. If `billing_type_id` is
`null` on the trip, the conditional `if (billingTypeId)` is falsy and STEP 2 is **skipped
entirely** — even if a matching type-level rule exists in the context.

### Pricing waterfall recap

| Step | Source              | Requires on trip row         |
|------|---------------------|------------------------------|
| P0   | KTS override        | `kts_document_applies`       |
| 0    | Client price tags   | `client_id`, `billing_variant_id` (optional) |
| 1    | Variant rule        | `billing_variant_id`         |
| **2**| **Type rule**       | **`billing_type_id`**        |
| 3    | Payer-wide fallback | `payer_id`                   |

**Impact when `billing_type_id` is null:**

- STEP 1 (variant rule) still runs — ✓ correct if a per-variant rule exists.
- STEP 2 (type rule) is silently skipped — ✗ wrong if the payer uses type-level rules
  and no variant-level rule exists.
- Falls through to STEP 3 (payer-wide fallback) — may produce a different price than
  the intended type-level rule.

### `loadPricingContext` does NOT recover `billing_type_id`

`loadPricingContext` fetches `billing_types.id` values for the payer in order to filter
the rule catalog (`typeIds` used at lines 114–115 of `trip-price-engine.ts`). It does NOT
write `billing_type_id` back onto the `ComputeTripPriceInput`. So the engine has the type
IDs available for **catalog filtering** but relies on the trip row's own `billing_type_id`
for **rule selection** at STEP 2.

This means: **the backfill is needed for correct pricing**, not just for display/reporting.

### Display/reporting impact (secondary)

`billing_type_id` is also used in:
- `trips.service.ts` lines 166/185: JOINed via `billing_variants!...billing_types` for
  display — so display can survive a null `billing_type_id` if the join goes through the
  variant. **Not directly dependent on `trips.billing_type_id`.**
- `api/trips/export/route.ts` line 409: same join approach.
- Invoice builder: passes `billing_type_id` in `create_storno_invoice` RPC — may need
  the correct value for storno grouping.

---

## Q5 — Does `billing_types` table exist? Columns?

**Yes.**

| Column                  | Type              | Nullable | Notes                          |
|-------------------------|-------------------|----------|--------------------------------|
| `id`                    | `string`          | No       | PK                             |
| `name`                  | `string`          | No       |                                |
| `payer_id`              | `string`          | No       | FK → `payers.id`               |
| `color`                 | `string`          | No       |                                |
| `behavior_profile`      | `Json`            | No       | Controls address overrides, return policy, etc. |
| `created_at`            | `string`          | No       |                                |
| `rechnungsempfaenger_id`| `string \| null`  | Yes      | FK → `rechnungsempfaenger.id`  |

No column on `billing_types` points back to `billing_variants` — the FK lives on the child.

---

## Additional Finding — V1 Draft Migration (`create-trip-draft.ts`)

In `create-trip-draft.ts` line 165:

```typescript
billing_variant_id: d.billing_type_id,
```

This is the **V1 → current form value migration** (schema version 1 → 3). In V1, the
localStorage draft stored a field named `billing_type_id` which was actually used as the
billing variant identifier (before the schema was split). When a V1 draft is loaded today,
the old `billing_type_id` value is mapped to `billing_variant_id` in the form. This is
intentional backward compat — not a bug. V2 and V3 drafts use `billing_variant_id` directly.

---

## Backfill Assessment

### Is it safe to derive `billing_type_id` from `billing_variant_id`?

**Yes, completely safe.** `billing_variants.billing_type_id` is NOT NULL, so the join
always produces a definitive value whenever `billing_variant_id` is non-null.

### Proposed SQL for verification (run before backfill)

```sql
-- Count affected trips
SELECT count(*) AS affected
FROM trips
WHERE billing_variant_id IS NOT NULL
  AND billing_type_id IS NULL
  AND company_id = '<target-company-id>';

-- Preview what would be written
SELECT t.id, t.billing_variant_id, bv.billing_type_id AS derived_billing_type_id
FROM trips t
JOIN billing_variants bv ON bv.id = t.billing_variant_id
WHERE t.billing_type_id IS NULL
  AND t.company_id = '<target-company-id>'
ORDER BY t.created_at ASC
LIMIT 50;
```

### Implemented backfill — Pass C

Pass C has been added to `scripts/backfill-driving-distance.ts` (2026-04-19).
It implements the two-query pattern (trips batch → variants lookup → in-memory map)
and automatically runs a selective price re-run (`runPriceForTripIds`) for only the
corrected trips after writing `billing_type_id`.

Run:

```bash
bun scripts/backfill-driving-distance.ts --company-id <uuid> --pass-c [--dry-run]
```

The SQL below remains valid for manual verification before or after the script run.

### Proposed SQL for backfill (reference only — use Pass C script for production)

```sql
UPDATE trips t
SET billing_type_id = bv.billing_type_id
FROM billing_variants bv
WHERE bv.id = t.billing_variant_id
  AND t.billing_type_id IS NULL
  AND t.company_id = '<target-company-id>';
```

### Re-pricing after backfill?

**Handled automatically by Pass C.** The selective re-run (`runPriceForTripIds`) is called
immediately after Pass C corrects `billing_type_id`, overwriting any prices that were
computed with the wrong STEP 3 fallback. No manual re-run of Pass B is needed.

### Priority

**High — addressed.** Pass C corrects price correctness for payers that define rules at
the type level (STEP 2) without matching variant-level rules (STEP 1).

---

## Summary Table

| Question | Finding |
|----------|---------|
| Q1: FK column? | `billing_variants.billing_type_id: string` (NOT NULL), FK `billing_variants_billing_type_id_fkey` → `billing_types.id` |
| Q2: Count `billing_variant_id` set + `billing_type_id` NULL? | Unknown without DB query; expected to be non-trivial for pre-Phase-1 trips and bulk-upload rows with unmatched type |
| Q3: Written at creation? | Yes in all 3 paths — derived from variant's parent type; was not always populated historically |
| Q4: Used in price engine? | Directly from trip row; STEP 2 is skipped when null → may produce wrong price if payer has type-level rules |
| Q5: `billing_types` exists? | Yes — 7 columns: `id`, `name`, `payer_id`, `color`, `behavior_profile`, `rechnungsempfaenger_id`, `created_at` |
