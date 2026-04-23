# Price Engine Rule Resolution Audit
## Payer-only and type-only trips

**Date:** 2026-04-22  
**Scope:** Read-only. No code changes. Files examined:
- `src/features/trips/lib/trip-price-engine.ts` (full)
- `src/features/invoices/lib/resolve-pricing-rule.ts` (full)
- `src/features/invoices/lib/resolve-trip-price.ts` (full)
- `src/features/invoices/api/invoice-line-items.api.ts` (full)
- `src/features/invoices/types/pricing.types.ts` (full)
- `src/types/database.types.ts` — `billing_pricing_rules`, `trips`, `billing_types`, `billing_variants`

---

## Q1: Exact rule resolution steps in order

There are two layers: `computeTripPrice` (entry point) and `resolvePricingRule` (resolution logic).

### Pre-resolution guard — `computeTripPrice` line 216

```
if (!trip.payer_id) return nullFields;
```

The only guard before resolution begins. Rejects trips with falsy `payer_id`. No other field is checked here — `billing_type_id`, `billing_variant_id`, and `client_id` are all passed through without any null check.

After this guard, `resolvePricingRule` is called with the four discriminator fields.

---

### STEP 0 — Client price tags (`resolvePricingRule` lines 38–78)

**Fields required:** `clientId` non-null AND `clientPriceTags` array non-empty.

**When null:** If `clientId` is null → `if (clientId && clientPriceTags?.length)` evaluates to false → step is **skipped silently**, falls through to STEP 1. Same if `clientPriceTags` is empty.

**What it does when active:**
- Filters tags to `client_id === clientId && is_active`
- Sub-step A: if `billingVariantId` non-null → look for a tag scoped to that exact variant
- Sub-step B: if no variant tag found → look for tag with `payer_id === payerId` and `billing_variant_id = null`
- Sub-step C: if still nothing → look for a global tag (`payer_id = null`, `billing_variant_id = null`)
- If any tag is found with `price_gross > 0` → synthesizes a `client_price_tag` rule and **returns immediately**, resolution is complete

---

### STEP 1 — Variant rule (`resolvePricingRule` lines 81–86)

**Fields required:** `billingVariantId` non-null.

**Guard:** `if (billingVariantId)` — explicit JavaScript truthiness check. If `billingVariantId` is `null`, `undefined`, or `""` → **skipped silently**, falls through to STEP 2.

**Match condition on the rule row:**
```
r.billing_variant_id === billingVariantId AND r.is_active
```

Returns the matched rule immediately if found.

---

### STEP 2 — Billing type rule (`resolvePricingRule` lines 89–98)

**Fields required:** `billingTypeId` non-null.

**Guard:** `if (billingTypeId)` — explicit JavaScript truthiness check. If `billingTypeId` is `null`, `undefined`, or `""` → **skipped silently**, falls through to STEP 3.

**Match condition on the rule row:**
```
r.billing_type_id === billingTypeId
AND r.billing_variant_id IS NULL
AND r.payer_id IS NULL         ← hard discriminator: only "global type" rules match
AND r.is_active
```

**Important:** `r.payer_id === null` is a hard discriminator here. A rule row with `payer_id = somePayerId AND billing_type_id = someTypeId` will **NOT** match STEP 2, even if the billing type belongs to that payer.

Returns the matched rule immediately if found.

---

### STEP 3 — Payer-wide fallback (`resolvePricingRule` lines 101–108)

**Fields required:** None. **No guard.** This step always executes.

**Match condition on the rule row:**
```
r.payer_id === payerId
AND r.billing_type_id IS NULL
AND r.billing_variant_id IS NULL
AND r.is_active
```

Returns the matched rule, or `null` if no row satisfies all four conditions.

---

### After rule selection — `resolveTripPrice`

Once a rule (or null) is returned, `resolveTripPrice` applies the Spec C cascade:

| Priority | Condition | Result |
|---|---|---|
| P0 | `kts_document_applies === true` | Returns `net=0, gross=0` immediately |
| P1 | Client price tag gross available (STEP 0 rule or `clients.price_tag`) | Returns gross-anchored resolution |
| P2 | Rule non-null and `is_active` → `executeStrategy` returns non-null | Returns strategy result |
| P3 | `trip.net_price` non-null | Returns stored net as fallback |
| P4 | None of the above | Returns `net=null, gross=null` |

