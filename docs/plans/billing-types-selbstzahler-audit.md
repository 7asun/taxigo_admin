# Audit — `billing_types` / `billing_variants` schema and usage (read-only)

**Plan status: implemented 2026-04-27** (`billing_types.accepts_self_payment` + Schichtzettel resolver; see `docs/plans/billing_selbstzahler_resolver_004a593b.plan.md`).

**Purpose:** Baseline for adding `accepts_self_payment` on `billing_types` (non-null wins over `payers.accepts_self_payment`; null defers to payer), including Schichtzettel / Selbstzahler resolution.

**Scope:** Schema from generated types and migrations in-repo; app usage from `src/features/`; RLS as present in SQL migrations (no live Supabase introspection).

---

## Schema (questions 1–6)

**Note (migrations in-repo):** There is **no** `CREATE TABLE public.billing_types` in the checked migration set — the table is assumed to pre-exist; `20260326120000_billing_families_and_variants.sql` only adds `COMMENT` on the table. Alterations in-repo: **`20260405100002_catalog_recipient_fks.sql`** (`rechnungsempfaenger_id` on `billing_types`); **`20260418120000_trips-price-schema.sql`** re-adds **`trips.billing_type_id` → `billing_types`**. `billing_variants` is **created** in `20260326120000_…`; later columns: `kts_default` (`20260403120000_…`), `no_invoice_required_default` and related (`20260404103000_…`), `rechnungsempfaenger_id` (`20260405100002_…`).

**1. What columns exist on `billing_types`?**

| Column | Type (from generated types) |
|--------|-----------------------------|
| `id` | `string` (UUID) |
| `payer_id` | `string` |
| `name` | `string` |
| `color` | `string` |
| `behavior_profile` | `Json` |
| `created_at` | `string` |
| `rechnungsempfaenger_id` | `string \| null` |

**Reference:** `src/types/database.types.ts` (table `billing_types` `Row` block) lines **86–92**.

**2. What columns exist on `billing_variants`?**

| Column | Type |
|--------|------|
| `id` | `string` |
| `billing_type_id` | `string` |
| `name` | `string` |
| `code` | `string` |
| `sort_order` | `number` |
| `created_at` | `string` |
| `kts_default` | `boolean \| null` |
| `no_invoice_required_default` | `boolean \| null` |
| `rechnungsempfaenger_id` | `string \| null` |

**Reference:** `src/types/database.types.ts` lines **130–140**.

**3. How is `billing_types` related to `payers`?**

**Finding:** There is a **direct FK:** `billing_types.payer_id` → `payers.id` (`foreignKeyName: 'billing_types_payer_id_fkey'`). Payers and families are 1-to-many; each family row belongs to one payer.

**Reference:** `src/types/database.types.ts` lines **113–120**; migration comments in `supabase/migrations/20260326120000_billing_families_and_variants.sql` lines **22–23** (CASCADE on delete semantics described there).

**4. How is `billing_types` related to `trips`? Is `trips.billing_type_id` a direct FK?**

**Finding:** **Yes.** `trips.billing_type_id` is nullable and has FK `trips_billing_type_id_fkey` → `billing_types.id`. It was reintroduced after the variant migration: `20260418120000_trips-price-schema.sql` adds `ADD COLUMN billing_type_id uuid REFERENCES public.billing_types(id)` (lines **8–10**) with a comment that it is a direct denormalized reference resolved from the variant at creation (lines **15–19** in that file).

**References:** `src/types/database.types.ts` `trips` `Row` `billing_type_id: string | null` at line **1290**; `Relationships` entry lines **1440–1445**; `supabase/migrations/20260418120000_trips-price-schema.sql` lines **8–19**.

**5. Does `billing_variants` link to trips via `trips.billing_variant_id`? Variant-level override for Selbstzahler?**

**Finding:** **Yes** — `trips.billing_variant_id` → `billing_variants.id` (`trips_billing_variant_id_fkey`).

**Reference:** `src/types/database.types.ts` lines **1233** (`billing_variant_id` on `trips` Row) and **1432–1438** (relationship).

**Product note:** The canonical *billing* path in docs is payer → `billing_types` (Familie) → `billing_variants` (Unterart) with trip leaf `billing_variant_id` (`docs/kts-architecture.md` line **16**). For **Selbstzahler**, the proposed rule is only **(1) billing_types override, (2) else payer** — not variant. Whether the same Unterart would ever need a different self-pay default than its family is a product call; the codebase already uses **variant-first** cascades for KTS and `no_invoice` (see § Resolution logic), which is the analog if variant-level `accepts_self_payment` is ever required.

**6. Existing boolean or payment-style fields on `billing_types` / `billing_variants`?**

