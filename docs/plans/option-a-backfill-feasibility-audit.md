# Audit: Option A Phase 1 — backfill feasibility (deterministic recovery of `approach_fee_net` from billing rules)

**Scope:** Read-only review of the repository as of **2026-04-23**. **No code changes.**

**Context:** `trips.net_price` may be **base + Anfahrt** (engine) or **base only** (invoice writeback); see `docs/plans/option-a-schema-split-audit.md` § “Executive finding”. This document asks whether `approach_fee_net` for **every** historical trip can be recovered **exactly** from **billing rules** alone, without re-running the full `resolveTripPrice` cascade.

**Note on requested path:** `src/features/billing-rules/` **does not exist** in this workspace (0 files). Pricing rules are implemented under **`public.billing_pricing_rules`** (migrations + `resolve-pricing-rule.ts`, `pricing-rule-config.schema.ts`, payers UI). Findings below reference those.

---

## 1. Approach fee storage — table, column, type, granularity

| Item | Evidence |
|------|----------|
| **Table** | `public.billing_pricing_rules` — `supabase/migrations/20260405100000_billing_pricing_rules.sql` lines 6–28. |
| **Column for fee** | There is **no** dedicated SQL column `approach_fee`. The amount lives inside **`config jsonb NOT NULL DEFAULT '{}'`** (line 20). `COMMENT ON COLUMN public.billing_pricing_rules.config` (lines 49–50): strategy-specific parameters, validated in application code. |
| **Shape in application code** | `src/features/invoices/lib/pricing-rule-config.schema.ts` — `approachFeeSchema` (lines 9–12): `approach_fee_net: z.number().min(0).nullable().optional()`. Merged into `tieredKmConfigSchema`, `fixedBelowThresholdThenKmConfigSchema`, `timeBasedConfigSchema`, `emptyConfigSchema` (lines 23–68). **Flat optional net value**, not a percentage column in schema. |
| **Net vs gross** | `src/features/invoices/lib/resolve-trip-price.ts` lines 73–77, 103–116: `approach_fee_net` is described and parsed as a **net** amount, then grossed with `× (1 + tax_rate)` at invoice line persistence (see project docs elsewhere). `extractApproachFeeNet` uses `cfg.approach_fee_net` after `parseConfigForStrategy`. |
| **Per rule row** | One `billing_pricing_rules` row has one `config` object; the optional `approach_fee_net` is **a single value for that rule** (not an array per km tier in the Zod merge — tiers are `tiers` / `km_tiers`, approach is a sibling key). |
| **Variability** | The **value** is per **rule record** and strategy branch. Which rule applies to a given trip is **not** a second table; it is chosen at resolution time (see §2). There is **no** separate `billing_rule_strategies` or `billing_rule_variants` table in `20260405100000_billing_pricing_rules.sql` — only `strategy text` + `config jsonb` on `billing_pricing_rules`. |
| **Other DB tables (migrations scan)** | `supabase/migrations/20260409120000_phase8_approach_fee_single_row.sql` adds **`public.invoice_line_items.approach_fee_net numeric(10,2)`** — **line-item snapshot**, not the catalog. Grep of `supabase/migrations` for `approach` / `approach_fee` in defining **catalog** storage only finds **`billing_pricing_rules.config` semantics** (via app) and **invoice line items** column, not KTS- or KTS catalog tables. |

**Conclusion for §1:** The canonical **configurable** source for Anfahrt in the catalog is **`billing_pricing_rules.config` → optional `approach_fee_net` (net)**, not a first-class float column. It is a **flat net amount**, not a percentage in the Zod + resolver path.

---

## 2. Trip → billing rule linkage — FK path, mutability

| Item | Evidence |
|------|----------|
| **Direct FK** | `trips` has **no** foreign key to `billing_pricing_rules` in the types and migrations reviewed. `Database['public']['Tables']['trips']['Row']` includes `payer_id`, `billing_type_id`, `billing_variant_id`, `client_id` (see `src/types/database.types.ts` trips Row block around lines 1205–1224 in prior audits). |
| **Join / resolution path** | `loadPricingContext` loads rules filtered to the payer’s catalog (`src/features/trips/lib/trip-price-engine.ts` lines 108–144). `resolvePricingRule` (`src/features/invoices/lib/resolve-pricing-rule.ts`) picks **at most one** rule: STEP 0 synthetic `client_price_tag` from `client_price_tags` (lines 38–77); else variant-scoped (lines 81–86); else billing type (lines 88–98); else payer-wide (lines 100–108). `computeTripPrice` / `buildLineItemsFromTrips` pass `payerId`, `billingTypeId` from `trip.billing_variant.billing_type_id` or `trip.billing_type_id`, `billingVariantId` from `trip.billing_variant_id`, `clientId` / `clientPriceTags` (see `trip-price-engine.ts` 234–241, `invoice-line-items.api.ts` 251–257). |
| **Mutability** | `shouldRecalculatePrice` includes `'payer_id'`, `'billing_type_id'`, `'billing_variant_id'`, `'client_id'` (`trip-price-engine.ts` lines 279–284). A trip’s billing context can **change** after save; the row **does not** retain the previous `billing_pricing_rules.id` or a snapshot of old `config`. |
| **Old rule recoverable from trip?** | **No** — there is no `pricing_rule_id` on `trips` in `database.types.ts` trips Row; only the current scope columns. Historical rule choice is **not** stored on the trip row. |