`computeTripPrice` then checks `if (resolution.net === null) return nullFields;` — the trip gets `net_price=null`, `gross_price=null`, `tax_rate=null`.

---

## Q2: Step that matches on payer_id alone

**Yes — STEP 3** matches on `payer_id` alone with no `billingTypeId` and no `billingVariantId`.

**There is no guard preventing this match.** STEP 3 always runs regardless of whether `billingTypeId` and `billingVariantId` are null on the trip.

**Exact conditions a `billing_pricing_rules` row must satisfy for STEP 3 to succeed:**

1. `payer_id = <the trip's payer_id>` — strict string equality in JavaScript (`===`)
2. `billing_type_id IS NULL` — must be exactly `null` (not a UUID)
3. `billing_variant_id IS NULL` — must be exactly `null` (not a UUID)
4. `is_active = true` — must be the boolean `true` (mapped via `r.is_active === true` in `mapBillingPricingRuleRowsToLike`)

No other condition is required. A single row satisfying these four columns is sufficient.

---

## Q3: What `loadPricingContext` loads for billing_type_id=null, billing_variant_id=null trips

`loadPricingContext` **does not look at the trip's `billing_type_id` or `billing_variant_id` at all.** It loads based solely on the payer's catalog:

**Step 1a** — fetches all `billing_types.id` for `payer_id` → `typeIds[]`  
**Step 1b** — if `typeIds` non-empty, fetches all `billing_variants.id` for those types → `variantIds[]`  
**Step 1c** — fetches ALL `billing_pricing_rules` for `company_id`, then filters in-memory:

```typescript
const filtered = allRules.filter(
  (r) =>
    r.payer_id === payerId                                        // ← payer-scoped rules
    || (r.billing_type_id !== null && typeIds.includes(r.billing_type_id))  // ← type rules for payer's types
    || (r.billing_variant_id !== null && variantIds.includes(r.billing_variant_id)) // ← variant rules
);
```

**For a payer-wide rule** (`payer_id=payerId, billing_type_id=null, billing_variant_id=null`):
→ First condition `r.payer_id === payerId` is **true** → included in `filtered` ✓

**Conclusion:** `loadPricingContext` correctly loads payer-wide rules regardless of whether the trip has a `billing_type_id` or `billing_variant_id`. The context is not the source of the problem. A trip with `billing_type_id=null, billing_variant_id=null` and a valid `payer_id` gets the same rule set as any other trip for that payer.

---

## Q4: `billing_pricing_rules` table — exact columns and nullability

From `database.types.ts` (`billing_pricing_rules.Row`):

| Column | Type | Nullable | Role |
|---|---|---|---|
| `id` | `string` | NOT NULL | Primary key |
| `company_id` | `string` | NOT NULL | Tenant scoping |
| `payer_id` | `string \| null` | **NULLABLE** | Discriminator — see below |
| `billing_type_id` | `string \| null` | **NULLABLE** | Discriminator — see below |
| `billing_variant_id` | `string \| null` | **NULLABLE** | Discriminator — see below |
| `strategy` | `string` | NOT NULL | Strategy enum |
| `config` | `Json` | NOT NULL (default `{}`) | Strategy parameters |
| `is_active` | `boolean` | NOT NULL (default `true`) | Activation flag |
| `created_at` | `string` | NOT NULL (default now) | Audit |
| `updated_at` | `string` | NOT NULL (default now) | Audit |

### Discriminator semantics (the three nullable foreign keys)

The three nullable columns define the "scope level" of a rule. The resolver interprets their nullability as follows:

| `payer_id` | `billing_type_id` | `billing_variant_id` | Resolver step that matches |
|---|---|---|---|
| `payerId` | `null` | `null` | STEP 3 — payer-wide |
| `null` | `typeId` | `null` | STEP 2 — global type rule (applies to any payer using this type) |
| any | any | `variantId` | STEP 1 — variant rule |
| `payerId` | `typeId` | `null` | **ORPHANED — no step matches** |
| `payerId` | `typeId` | `variantId` | STEP 1 (variant match) |
| `null` | `null` | `null` | ORPHANED — never matches any step |

**The orphaned combination `payer_id=payerId, billing_type_id=typeId, billing_variant_id=null` is the critical trap.** Such a row:
- IS included in the context filter (via `r.payer_id === payerId`)
- Is NOT matched by STEP 1 (needs variant id on the trip)
- Is NOT matched by STEP 2 (requires `r.payer_id === null`)
- Is NOT matched by STEP 3 (requires `r.billing_type_id === null`)