- **`billing_types`:** `behavior_profile` (JSON) holds structured flags and tri-state KTS / no-invoice *familie* defaults (see KTS doc). Not a first-class boolean column for self-payment today.
- **`billing_variants`:** `kts_default` (`boolean | null` — NULL = inherit); `no_invoice_required_default` (`boolean | null`); `rechnungsempfaenger_id` (invoice recipient override, not a payment boolean).

**References:** `src/types/database.types.ts` **86–92**, **130–140**; `supabase/migrations/20260403120000_kts_catalog_and_trips.sql` lines **10–14**; `supabase/migrations/20260404103000_no_invoice_fremdfirma_recurring.sql` lines **16–20**.

---

## RLS (question 7)

**7. What RLS policies exist on `billing_types`? Can an admin update?**

**Finding:** **No `ENABLE ROW LEVEL SECURITY` and no `CREATE POLICY` for `public.billing_types` or `public.billing_variants` appear in this repository’s `supabase/migrations`.** The billing-families migration explicitly says policies may need to be mirrored from the project (`20260326120000_billing_families_and_variants.sql` lines **10–11**). Related: `billing_pricing_rules` has RLS (`20260405100000_billing_pricing_rules.sql` lines **77+**), but that is a different table.

**Conclusion for this repo:** RLS for `billing_types` / `billing_variants` **cannot be described from versioned SQL**; confirm in the deployed Supabase project (Dashboard or a schema dump). Admin updates in the app use the browser Supabase client in `PayersService` (insert/update/delete on `billing_types` and `billing_variants`) — those succeed only if the live policies allow the authenticated role to do so.

---

## Application usage (questions 8–11)

**8. Where is `billing_type_id` set on a trip?**

| Location | What happens |
|----------|--------------|
| **Neue Fahrt** | Submit builds `baseTrip` with `billing_type_id: ktsVariantRow?.billing_type_id \|\| null` from the selected variant’s parent family. |
| **Persistence** | `tripsService.createTrip` / `bulkCreateTrips` insert the row as provided (`src/features/trips/api/trips.service.ts` **42–51**). |
| **Recurring cron** | Copies `billing_type_id` from `rule.billing_variants?.billing_type_id` into generated trip payloads (`src/app/api/cron/generate-recurring-trips/route.ts` ~**511**, **521**, **579**, **589**). |
| **Duplizieren** | Copies `billing_type_id` from the source leg (`src/features/trips/lib/duplicate-trips.ts` **306**). |
| **Rückfahrt** | `buildReturnTripInsert` copies `billing_variant_id` from the outbound leg (**80–84**) but **does not** set `billing_type_id` in the returned insert object (`src/features/trips/lib/build-return-trip-insert.ts` **80–115**; field absent). Return rows may have `billing_type_id` null unless set elsewhere. |
| **Price engine** | `computeTripPrice` / patches preserve `billing_type_id` with trip context (`src/features/trips/lib/trip-price-engine.ts` **247–248**, **367–368**). |

**Primary “who sets it” for new trips:** the **create-trip form submit handler** in `src/features/trips/components/create-trip/create-trip-form.tsx` **1294–1297** (and sibling branches that spread `baseTrip` / `computeTripPrice` with the same `ktsVariantRow?.billing_type_id` pattern, e.g. **1353–1356**).

**9. Is `billing_type_id` always set? Nullable in practice? “Percentage”?**

**Finding:** The column is **nullable** in the schema (`src/types/database.types.ts` line **1290**). The **main UI create flow** sets it from the chosen variant’s `billing_type_id` when a variant row exists; if `billing_variant_id` is empty, `ktsVariantRow` can be undefined and `billing_type_id` becomes **null** in the built insert (same file **1294–1297**). **Bulk import** and **edge cases** may leave variant unset (`bulk-upload-dialog.tsx` documents “No billing_types for this payer” paths per grep). **An exact percentage of production rows** is **not in the application repo**; it would require a database query (e.g. `COUNT(*)` where `billing_type_id IS NULL` / `billing_variant_id IS NULL`).

**10. Is there a UI to view or edit Abrechnungsfamilien?**

**Finding:** **Yes.** Route **`/dashboard/payers`** (`src/config/nav-config.ts` **114–115**; page `src/app/dashboard/payers/page.tsx` **20–22**). The **`PayersPage`** client component embeds **`PayerDetailsSheet`**, which renders the **“Abrechnungsfamilien”** section (heading and family list) in `src/features/payers/components/payer-details-sheet.tsx` **688–768** and uses **`PayersService.getBillingFamiliesWithVariants`**, `createBillingFamilyWithDefaultVariant`, `updateBillingFamily`, variant CRUD, etc. (`src/features/payers/api/payers.service.ts` **120–397**).