---

## 3. `resolveTripPrice` — how `PriceResolution.approach_fee_net` is derived

| Item | Evidence |
|------|----------|
| **Producing functions** | `extractApproachFeeNet(rule)` (lines 104–119) reads `parseConfigForStrategy(rule.strategy, rule.config)` and `cfg.approach_fee_net`, validates with `roundMoneyOnce`. `withApproachFeeFromRule(base, rule)` (lines 122–128) sets `approach_fee_net: fee` when `fee` is defined, else returns `base` unchanged. |
| **Always from rule config?** | For paths that go through `withApproachFeeFromRule`, the **optional** value is **from the active rule’s config** (when `rule` is the catalog / synthetic rule used in the cascade). **Not** distance-derived or time-derived inside `extractApproachFeeNet` (no km lookup there). **Exception — gross override (invoice only):** `applyGrossOverrideToResolution` (lines 505–529) sets `approach_fee_net` from **admin gross inputs** (`approachFeeGross / (1 + taxRate)`) — **not** from `billing_pricing_rules.config`. That path is for **line-item overrides**, not for raw trip rows in DB. |
| **P0 `manual_gross_price` (taxameter)** | `resolveTripPrice` (lines 394–414) returns a resolution with **`approach_fee_net: 0`** explicitly — no rule Anfahrt. |
| **P1 KTS** | Return object (lines 416–427) has **no** `approach_fee_net` property (legitimately “no Anfahrt” / omitted). |
| **P2 client price tag** | Return (lines 445–455) has **no** `approach_fee_net` (comment lines 14–17: negotiated gross all-in, no Anfahrt on resolution). |
| **P3 catalog strategies** | `executeStrategy` (lines 229–387) computes **base** transport; `withApproachFeeFromRule(r, rule)` may attach `approach_fee_net` from **rule config** (line 461). |
| **P4 `trip.net_price` fallback** | `withApproachFeeFromRule(resolution(...), rule)` (lines 465–479) may still attach the **current** rule’s `approach_fee_net` from `rule.config`. |
| **P5 unresolved** | `withApproachFeeFromRule` on a null base (lines 483–494) can still add fee from rule if config has it. |
| **Legitimate `0` / null** | P0: `0` (lines 412–413). KTS / client tag: no field or not applied per branches above. Empty/missing `approach_fee_net` in config: `extractApproachFeeNet` returns `undefined`, `withApproachFeeFromRule` leaves base unchanged. |

**Conclusion for §3:** `PriceResolution.approach_fee_net` (when present for catalog paths) is **the optional flat net from the resolved rule’s `config`**, or **0** for taxameter, or **recomputed in `applyGrossOverrideToResolution`** for manual gross override — not a second formula in `extractApproachFeeNet` beyond `parseConfigForStrategy` + `roundMoneyOnce`.

---

## 4. Taxameter trips (`manual_gross_price`) — approach behaviour and `net_price` on the trip

| Item | Evidence |
|------|----------|
| **Resolver** | P0 block (`resolve-trip-price.ts` lines 394–414): `approach_fee_net: 0` — “do not add rule approach”. |
| **Engine `computeTripPrice`** | `trip-price-engine.ts` lines 247–252, 252–256: `approachFeeNet = resolution.approach_fee_net ?? 0` → for taxameter, **0**; `totalNet = resolution.net + 0` — **lump-sum net**; comment line 251: “P0 taxameter … all-in; approach_fee_net is always 0 there.” |
| **`trips.net_price` content** | For engine-written taxameter trips, stored `net_price` is the **entire** transport net in one number **without** a separate Anfahrt line in that column (because approach is 0 in resolution). The **gross** taxameter value is not split into base + Anfahrt at trip row level. |

---

## 5. Historical rule mutation risk