It appears "configured" in the database but is permanently unreachable by the resolver.

---

## Q5: Most likely reason the 72 "unknown" trips return null

Three hypotheses, ordered by likelihood based on the code analysis.

### Hypothesis A (most likely): No payer-wide rule row exists in the DB

The payers Pflegeheim Bloherfelde and RZO have pricing rules configured only at the billing_type or billing_variant level, but no row with `payer_id=payerId AND billing_type_id IS NULL AND billing_variant_id IS NULL`. The 72 trips have no `billing_variant_id` and some have no `billing_type_id`. The resolution chain:

- STEP 0: skipped — no client price tag or no client
- STEP 1: skipped — `billingVariantId` is null, guard prevents execution
- STEP 2: skipped — `billingTypeId` is null, guard prevents execution (for the subset with no billing_type_id); or runs but finds no matching type rule (for the subset that has billing_type_id)
- STEP 3: runs unconditionally but finds no row with `billing_type_id IS NULL AND billing_variant_id IS NULL` for that payer
- `resolvePricingRule` returns `null`
- `resolveTripPrice` → P2 skipped (rule is null), P3 skipped (net_price is null), P4 returns `net=null`
- `computeTripPrice` → returns `nullFields`

**This is a data gap, not a code bug.**

### Hypothesis B (plausible): Orphaned rules with both payer_id AND billing_type_id set

The rules for these payers were created with `payer_id=payerId AND billing_type_id=someTypeId AND billing_variant_id=null` — a combination that the resolver cannot match at any step (see Q4 table above). The rules are present in the DB, the context loads them (first filter condition matches), but no step in `resolvePricingRule` can reach them. The trip appears to "have rules configured" but the resolution always falls through to null.

This is both a data integrity bug and a silent failure — no error is thrown, no warning logged.

### Hypothesis C (secondary/co-occurring): Distance-based strategy, null driving_distance_km

Even if STEP 3 successfully matches a payer-wide rule, if the strategy is `tiered_km` or `fixed_below_threshold_then_km`, `executeStrategy` immediately returns `null` when `driving_distance_km` is null (lines 278–279 and 294–295 of `resolve-trip-price.ts`). The resolution then falls through to P3 (stored `net_price`, also null) and P4 (null). This produces the same observable symptom — `null` from the engine — despite a rule being found.

**This hypothesis can co-occur with A or B.**

---

## Q6: Early return or guard for null billing_type_id

**Exactly one early return exists before rule resolution:**

`computeTripPrice`, line 216:
```typescript
if (!trip.payer_id) return nullFields;
```

**There is no guard on `billing_type_id`.** A trip with `billing_type_id=null` and a valid `payer_id` passes this check unconditionally and proceeds into the full resolution chain — `loadPricingContext`, `resolvePricingRule`, `resolveTripPrice` — without any rejection or truncation based on the missing billing type.

`loadPricingContext` similarly has only one guard: `if (!payerId) return empty;` (line 103).

**Conclusion for Q6:** `billing_type_id=null` is fully supported at the engine entry point. The null does affect which steps inside `resolvePricingRule` are attempted (STEP 1 and STEP 2 have explicit `if (billingVariantId)` / `if (billingTypeId)` guards), but STEP 3 always runs and handles the payer-only case correctly if the data is correct.

---

## Senior-level recommendation

### Confirm the hypothesis first — run this diagnostic SQL

Before any change (code or data), establish which hypothesis explains the 72 trips:

```sql
-- Per payer: does a payer-wide rule exist? How many affected trips have null distance?
SELECT
  p.name AS payer_name,
  t.payer_id,
  COUNT(t.id)                                                             AS trip_count,
  COUNT(bpr_wide.id)                                                      AS payer_wide_rule_count,
  COUNT(bpr_orphan.id)                                                    AS orphaned_rule_count,
  COUNT(t.id) FILTER (WHERE t.driving_distance_km IS NULL)               AS trips_with_null_distance,
  COUNT(t.id) FILTER (WHERE t.billing_type_id IS NULL)                   AS trips_with_null_type
FROM trips t
JOIN payers p ON p.id = t.payer_id
LEFT JOIN billing_pricing_rules bpr_wide
  ON  bpr_wide.payer_id            = t.payer_id
  AND bpr_wide.billing_type_id     IS NULL
  AND bpr_wide.billing_variant_id  IS NULL
  AND bpr_wide.is_active           = true
LEFT JOIN billing_pricing_rules bpr_orphan
  ON  bpr_orphan.payer_id           = t.payer_id
  AND bpr_orphan.billing_type_id   IS NOT NULL
  AND bpr_orphan.billing_variant_id IS NULL
  AND bpr_orphan.is_active          = true
WHERE t.payer_id IN ('<Pflegeheim Bloherfelde id>', '<RZO id>')
  AND t.net_price IS NULL
GROUP BY p.name, t.payer_id;
```

