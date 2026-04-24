# Audit: FTO & client price tag backfill verification

**Date:** 2026-04-24  
**Database:** Supabase project `etwluibddvljuhkxjkxs` (executed via read-only SQL).  
**Codebase context:** Pricing is implemented with `billing_pricing_rules`, `client_price_tags`, and legacy `clients.price_tag` — not a `pricing_rules` table (see `docs/preisregeln.md`, `docs/client-price-tags.md`).

---

## Executive summary

| Finding | Detail |
|--------|--------|
| **FTO trip volume** | 20 rows with `payers.name = 'FTO'`. |
| **`base_net_price` gap** | **6** trips still have `base_net_price IS NULL` (**5** have positive `gross_price` + `tax_rate`; **1** has no gross and no client — not fixable by the gross-based backfill). **14** already have `base_net_price` set. |
| **Excluding FTO from the bulk UPDATE** | The gap **still exists** for FTO for those 5 priced trips: they were not updated by the backfill that excluded `p.name NOT IN ('KTS', 'FTO')`. |
| **“Pricing rule” in this product** | FTO trips for the sampled client are priced from **`client_price_tags`** (STEP 0 / P1 gross anchor), not from `billing_pricing_rules` rows on the FTO payer (0 active payer-scoped catalog rows for FTO). |
| **Gross vs tag** | For all **19** FTO trips with a client and both `gross_price` and a matching payer-scoped tag, **`trip.gross_price` matches `client_price_tags.price_gross`** (€92.50) — **0 mismatches**. |
| **Recommendation** | **Yes — include FTO (and any payer priced purely via negotiated gross)** in the **same** backfill pattern: `base_net_price = ROUND(gross / (1 + tax_rate), 2)` when `gross > 0`, `tax_rate` present, and `base_net_price` null. That matches `resolveTripPrice` P1 (`client_price_tag`: gross → net at trip tax rate). **No** separate “rule net” exists on `client_price_tags`; **Anfahrt** does not apply on the client-tag path (`docs/pricing-engine.md`, `docs/anfahrtspreis.md`). |

---

## Documentation reviewed (pricing / trips / tags)

- `docs/preisregeln.md` — unified Preisregeln page; `billing_pricing_rules` + `client_price_tags`.
- `docs/client-price-tags.md` — `price_gross` (brutto), scopes (variant → payer → global).
- `docs/pricing-engine.md` — Spec C cascade; P1 client gross; no Anfahrt on client tag.
- `docs/pricing-engine-3.md` — gross-anchor rounding contract.
- `docs/price-calculation-engine.md` — trip stamping, `computeTripPrice`, backfills.
- `docs/trips-duplicate.md` — duplicate pricing behaviour (context only).
- `docs/plans/trip-price-source-of-truth-audit.md` — historical trip price population notes.

---

## Query 1 — Current state of FTO trips

**Requested SQL (as provided):** `trips` joined to `payers` where `p.name = 'FTO'`.

**Aggregates (same filter):**

| Metric | Count |
|--------|------:|
| Total trips | 20 |
| `base_net_price` **not null** | 14 |
| `base_net_price` **null** | 6 |
| `gross_price` **> 0** | 19 |
| `gross_price` null or ≤ 0 | 1 |

**Interpretation:** Most FTO trips are fully stamped. Six rows still lack `base_net_price`. Five of those have `gross_price = 92.5`, `tax_rate = 0.07`, and `net_price = 0` (legacy snapshot) — strong candidates for the same gross-derived backfill. One row has `client_id` null and all price fields null except `net_price = 0` (needs business review, not automatic gross backfill).

---

## Query 2 — “Client pricing rules” linked to FTO trips

**Important:** There is **no** `pricing_rules` table in this schema. The audit used the product’s equivalents:

- **`client_price_tags`** — negotiated **gross** per client, optional payer/variant scope.
- **`billing_pricing_rules`** — catalog strategies (none with `payer_id = FTO` in this project snapshot).