| Question | Findings (evidence) |
|----------|---------------------|
| **Can `approach_fee_net` in config change after trips were created?** | Yes. `billing_pricing_rules` has `config jsonb` and `updated_at` (`src/types/database.types.ts` lines 25–28). Application validates config on write (`pricing-rule-config.schema.ts`); there is **no** migration in this repo adding a **`billing_pricing_rules_history`** or version table (search was by table creation + approach-related migrations). |
| **Would re-running `resolveTripPrice` today differ from “at trip creation”?** | **Can differ** whenever `billing_pricing_rules.config` (or `is_active`, scope columns), `client_price_tags`, or client legacy `price_tag` data changed — same inputs would follow **current** catalog. `resolvePricingRule` has no time-travel. |
| **Is `invoice_line_items.approach_fee_net` a reliable historical snapshot?** | **For invoiced lines:** the column is set at insert in `src/features/invoices/api/invoice-line-items.api.ts` (e.g. line 507 in prior audit). **`supabase/migrations/20260401180000_invoices_invoice_line_items_rls.sql`:** `invoice_line_items` has **SELECT** and **INSERT** policies for company admin; **no `UPDATE` policy** on `invoice_line_items` in that file — and **no** `UPDATE` on `invoice_line_items` appears in a migration grep. That strongly implies **line rows are not routinely updated** via the same RLS path (immutability intent aligns with `invoice-line-items.api.ts` header comments in the codebase). **Caveat:** `service_role` or future migrations could still change rows outside this review. |

---

## 6. Uninvoiced trips — recoverability

| Item | Evidence |
|------|----------|
| **Stored at trip-creation time** | There is **no** `trips.approach_fee_net` column today (`option-a-schema-split-audit.md` §3). The engine folds approach into `trips.net_price` only for **engine**-written combined snapshots (`trip-price-engine.ts` 252–256). **Invoice writeback** writes **base** to `net_price` (`use-invoice-builder` in prior audit, line 277). |
| **Record other than combined `net_price`?** | For **never-invoiced** trips: no `invoice_line_items` row — **no** `invoice_line_items.approach_fee_net` snapshot. |
| **From current rule only?** | You can read **`approach_fee_net` from the rule that `resolvePricingRule` would pick _today_** (same as `loadPricingContext` + `resolvePricingRule`), but that is **not guaranteed** to match the rule at original pricing time if the trip’s `billing_variant_id` / `billing_type_id` / `payer_id` / client tag state or the rule `config` changed. |
| **Approximate?** | **Yes, only approximate** if you read rules without full re-resolution — and **wrong** for rows where `net_price` is **already base-only** (post–invoice writeback) if you **subtract** a rule fee. |

**Additional historical note (engine correctness):** `scripts/backfill-driving-distance.ts` lines 520–523 comment that trips on **2026-04-19** may have `net_price`/`gross_price` **set but incorrect** because `approach_fee_net` was **missing from the engine** at that time. That is evidence that **stored `net_price` on some dates does not even match a “current rule + current engine” reconstruction**, so **rule-based subtraction** is **unsafe** for those rows without re-resolution or a dedicated fix pass.

---

## 7. Backfill feasibility verdict — deterministic “rule-only” vs full re-resolution

### 7.1 Proposed formula (from prompt)

> `base_net_price = net_price - approach_fee_net_from_rule`  
> `approach_fee_net = approach_fee_net_from_rule`  

| Blocker | Evidence |
|--------|----------|
| **Ambiguous `net_price` semantics** | `docs/plans/option-a-schema-split-audit.md` — engine **adds** approach into `net_price`; invoice writeback stores **base** in `net_price`. **Subtracting** a positive rule fee from **base-only** `net_price` **underestimates** base and is **incorrect**. There is **no** flag on the trip that distinguishes the two. |
| **Rule identity not stored** | §2 — cannot know **which** `billing_pricing_rules` row (or which `config` revision) was used without re-resolving with **point-in-facts**; **current** `config` may differ. |
| **Cascade paths where rule Anfahrt does not apply** | P0 taxameter: approach **0** in resolution but lump-sum semantics (`resolve-trip-price.ts` 412–414, `trip-price-engine.ts` 251–252). KTS, client price tag: **no** `approach_fee_net` on resolution object (lines 416–456). A **single SQL** that only reads `config->approach_fee_net` and `trips.net_price` **cannot** branch like `resolveTripPrice` without the same **inputs** (e.g. `kts_document_applies`, `manual_gross_price`, client tag fields, `driving_distance_km`, `scheduled_at` for time_based, and `resolvePricingRule` STEPs 0–3). |
| **P4 / combined `net_price` + `withApproachFeeFromRule` risk** | If `trips.net_price` were **combined** and P4 + rule fee applied again in resolution, the design double-counts in the resolver (`option-a-schema-split-audit.md` §9) — a naive subtraction does not “invert” that without knowing the path. |
| **`applyGrossOverrideToResolution`** | Invoice-only; approach comes from user gross inputs, not rules — **not** recoverable from `billing_pricing_rules` alone. |