**Reading the output:**
- `payer_wide_rule_count = 0` → Hypothesis A confirmed. Fix: insert a payer-wide rule row.
- `orphaned_rule_count > 0` and `payer_wide_rule_count = 0` → Hypothesis B confirmed or co-occurring. Fix: correct the orphaned rows.
- `payer_wide_rule_count > 0` and `trips_with_null_distance = trip_count` → Hypothesis C confirmed. Fix: backfill `driving_distance_km`.

---

### Minimal fix per confirmed hypothesis

#### Hypothesis A — Missing payer-wide rule (data fix, no code change)

Insert one row per affected payer into `billing_pricing_rules`:

```sql
INSERT INTO billing_pricing_rules
  (company_id, payer_id, billing_type_id, billing_variant_id, strategy, config, is_active)
VALUES
  ('<company_id>', '<pflegeheim_id>', NULL, NULL, 'tiered_km', '{"tiers": [...]}', true),
  ('<company_id>', '<rzo_id>',        NULL, NULL, 'tiered_km', '{"tiers": [...]}', true);
```

This is the minimal change: zero code touched, immediately effective on the next backfill run, fully backward compatible. STEP 3 already handles payer-wide rules correctly — it just needs a row to find.

#### Hypothesis B — Orphaned rules (code fix or data fix)

**Option B1 — Data fix (preferred if intent is clear):**  
For each orphaned rule that should be payer-wide: set `billing_type_id = NULL`.  
For each orphaned rule that should be type-wide: set `payer_id = NULL`.

**Option B2 — Code fix (if orphaned combination must remain valid):**  
Extend STEP 2 in `resolve-pricing-rule.ts` to accept payer-scoped type rules:

```typescript
// STEP 2 — type rule (payer-scoped or global)
if (billingTypeId) {
  const t = rules.find(
    (r) =>
      r.billing_type_id === billingTypeId &&
      r.billing_variant_id === null &&
      (r.payer_id === null || r.payer_id === payerId) &&  // ← change
      r.is_active
  );
  if (t) return t;
}
```

This is a one-line change. Priority remains: variant (STEP 1) > type (STEP 2) > payer-wide (STEP 3). Adds unit test: rule with both `payer_id` and `billing_type_id` set must resolve via STEP 2 when the trip has the matching `billing_type_id`.

**Risk of B2:** If any company intentionally has both a payer-scoped and a globally-scoped type rule for the same billing type, the payer-scoped one would now win. Audit the data for such conflicts before merging.

#### Hypothesis C — Null driving_distance_km (backfill, no code change)

Re-run the driving distance backfill for the 72 trips (already exists as `scripts/backfill-driving-distance.ts`). Once distance is populated, the existing strategy executes and prices the trips. No code change to the engine.

---

### My recommendation

**Do Hypothesis A fix first.** It is the lowest-risk change: one `INSERT` per payer, no code modification, and it directly satisfies the business requirement ("a trip should be priceable from payer_id alone if a payer-wide rule exists"). STEP 3 is already correct — it just needs data.

**Then run the orphaned-rule SQL** (bpr_orphan count) in parallel to determine if Hypothesis B is also contributing. If orphaned rows exist, fix them via data correction (B1), not a code change, to preserve the intent of each rule.

**Finally, verify driving_distance_km** for any trips that still return null after A and B are resolved. The distance backfill is already available and is a separate concern from rule resolution.

**What NOT to do:** Do not change `resolvePricingRule` to relax or widen any match without first knowing whether Hypothesis B is the root cause. The current three-step logic is intentional and audited. Widening a match condition without confirming the data shape could cause incorrect rule resolution for trips that are already correctly priced.
