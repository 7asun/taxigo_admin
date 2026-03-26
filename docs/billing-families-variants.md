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

- **CSV-Code generation:** New/edited Unterarten get a `code` from the **Anzeigename** when it yields 2–6 A–Z/0–9 characters after stripping other characters; otherwise from the **Familienname**; otherwise a short deterministic `M…` token. Collisions inside one family append digits (`…2`, `…3`). The UI shows a preview; `PayersService` repeats the same rules on save.
- **Kostenträger sheet:** Families listed as cards; each lists variants with badge **code**. Pencil = edit family name/color or Unterart name (CSV-Code wird bei Namensänderung neu abgeleitet); gear = **behavior** on the family only; at least one variant must remain per family.
- **Fahrten filters:** Filter by `billing_variant_id` (URL param); labels show `Familie · Unterart`.

### Neue Fahrt (create trip)

Implementation: [`create-trip-form.tsx`](../src/features/trips/components/create-trip/create-trip-form.tsx), [`schema.ts`](../src/features/trips/components/create-trip/schema.ts), [`payer-section.tsx`](../src/features/trips/components/create-trip/sections/payer-section.tsx), [`schedule-section.tsx`](../src/features/trips/components/create-trip/sections/schedule-section.tsx).

- **Kostenträger → Familie → Unterart:** If there is more than one **Abrechnungsfamilie**, the user picks the family first, then **Unterart** when the family has more than one variant. If there is only one family and one variant under the payer, **Unterart** is auto-selected. The Unterart dropdown shows `Familie · Name` with monospace **code** as a secondary line (admin hint).
- **Behavior (`behavior_profile`):** Rules always come from the **family** row. The form resolves a “behavior source” variant with [`resolveBillingBehaviorSourceVariant`](../src/features/trips/lib/resolve-billing-behavior-source.ts): the selected Unterart if set, otherwise any variant under the effective family (same JSON on every variant). That way defaults (addresses, Rückfahrt policy, locks, station requirements) apply as soon as the family is known, not only after Unterart is chosen.
- **Submit:** If the payer has at least one variant loaded, **`billing_variant_id` is required**; the trip is stored with that leaf id.
- **Address reset:** Pickup/dropoff/passenger station strings are cleared only when the **family** (`billing_type_id`) changes, not when the user switches **Unterart** within the same family.
- **Abfahrt (schedule):** The form uses **`departure_date`** (`yyyy-MM-dd`, [`DatePicker`](../src/components/ui/date-time-picker.tsx)) plus optional **`departure_time`** (`HH:mm` or empty). Default on open is **today + current local time**. Empty time matches bulk CSV: insert uses **`scheduled_at = null`** and **`requested_date`** = that calendar day (see [`combineDepartureForTripInsert`](../src/features/trips/lib/departure-schedule.ts)). With both date and time, `scheduled_at` is set and `requested_date` is still set for consistency with import rows.
- **Rückfahrt:** All return modes remain available even when the outbound leg is date-only (no clock time). Draft persistence uses draft **schema version 3** (`departure_date` / `departure_time`); older drafts with `scheduled_at` still restore correctly ([`create-trip-draft.ts`](../src/features/trips/lib/create-trip-draft.ts)).

### Abrechnung-Anzeige (lesend, alle Oberflächen)

**Regel:** Anzeigen immer den **Anzeigenamen** der Familie (`billing_types.name`) und ggf. der Unterart (`billing_variants.name`). Den CSV-/DB-**`code`** der Variante nie als Primärlabel nutzen.

**Unterart „Standard“:** Migration legt pro Familie oft eine Variante **Standard** an. In der UI wird dieser Name **unterdrückt**: es erscheint nur die **Familie** (z. B. „Konsil“, nicht „Konsil · Standard“). Andere Unterarten bleiben **„Familie · Unterart“** (z. B. „Dialyse · KTS“). Logik: [`isStandardVariantDisplayName`](../src/features/trips/lib/format-billing-display-label.ts) (trim, case-insensitive `standard`).

**Ein Modul:** [`format-billing-display-label.ts`](../src/features/trips/lib/format-billing-display-label.ts) — `formatBillingDisplayLabel` + `billingFamilyFromEmbed` (PostgREST: `billing_types` als Objekt oder Ein-Element-Array).

**Call-Sites (nicht manuell `fam.name + ' · ' + bv.name` bauen):**

| Oberfläche | Datei |
|------------|--------|
| Dashboard-Übersicht Zeile | [`trip-row.tsx`](../src/features/overview/components/trip-row.tsx) |
| Trip-Detail-Sheet | [`trip-detail-sheet.tsx`](../src/features/overview/components/trip-detail-sheet.tsx) |
| Fahrten-Tabelle „Abrechnung“ | [`trips-tables/columns.tsx`](../src/features/trips/components/trips-tables/columns.tsx) |
| Kanban-Karte | [`kanban-trip-card.tsx`](../src/features/trips/components/kanban/kanban-trip-card.tsx) |
| Druck / JPEG-Übersichten | [`print-trip-groups-list.tsx`](../src/features/trips/components/print-trip-groups-list.tsx) (`tripPrintBilling`) |

Neue Stellen mit eingebettetem `billing_variant` → dieselben Helfer verwenden, damit **Standard**- und Embed-Verhalten konsistent bleiben.

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