**Verdict:** A **universal** deterministic backfill with **only**  
`net_price - config.approach_fee_net` (reading today’s rule join) is **not** possible for **every** row with **exact** recovery.

**What is valid:**

- **Full re-resolution in TypeScript** (same as `scripts/backfill-null-trip-net-prices.ts`): for each trip, build `ComputeTripPriceInput` from the **current** row fields, `loadPricingContext` + `computeTripPrice` — yields **`TripPriceFields.net_price` as combined** and you would still need to **read `resolution` internals**; today `computeTripPrice` only returns the three fields, so you must **either** call `resolveTripPrice` with the same inputs as `computeTripPrice` to obtain **`resolution.net` and `resolution.approach_fee_net` separately** or **extend** the engine to return them. That is the **logically correct** “recalculate and split” path for **current** rules.
- **Segmented heuristics** (not fully deterministic for all history): e.g. use **`invoice_line_items.approach_fee_net`** where a line exists (join by `trip_id`) as **charged** Anfahrt; for uninvoiced, full resolution or “unknown + manual review” bucket.

### 7.2 Percentage of trips with non-zero Anfahrt

**Not estimable from the repository alone** — requires a SQL/warehouse query, e.g. count `invoice_line_items.approach_fee_net IS NOT NULL AND approach_fee_net <> 0` or re-run resolution over `trips`. The codebase does not embed such statistics.

---

## 8. Senior-level recommendation

**Is a clean deterministic backfill **only from billing rules** and **`net_price` arithmetic** possible?**  
**No** — not for **every** historical row **exactly**: **semantic ambiguity of `net_price`**, **mutable rules without versioning**, **non-catalog paths** (taxameter, KTS, client tag), **invoice gross overrides**, and **known historical engine window** (see `scripts/backfill-driving-distance.ts` 520–523) all block a single `net - fee_from_today’s_rule` formula.

**Preferred fallback (safe):**

1. **Invoiced trips:** use **`invoice_line_items.approach_fee_net` + `price_resolution_snapshot` / `unit_price` / `quantity`** (and tax) as the **legal snapshot** of what was charged, not today’s `billing_pricing_rules.config`, when the goal is “what we actually billed.”
2. **Uninvoiced or missing lines:** run **`resolveTripPrice` + `resolvePricingRule` + `loadPricingContext`with `trips` row state** (and client tags) — same inputs as the app — to obtain **`resolution.net` and `resolution.approach_fee_net`**, then split into new columns, accepting that this reflects **current** catalog, not a time-machine.
3. **If** you add **`trips.base_net_price` / `trips.approach_fee_net` going forward**, write them in **one place** (engine + invoice writeback) so a future backfill is not ambiguous.

**If a formula is required for a **subset** only:** the **only** rule-sourced `approach_fee_net` in DB is **`billing_pricing_rules.config->approach_fee_net` (net)**, and it applies **only** when the same cascade that `resolveTripPrice` uses would attach it — not from SQL subtraction alone on `net_price` without the cascade and without knowing whether `net_price` is combined or base.

---

## Reference files read for this audit

- `src/features/trips/lib/trip-price-engine.ts` (full)
- `src/features/invoices/lib/resolve-trip-price.ts` (full)
- `src/features/invoices/lib/resolve-pricing-rule.ts` (full)
- `src/features/invoices/lib/pricing-rule-config.schema.ts` (substantive portion)
- `src/types/database.types.ts` — `billing_pricing_rules` + `trips` (representative)
- `supabase/migrations/20260405100000_billing_pricing_rules.sql` (full)
- `supabase/migrations/20260401180000_invoices_invoice_line_items_rls.sql` (relevant RLS for line items)
- `supabase/migrations/20260409120000_phase8_approach_fee_single_row.sql` (line item column)
- Grep: `supabase/migrations` for `approach` / `approach_fee` / `billing_pricing`
- `scripts/backfill-null-trip-net-prices.ts` (full)
- `scripts/backfill-driving-distance.ts` (including fix-window comment 520–523)
- `docs/plans/option-a-schema-split-audit.md` (full)

*End of audit.*
