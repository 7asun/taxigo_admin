---
name: Billing families variants
overview: Introduce billing_families (behavior + color + payer) and billing_variants (Unterart + required code for stable CSV/invoicing), migrate billing_types 1:1, trips.billing_variant_id, trip creation + bulk CSV (abrechnungsvariante; no legacy single-column compat), pre-insert variant resolution wizard, thorough inline comments, and docs/billing-families-variants.md.
todos:
  - id: sql-migration
    content: "Migration: billing_families, billing_variants (code required + unique per family), trips.billing_variant_id backfill, legacy code generation; drop billing_types; RLS"
    status: pending
  - id: regen-types
    content: Regenerate src/types/database.types.ts from Supabase
    status: pending
  - id: billing-doc
    content: Add docs/billing-families-variants.md (model, UX, CSV, behavior_profile, invoicing roadmap)
    status: pending
  - id: payers-admin
    content: "Payers: families/variants CRUD; code validation (A–Z0–9, 2–6 chars); codes visible on payer detail sheet + edit dialogs; behavior on family only"
    status: pending
  - id: reference-query
    content: Replace fetchBillingTypesForPayer + reference keys + BillingVariantOption (incl. code)
    status: pending
  - id: trip-create
    content: "Create trip: billing_variant_id + family/variant UI; behavior from family; inline comments"
    status: pending
  - id: trips-surfaces
    content: Listings, filters, kanban, print, return trip, overview — new embeds + comments
    status: pending
  - id: bulk-upload
    content: CSV abrechnungsvariante; match by code then name; resolve wizard; no backward compat; comments
    status: pending
isProject: false
---

# Billing families + variants (Abrechnungsfamilie / Unterart)

## Implementation standards (required)

- **Inline comments:** Across all touched TS/TSX/SQL (migration file, services, hooks, bulk upload, trip form, payers admin), add **focused inline comments** where non-obvious: why a join is shaped a certain way, why variant reset cascades from payer/family, how CSV resolution order works, and any migration backfill conventions. Avoid noise on self-explanatory one-liners.
- **Documentation:** Add **[docs/billing-families-variants.md](docs/billing-families-variants.md)** in the repo (this is the single “sophisticated” reference). It should cover:
  - **Conceptual model:** payer → family → variant → trip leaf id; behavior lives only on the family; variant is analytics/billing/CSV identity.
  - **UX:** Kostenträger → Abrechnungsart (Familie) → Unterart (Variante); when controls collapse (single family / single variant).
  - **CSV contract:** column names, matching rules (family + variant), `code` vs display `name`, **handy code format** (2–6 chars `A–Z`/`0–9`), examples.
  - **Admin reference:** Kostenträger sheet lists **codes in plain sight** (see Payers admin) so bulk CSV authors can copy them without hunting.
  - **DB shape:** table summaries, uniqueness rules, RLS note pointer.
  - **Migration:** 1:1 from `billing_types`, how legacy `code` values are generated and how admins should curate them.
  - **Future invoicing:** short section pointing to variant `code` and optional future FKs (recipient / Kostenstelle) — see clarification below — without implementing those FKs in v1 unless product asks later.

## Variant `code` (in scope for v1)

- **Purpose:** Stable, **short** identifier for **CSV import**, future **invoice lines**, exports, and integrations when display `name` changes (e.g. “KTS” renamed for clarity in the UI). Admins should see codes **on the Kostenträger / Abrechnungsart sheet** before running bulk upload so they do not have to remember them.
- **Handy format (product rule):**
  - **Characters:** uppercase letters **`A–Z`** and digits **`0–9`** only (easy to read, type, and dictate; no underscores or special characters).
  - **Length:** **2–6** characters inclusive (fits “handy”; long enough for uniqueness within a family; short enough for Excel and quick scanning).
  - **Storage:** normalize to **uppercase** on save; compare CSV **case-insensitively** then normalize to uppercase for lookup.
  - **Schema:** column type **`varchar(6)`** (or `text` with a `CHECK` that enforces length 2–6 and `^[A-Z0-9]+$`) plus **UNIQUE (`billing_family_id`, `code`)** and **NOT NULL** after backfill.
