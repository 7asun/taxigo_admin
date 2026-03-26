# Abrechnungsfamilie und Unterart (billing)

This document is the reference for how Kostenträger billing is modeled in Taxigo Admin, how the UI works, and how CSV imports match rows.

## Conceptual model

- **Kostenträger (payer)** — `payers`
- **Abrechnungsfamilie (family)** — one row per family name under that payer. In PostgreSQL the table is legacy-named **`billing_types`**; conceptually it is **not** the CSV “leaf” anymore.
- **Unterart (variant)** — `billing_variants`, child of a family via `billing_type_id`. Each variant has a display **`name`** and a machine-facing **`code`**.
- **Trip** — `trips.billing_variant_id` points at exactly one variant (nullable). Color and **behavior** (Rückfahrt, Adress-Locks, Stations-Pflicht, Defaults) come from the **parent family** row (`billing_types.behavior_profile`), not from the variant.

```text
payer → billing_types (family) → billing_variants (variant) ← trips.billing_variant_id
```

## Database shape (summary)

| Table / column | Role |
|----------------|------|
| `billing_types` | Family: `payer_id`, `name`, `color`, `behavior_profile` (JSON). Unique `(payer_id, name)` for CSV family matching. |
| `billing_variants` | Variant: `billing_type_id`, `name`, `code`, `sort_order`. Unique `(billing_type_id, name)` and `(billing_type_id, code)`. |
| `trips.billing_variant_id` | FK to `billing_variants`; `ON DELETE SET NULL`. Legacy `trips.billing_type_id` was removed after migration. |

**Variant `code` (DB):** `varchar(6)`, `NOT NULL`, must satisfy `^[A-Z0-9]{2,6}$` (uppercase letters and digits only — no underscore in the current CHECK).

**RLS:** Mirror your existing policies for `payers` / `billing_types` onto `billing_variants` in Supabase so the same roles can read/write variants as before.

## UX (Admin)

- **Kostenträger sheet:** Families listed as cards; each lists variants with badge **code**. Pencil = edit family name/color or variant name/code; gear = **behavior** on the family only; at least one variant must remain per family.
- **Neue Fahrt:** After Kostenträger, user picks **Abrechnungsfamilie** (if more than one) then **Unterart**; dropdown shows `Familie · Name` with monospace **code** underneath. Single variant under payer auto-selects.
- **Fahrten filters:** Filter by `billing_variant_id` (URL param); labels show `Familie · Unterart`.

## CSV contract (bulk upload)

Accepted column keys for the variant (same semantic field):

- `abrechnungsvariante` (preferred snake_case, aligned with `kostentraeger` / `abrechnungsart`)
- `unterart` (alias)

**`abrechnungsart`** — must match a **`billing_types.name`** for the resolved payer (case-insensitive, trimmed).

**`abrechnungsvariante` / `unterart`** — within that family, match order is:

1. **`code`** — normalized to uppercase A–Z0–9, exact match against `billing_variants.code` for the matched family.
2. **`name`** — case-insensitive trim against `billing_variants.name` in that family.

There is **no** backward-compatible parsing of a combined string (e.g. `"Dialyse KTS"`) in `abrechnungsart` only; templates must use the two-column contract when multiple variants exist.

If the family has **more than one** variant and the CSV row does not resolve a variant, the bulk wizard stops on **resolve billing variants** so the dispatcher picks the correct `billing_variant_id`.

## Migration from legacy `billing_types` as trip leaf

The migration `20260326120000_billing_families_and_variants.sql`:

1. Creates `billing_variants` and `trips.billing_variant_id`.
2. Inserts one **Standard** variant per existing `billing_types` row with a generated **`code`** (from family name or `M` + hash suffix on collision).
3. Backfills `trips.billing_variant_id` from former `trips.billing_type_id`, then drops `billing_type_id`.

Admins should replace auto-generated codes with operational codes (e.g. `KTS`, `REHA`) when ready.

## Future invoicing (not implemented)

- **Rechnungsempfänger / Kostenstelle** may later attach as FKs or text on family or variant; **variant `code`** is the stable hook for invoice lines and exports when display names change.
- Duplicate-variant actions, DATEV-specific fields, etc. are out of scope for this v1 doc unless product adds them.

## Regenerating TypeScript types

After schema changes:

```bash
bun run db:types
# equivalent (requires local Supabase or adjust flags):
npx supabase gen types typescript --local > src/types/database.types.ts
npx supabase gen types typescript --linked > src/types/database.types.ts
```