**11. `getTripsForShift` and `get_shift_day_summaries` — billing type / `accepts_self_payment` on family?**

**`getTripsForShift`:** Selects only trip fields and embedded `payers` with `id`, `name`, `accepts_self_payment` — **no** `billing_type_id`, **no** join to `billing_types`.

**Reference:** `src/features/shift-reconciliations/api/shift-reconciliations.service.ts` **107–128**, mapping **140–161**.

**`get_shift_day_summaries` RPC:** Joins `trips` to `payers` and filters aggregates with **`p.accepts_self_payment` only** (self-pay count/total, invoice count, unconfigured = `payer` null). **No** `billing_types` join.

**Reference:** `supabase/migrations/20260502120000_get_shift_day_summaries.sql` **24–34**, **46–47**.

**What would need to change for family-level override:**  
- **RPC:** Express effective self-pay, e.g. `COALESCE(bt.accepts_self_payment, p.accepts_self_payment)` after joining `trips` → `billing_types` (via `trips.billing_type_id`, with care when null) and `payers`. If `trips.billing_type_id` can be null, resolve family via `billing_variants` → `billing_types` or fall back to payer-only.  
- **`getTripsForShift`:** Extend `.select` to include `billing_type_id` and embed `billing_types(accepts_self_payment)` (or a thin join), then map an **effective** flag in `ShiftTrip` in TS for UI parity with the RPC.

---

## Resolution logic (question 12)

**12. Existing helper for parent/child (catalog) override: billing_types wins, else payer?**

**Finding:** The codebase uses **reusable “cascade resolvers”** with **variant → familie (JSON `behavior_profile`) → payer → system default** for **KTS** and **`no_invoice_required` default**:

- **KTS:** `resolveKtsDefault` in `src/features/trips/lib/resolve-kts-default.ts` **66–85** — `variantKtsDefault` first, then `behavior_profile` (`familie`), then `payerKtsDefault`, else `false`.
- **No invoice (default before trip-level flag):** `resolveNoInvoiceRequiredDefault` in `src/features/trips/lib/resolve-no-invoice-required.ts` **32–49** — same tier order, documented in file comment lines **1–3**.

**For the proposed rule (only two levels: `billing_types` then `payer`):** This is **simpler** than the three-tier KTS/no-invoice resolvers. It is **closest in spirit to “nullable column override + fall back”** (like using only **familie + payer** tiers). A new small function (e.g. `resolveAcceptsSelfPayment` / `coalesce(billingType.accepts_self_payment, payer.accepts_self_payment)`) can mirror the **documentation and single-source-of-truth** style of `resolve-kts-default.ts` and `resolve-no-invoice-required.ts` without copying their three-way precedence.

**KTS documentation** for the overall billing model: `docs/kts-architecture.md` **25–36**, **42–45**.

---

## Senior recommendation

- **Minimal safe change:**  
  1. **Migration:** Add **`billing_types.accepts_self_payment boolean NULL`** (NULL = “inherit from payer”); keep **`payers.accepts_self_payment`** as today.  
  2. **Types:** Regenerate or extend `database.types.ts` for the new column.  
  3. **One resolver** used by Schichtzettel UI + RPC:  
     `effective = billing_types.accepts_self_payment` **if not null**, else `payers.accepts_self_payment` (and define behavior when `billing_type_id` is null: treat as payer-only or resolve family via `billing_variant_id` — **must be one consistent rule**).  
  4. **Update** `get_shift_day_summaries` and **`getTripsForShift`** (and any client that classifies self-pay) to use that expression, not raw `payers.accepts_self_payment` alone.  
  5. **Admin UX:** In **`PayerDetailsSheet` / family edit** (same place as other family-level fields), add a tri-state or nullable boolean for the new column, wired through **`PayersService.updateBillingFamily`** (extend update payload after column exists).

- **Risks:**  
  - **Stale denormalization:** `trips.billing_type_id` may be null while `billing_variant_id` is set (or data drift). Resolution must use the **same** family key the product trusts (likely variant → `billing_type_id` join).  
  - **RLS not in repo:** Verify policies on `billing_types` allow the intended updates before relying on the new column in production.  
  - **RPC vs UI drift** if one path is updated and the other is not.

- **`billing_variants` column — defer?**  
  **Recommend defer** unless the business explicitly needs different Selbstzahler defaults for two Unterarten under the *same* family (KTS and no-invoice already use variant-level columns for that). Adding variant later would follow the same pattern as `resolveKtsDefault` (variant first, then family, then payer) **if** product requires it; the current ask is **family + payer only**, so **ship `billing_types` only** for a smaller migration and a shorter resolver.

---

*Audit generated from repository state; no code or migration changes in this pass.*