- **Admin UI:** Variant create/edit enforces the regex in the form (inline hint: e.g. “2–6 Zeichen, nur A–Z und 0–9”). Invalid input blocked with a clear message.
- **Kostenträger detail sheet (`payer-details-sheet` / Abrechnungsarten list):** For **every** variant row under a family, show the **`code` visibly** — e.g. monospace **`Badge`** or pill next to the Unterart name (`KTS` · `D1KTS`), and/or a small “CSV-Code” column. Goal: open sheet → copy codes into bulk template without opening each dialog.
- **Trip creation variant dropdown:** Show the same **code as secondary text** (e.g. second line or right-aligned muted label) so dispatchers see it consistently with the payer sheet.
- **Migration backfill:** Generated codes **must** satisfy the 2–6 `A–Z0–9` rule (e.g. compress legacy name to alnum uppercase and truncate/pad with deterministic suffix within family, or use short hash slice `A1B2C3` style). If a legacy name cannot yield a valid code in one step, use a per-family counter pattern (`V01`, `V02`, …) capped at 6 chars. Document the algorithm in `docs/billing-families-variants.md`; admins can rename to mnemonic codes (e.g. `KTS`, `REHA`) in the UI afterward.
- **Bulk CSV:** Match variant by **`code` first** (case-insensitive), then fall back to **`name`** within the matched family — order documented and implemented consistently.
- **Length decision (locked):** Keep **variable 2–6**, not fixed width and not single-character.
  - **Fixed always 6** looks neat in spreadsheets but forces padding (`KTS000`, `REHA00`) and is **less handy** for humans; no real technical win because the column is already bounded by `varchar(6)`.
  - **1 character** is too easy to collide within a family and is hard to read in UI lists next to names.
  - **2–6** matches short mnemonics (`KTS`, `LAB1`) and still allows slightly longer disambiguators when needed.

## Codebase layout (v1 — no repo-wide restructure)

- **Keep the current feature-based layout.** Implement billing families/variants by **extending** existing areas:
  - **Admin / CRUD / types / hooks:** stay under [`src/features/payers/`](src/features/payers/) (service, dialogs, sheet, hooks).
  - **Trip create, bulk upload, filters, listings:** stay under [`src/features/trips/`](src/features/trips/) and shared trip API/query modules.
- **Optional later cleanup only if file count grows:** introduce a subfolder such as `src/features/payers/components/billing/` (or `billing-families/`) when multiple new dialogs or list components make the flat `components/` folder noisy — **not** a prerequisite to start.
- **Avoid** renaming `features/trips` → something else or moving payers-only billing code into a new top-level `features/billing` **in the same PR** as the migration; that splits ownership and makes review harder without clear benefit at your current size.

## Clarification: “Invoice recipient / Kostenstelle” (what that meant)

That bullet was **not** a requirement to build invoicing now. It meant **optional future database columns** you might add when you implement billing:

- **Invoice recipient (Rechnungsempfänger):** A foreign key (or JSON pointer) from **`billing_variants`** to whoever should receive the invoice for trips billed under that variant — e.g. a `clients` row, a dedicated `invoice_recipients` table, or Kostenträger sub-entity. Different variants (Dialyse KTS vs Reha) often imply **different recipients** or cost units.
- **Kostenstelle:** A code or FK used by **accounting** (DATEV, Buchhaltung) to allocate revenue/cost. Usually attached at variant or family level depending on your Steuerberater’s chart.

**v1 decision:** **Do not add** `invoice_recipient_id` or `kostenstelle` columns in this migration unless you explicitly expand scope. The **variant `code`** is the hook you need now so invoicing can key off something stable later; the doc’s “Future invoicing” section describes how recipient/Kostenstelle would attach without committing schema yet.

## Recommended CSV column name

Use **`abrechnungsvariante`** (snake_case, aligned with `kostentraeger` / `abrechnungsart`). Shorter alias **`unterart`** is fine; the parser can accept both keys mapping to the same field.

**Semantics**

- `abrechnungsart` → **family** name (`billing_families.name`) for the resolved payer.
- `abrechnungsvariante` → **variant** match: **`code` preferred**, else **`name`**, case-insensitive trim, scoped to that family.

**No backward compatibility:** Do **not** implement fallback parsing for legacy single-column combined strings (e.g. “Dialyse KTS” in `abrechnungsart` only). From go-live, templates must use the two-column contract (plus `code` in CSV when you want unambiguous imports).

## Target data model

```mermaid
erDiagram
  payers ||--o{ billing_families : has
  billing_families ||--o{ billing_variants : has
  trips }o--o| billing_variants : billing_variant_id
  billing_families {
    uuid id PK
    uuid payer_id FK
    text name
    text color
    jsonb behavior_profile
  }
  billing_variants {
    uuid id PK
    uuid billing_family_id FK
    text name
    text code UK_per_family
    int sort_order
  }
```