**`client_price_tags` for distinct `client_id` on FTO trips (non-null client):**

| Rows returned | 1 |
|---------------|--:|
| **Fields present** | `id`, `company_id`, `client_id`, `payer_id` (= FTO), `billing_variant_id` (null), **`price_gross`** `numeric`, `is_active`, timestamps |
| **Gross vs net** | **Gross only** on the tag (`price_gross`). Net is always derived at resolution time: `net = gross / (1 + tax_rate)` using trip distance → `resolveTaxRate` (see `resolve-trip-price.ts` P1). |
| **Approach fee** | **Not** stored on `client_price_tags`. Per docs, **Anfahrt** applies from `billing_pricing_rules.config.approach_fee_net` on non–client-tag paths only. |

**Client label (for traceability):** payer-scoped tag for **Cambridge Management Strategy GmbH** at **€92.50** gross.

**`billing_pricing_rules` where `payer_id` = FTO payer id:** **0** rows.

---

## Query 3 — Cross-check: trip gross vs “rule” gross

**Adjusted logic:** Compared `trips.gross_price` to the **matching** `client_price_tags.price_gross` (payer-scoped tag for FTO + client; same priority idea as STEP 0).

| Metric | Value |
|--------|------:|
| Trips with client + gross + tag | 19 |
| **Mismatches** (`gross_price` ≠ tag `price_gross`) | **0** |

All sampled FTO trips with a client show **€92.50** trip gross aligned with the **€92.50** tag. Stored `base_net_price` where present is **86.4486** (full-precision net from the engine); `ROUND(92.5 / 1.07, 2) = 86.45` — consistent with the intended backfill rounding.

**Legacy `net_price`:** Many rows still show **0.00** while `base_net_price` is populated on others — treat `net_price` as **legacy / unreliable** for reporting; prefer **`base_net_price`** + `approach_fee_net` + generated combined net where applicable (see Phase 2 comments in `trip-price-engine.ts` / migrations).

---

## Query 4 — `information_schema` for `pricing_rules`

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'pricing_rules'
ORDER BY ordinal_position;
```

**Result:** **0 rows** — table **does not exist**. Use `billing_pricing_rules` and `client_price_tags` for any follow-up SQL.

**Reference — `client_price_tags` columns used here:** `id`, `company_id`, `client_id`, `payer_id`, `billing_variant_id`, `price_gross`, `is_active`, `created_at`, `updated_at`.

---

## Trips still missing `base_net_price` (FTO)

| `trip.id` (prefix) | `client_id` | `gross_price` | Notes |
|--------------------|--------------|---------------|--------|
| `401b2982-…` | set | 92.5 | Backfill candidate |
| `41ff1b4a-…` | set | 92.5 | Backfill candidate |
| `8e200b27-…` | set | 92.5 | Backfill candidate |
| `d40f8cd3-…` | set | 92.5 | Backfill candidate |
| `d0cd9fa1-…` | set | 92.5 | Backfill candidate |
| `69612bca-…` | **null** | **null** | Not covered by gross-based UPDATE; needs manual/data fix |

---

## Senior recommendation

1. **Re-run or extend the backfill** to **include FTO** (remove FTO from the exclusion list, or run a one-off `UPDATE` with the same formula for `p.name = 'FTO'` and the same null guards). For **client-tag–priced** trips, **`base_net_price` is exactly “transport net”** and equals **gross ÷ (1 + tax_rate)** because the negotiated tag is **all-in gross** with **no** rule-level Anfahrt on that path.

2. **Do not** invent a second source of truth from `client_price_tags` beyond **`price_gross`** — there is no separate stored net on the tag; the engine already defines behaviour.

3. **After backfill:** Optionally align **`net_price`** via a separate policy if anything still reads it; the product direction in code/docs is **`base_net_price`** as the primary transport net field.

4. **Validation query** (for a future run): repeat the aggregate in §Query 1; expect `base_net_price` null count **0** for FTO rows with `gross_price > 0` and `tax_rate` set.

---

*End of audit.*