- **Single leaf on the trip:** `trips.billing_variant_id` (nullable FK to `billing_variants`). Invoicing, analytics, and exports should key off **variant id** and **`code`**.
- **Behavior stays on the family:** Reuse existing [`BillingTypeBehavior`](src/features/payers/types/payer.types.ts) JSON on `billing_families.behavior_profile` (same semantics as today’s `billing_types.behavior_profile`).
- **Deprecate** table `billing_types` after migration (drop `trips.billing_type_id` once backfilled).

## SQL migration (Supabase)

Add a new migration under [`supabase/migrations/`](supabase/migrations/) with **section comments** explaining each phase (create tables → backfill → trips column → cutover):

1. **`billing_families`** — `id`, `payer_id` → `payers(id)` ON DELETE CASCADE, `name`, `color`, `behavior_profile` jsonb not null default `'{}'`, `created_at`; **UNIQUE (`payer_id`, `name`)** for predictable CSV family matching.
2. **`billing_variants`** — `id`, `billing_family_id` → `billing_families(id)` ON DELETE CASCADE, `name`, `code` **varchar(6)** (nullable only during backfill; end state **NOT NULL**), `sort_order` default 0; **CHECK** that `code` matches handy rule when set; **UNIQUE (`billing_family_id`, `name`)**; **UNIQUE (`billing_family_id`, `code`)** — finalize NOT NULL after legacy fill.
3. **Backfill from `billing_types`:** One family + one variant per old row; variant `name` = **`Standard`** (recommended) so future splits into KTS/Reha stay clear; set **`code`** via documented algorithm.
4. **`trips.billing_variant_id`** — backfill from old `billing_type_id` mapping; then drop old FK/column and `billing_types`.
5. **RLS:** Mirror existing Supabase policies for `payers` / `billing_types` onto new tables.

Regenerate [`src/types/database.types.ts`](src/types/database.types.ts) after apply.

## Application changes (by area)

### Reference data and TanStack Query

- [`trip-reference-data.ts`](src/features/trips/api/trip-reference-data.ts) — Fetch variants for payer with nested family (behavior, color, names, **code**).
- [`reference.ts`](src/query/keys/reference.ts) — Keys + invalidation when families/variants change.
- [`trip-form-reference.types.ts`](src/features/trips/types/trip-form-reference.types.ts) — `BillingVariantOption` includes **`code`**.

### Trip creation

- [`payer-section.tsx`](src/features/trips/components/create-trip/sections/payer-section.tsx) — Familie + Unterart; collapse rules as in plan; **always show variant `code`** in the Unterart control (secondary label / muted line), aligned with payer sheet styling for consistency before bulk runs.
- [`create-trip-form.tsx`](src/features/trips/components/create-trip/create-trip-form.tsx) — `billing_variant_id`; reset rules; behavior from **family** profile.
- Schema, draft, [`create-trip-draft.ts`](src/features/trips/lib/create-trip-draft.ts) — migrate field name; bump draft version if needed.

### Payers admin

- [`payers.service.ts`](src/features/payers/api/payers.service.ts) — Families + variants CRUD; **server-aligned** validation for `code` (same 2–6 `A–Z0–9` rule).
- Payer card count: **families** as “Abrechnungsarten” count.
- **[`payer-details-sheet.tsx`](src/features/payers/components/payer-details-sheet.tsx):** Under each Abrechnungs**familie**, list variants with **prominent, copy-friendly `code`** (badge + monospace) next to the Unterart name so admins see all CSV codes in one place.
- Dialogs: add/edit variant **must include code** with live format hint; behavior dialog only on **family**.

### Trips surfaces + bulk upload

- PostgREST: embed `billing_variants` + `billing_families`; update filters URL param to **`billing_variant_id`**.
- Bulk: load families/variants; **no** legacy single-column compat; resolution wizard for missing variant when family has **>1** variant; match **code then name**.

## Suggestions for a later phase (explicitly not v1)

- **Duplicate variant** action in admin.
- **Invoice recipient / Kostenstelle** FKs or fields once invoicing module exists.

## Risk / testing checklist

- RLS on new tables matches old access patterns.
- All former `billing_type_id` usages → `billing_variant_id`.
- Bulk upload + pair_id + return-trip behavior still driven by **family** `behavior_profile` via selected variant.
- CSV tests: same display name different `code` resolves correctly; wrong code blocks or triggers wizard.
- UI: codes visible on payer sheet and trip form variant list; create/edit rejects codes outside 2–6 `A–Z0–9`.
