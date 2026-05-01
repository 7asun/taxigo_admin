# Passenger Name Fallback Audit

## Implementation plan (expanded scope)

**Status:** **Implemented** (2026-05-01).

### Files changed

| File | Change |
|------|--------|
| `src/features/trips/lib/resolve-passenger-label.ts` | **CREATE** — `resolvePassengerLabel` + `TripWithBillingContext` |
| `src/features/trips/lib/share-utils.ts` | Use resolver; remove `'Anonym'` |
| `src/features/overview/components/trip-row.tsx` | Use resolver; remove `'Unbekannter Kunde'` |
| `src/features/trips/components/kanban/kanban-trip-card.tsx` | Use resolver; remove inline `'Unbekannter Fahrgast'` |
| `src/features/trips/components/kanban/kanban-drag-preview.tsx` | Replace **2×** inline fallbacks with `resolvePassengerLabel` |
| `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` | Sheet title: `clientDisplayNameFromParts(...) \|\| resolvePassengerLabel(trip)` (drafts first) |

### Post-build checklist (audit doc)

- [x] Mark this implementation block and todos as done.
- [x] **Resolution:** document utility path, fallback chain, and all consumers above (note detail sheet uses drafts `||` resolver).
- [x] **Follow-up:** `src/features/trips/components/print-trip-groups-list.tsx` only — remaining greeting / `'Anonym'` behaviour; deferred.
- [x] **Module reference:** `TripWithBillingContext`, purpose, priority order (in this doc; no separate `docs/` module file).

### Execution todos

- [x] Implement resolver + wire all files in the table.
- [x] `bun run build`
- [x] Grep for passenger fallbacks; confirm only print list remains outside resolver.

---

## Resolution (implemented)

Single utility: [`src/features/trips/lib/resolve-passenger-label.ts`](../../src/features/trips/lib/resolve-passenger-label.ts), exported as **`resolvePassengerLabel`**.

**Fallback order (each step uses trimmed non-empty strings only):**

1. `trip.client_name`
2. `trip.billing_variant?.name` (Unterart) — **skipped when empty or when `isStandardVariantDisplayName` (sentinel „Standard“)**
3. `billingFamilyFromEmbed(trip.billing_variant?.billing_types)?.name` (Abrechnungsfamilie)
4. `'Unbekannter Fahrgast'`

**Consumers:**

| Surface | Usage |
|--------|--------|
| `share-utils.ts` | `formatTripForSharing` / QuickShare passenger segment |
| `trip-row.tsx` | Passenger line + `copyTripToClipboard` receives same row object |
| `kanban-trip-card.tsx` | Card header name |
| `kanban-drag-preview.tsx` | Drag overlay name (group rows + single trip) |
| `trip-detail-sheet.tsx` | Sheet title: **draft** display name from `clientDisplayNameFromParts`, then `resolvePassengerLabel(trip)` |

Types: `formatTripForSharing` / `copyTripToClipboard` accept `TripForShare` (`Trip & TripWithBillingContext`) so callers pass enriched rows where available.

---

## Module reference — `resolve-passenger-label.ts`

- **Purpose:** One consistent German label for trips when UI or QuickShare needs a passenger-facing string and `client_name` may be empty.
- **Input:** `TripWithBillingContext` — optional `client_name`; optional nested `billing_variant` with optional `name` and `billing_types` (typed as object; at runtime PostgREST may return array — Familie step uses `billingFamilyFromEmbed`). No hooks, no I/O; safe to use anywhere.
- **Priority:** See **Resolution** above. Final literal is only defined in this module.

---

## Follow-up (deferred)

- **`src/features/trips/components/print-trip-groups-list.tsx`** — still builds greeting strings with `'Anonym'`; out of scope for this pass; align with `resolvePassengerLabel` in a separate change if print output should match dashboard/copy behaviour.

---

## Debug: Wrong label investigation

Historical audit (symptom: passenger-style label showed **„Standard“** instead of Familie when Unterart was the sentinel). **Fixed** — see **§ Resolution (fix applied)** below.

### 1. Supabase query — verbatim `getUpcomingTrips` select string

From [`src/features/trips/api/trips.service.ts`](../../src/features/trips/api/trips.service.ts) (`getUpcomingTrips`, lines ~165–166):

```text
*, driver:accounts!trips_driver_id_fkey(name), payer:payers(name), billing_variant:billing_variants!trips_billing_variant_id_fkey(name, code, billing_types!billing_variants_billing_type_id_fkey(name, color))
```

| Question | Answer |
|----------|--------|
| **Top-level alias for the `billing_variants` embed** | `billing_variant` (singular) — from the fragment `billing_variant:billing_variants!trips_billing_variant_id_fkey(...)`. |
| **Nested key for `billing_types`** | `billing_types` — from `billing_types!billing_variants_billing_type_id_fkey(...)`. PostgREST nests this under the parent embed. |
| **Columns selected from `billing_variants`** | **`name` and `code` explicitly** — not `*`. |
| **Columns selected from `billing_types`** | **`name` and `color` explicitly** — not `*`. |

**Other paths (for Hypothesis D):**

- `getTripById` uses `billing_variant:billing_variants(*, billing_types(...))` — richer embed; same top-level key **`billing_variant`**.
- `getTrips()` uses `.select('*')` only — **no** `billing_variant` embed on returned rows.

### 2. Runtime object shape (inferred from query + types; no `console.log` run)

For rows from **`getUpcomingTrips`**, the JSON shape is expected to include, when `billing_variant_id` resolves:

```json
{
  "client_name": "...",
  "billing_variant": {
    "name": "...",
    "code": "...",
    "billing_types": { "name": "...", "color": "..." }
}
```

- **`billing_variant.name`** — **should be present** whenever the FK join returns a row, because `name` is in the select list.
- **`billing_variant.billing_types.name`** — **should be present** under the same conditions for the nested select.

**Caveat (embed shape):** nested `billing_types` is **sometimes a one-element array** in PostgREST responses. **`resolvePassengerLabel`** now uses **`billingFamilyFromEmbed`** for the Familie step (same as [`format-billing-display-label.ts`](../../src/features/trips/lib/format-billing-display-label.ts)).

### 3. `TripWithBillingContext` (verbatim)

From [`resolve-passenger-label.ts`](../../src/features/trips/lib/resolve-passenger-label.ts):

```ts
export interface TripWithBillingContext {
  client_name?: string | null;
  billing_variant?: {
    name?: string | null;
    billing_types?: {
      name?: string | null;
    } | null;
  } | null;
}
```

- **`billing_variant.name`**: yes, on the interface.
- **Key name vs query**: **`billing_variant` (singular) matches** the PostgREST alias in `getUpcomingTrips` — **not** `billing_variants` at the top level.

### 4. Hypotheses

| Hypothesis | Verdict | Evidence |
|------------|---------|----------|
| **A** — Select omits `billing_variants.name`, so `billing_variant.name` is always `undefined` and code falls through to `billing_types.name` („Standard“). | **Denied** | `getUpcomingTrips` select explicitly lists **`name, code`** on `billing_variants`. When the join loads, `billing_variant.name` is populated from the DB. |
| **B** — API returns `billing_variants` (plural) but code reads `billing_variant` (singular). | **Denied** | Alias in the select string is **`billing_variant:`**; resolver reads `trip.billing_variant`. |
| **C** — `billing_variants.name` in the database **is** the literal **`Standard`** for that row (default/sentinel Unterart), and the resolver returns it as the passenger label. | **Confirmed** (primary root cause for the reported symptom) | [`format-billing-display-label.ts`](../../src/features/trips/lib/format-billing-display-label.ts) documents: *„If the variant display name is **Standard** … omit it“* and *„DB rows keep `name = 'Standard'` for migrations/CSV“*. **`resolvePassengerLabel`** uses `billing_variant?.name` **without** skipping that sentinel, so it can legally return **`"Standard"`** while Kanban/overview **captions** use `formatBillingDisplayLabel`, which **hides** „Standard“ and shows Familie (or „Familie · Unterart“). That is exactly „Standard instead of [what the Abrechnung line shows]“. |
| **D** — A second query path omits `billing_variant` entirely. | **Partially true but does not explain „Standard“** | `getTrips()` has no embed — those trips would lack `billing_variant`; the resolver would skip to **`Unbekannter Fahrgast`**, not „Standard“. Dashboard/kanban Quickshare paths discussed in this audit use **`getUpcomingTrips`** or **`getTripById`**, which **do** embed `billing_variant`. |

**Combined conclusion:** The behaviour is overwhelmingly explained by **Hypothesis C** plus **policy mismatch**: passenger fallback treats raw **`billing_variants.name`** as the Unterart label, but product rules already define **`Standard`** as a **non-display** sentinel for Unterart (see `isStandardVariantDisplayName` / `formatBillingDisplayLabel`). A secondary risk is **nested `billing_types` as array**: resolver should eventually use **`billingFamilyFromEmbed`** for the family step for parity with the rest of the app.

### 5. `billing_variants` table (generated types)

From [`src/types/database.types.ts`](../../src/types/database.types.ts) (`billing_variants.Row`):

- **`name: string`** — human-readable Unterart label used across the app.
- **`code: string`** — stable code (not the primary user-facing label in `formatBillingDisplayLabel`).
- Also: `billing_type_id`, `sort_order`, `kts_default`, `no_invoice_required_default`, `rechnungsempfaenger_id`, `created_at`, `id`.
- **No separate `label` column** in generated types — the display field intended for „Unterart name“ is **`name`**.

### 6. Senior recommendation (exact fix location)

- **File:** [`src/features/trips/lib/resolve-passenger-label.ts`](../../src/features/trips/lib/resolve-passenger-label.ts)
- **Change:** After `client_name`, when considering **`billing_variant.name`**, apply the **same sentinel rule** as billing UI: if the trimmed name is **`Standard`** (case-insensitive), **do not** return it; treat it as missing and continue to **`billing_types`** (Familie), using **`billingFamilyFromEmbed(trip.billing_variant?.billing_types)`** for `.name` so array-shaped embeds match [`format-billing-display-label.ts`](../../src/features/trips/lib/format-billing-display-label.ts).
- **Lines to touch:** the Unterart / Abrechnungsfamilie block — today roughly **lines 24–31** (`fromVariant` / `fromFamily`).

This aligns passenger fallback with **„Standard-Unterart → nur Familienname“** already implemented for badges/captions in [`trip-row.tsx`](../../src/features/overview/components/trip-row.tsx) and [`kanban-trip-card.tsx`](../../src/features/trips/components/kanban/kanban-trip-card.tsx) via `formatBillingDisplayLabel`.

### Resolution (fix applied)

- **`resolve-passenger-label.ts`** now treats **`Standard`** (via `isStandardVariantDisplayName`) as an absent Unterart for passenger labelling and falls through to the Familie.
- **Abrechnungsfamilie** is read with **`billingFamilyFromEmbed(trip.billing_variant?.billing_types)?.name`**, matching PostgREST object/array embed shapes used elsewhere.
- **`bun run build`** passed after the change (see repo history / CI).

---

## Data Model

- **Database Schema**: The central model is the `trips` table.
- **Passenger Name**: Stored in the `client_name` column (string) on the `trips` table.
- **Kostenträger**: Stored as a foreign key `payer_id` on the `trips` table, referencing the `payers` table.
- **Abrechnungsfamilie**: Also known as `billing_types` (or billing family). It is not stored directly on the trip. A trip links to `billing_variant_id` (Unterart), and that `billing_variants` row links to `billing_type_id` (Abrechnungsfamilie). 
- **Unterart**: Stored as `billing_variant_id` on the `trips` table, referencing the `billing_variants` table.
- **Passenger Required Flag**: There is a `requirePassenger: boolean` flag. It is stored inside the `behavior_profile` JSON/structured column on the `billing_types` (Abrechnungsfamilie) table, defined by the `BillingTypeBehavior` interface in `src/features/payers/types/payer.types.ts`.

## Quickshare (historical — superseded)

- **File Path**: `src/features/trips/lib/share-utils.ts`
- **Current behaviour**: Passenger segment uses `resolvePassengerLabel(trip)`; `formatTripForSharing` / `copyTripToClipboard` take `TripForShare` (`Trip & TripWithBillingContext`).

## Dashboard (historical — superseded)

- **Components**: `trip-row.tsx`, `kanban-trip-card.tsx`, `kanban-drag-preview.tsx`, `trip-detail-sheet.tsx` (title) — all use `resolvePassengerLabel` where applicable; sheet keeps draft-first name.

## Shared Logic (historical — superseded)

- **Shared utility**: **`resolvePassengerLabel`** in `src/features/trips/lib/resolve-passenger-label.ts`. Replaces prior split between `'Anonym'`, `'Unbekannter Kunde'`, and `'Unbekannter Fahrgast'`.

## Query Coverage

- **Are Abrechnungsfamilie + Unterart already fetched?**: **Yes**. In `src/features/trips/api/trips.service.ts`, the core methods like `getUpcomingTrips` (which populates the dashboard/kanban) already include the necessary joins:
  `billing_variant:billing_variants!trips_billing_variant_id_fkey(name, code, billing_types!billing_variants_billing_type_id_fkey(name, color))`

## Edge Cases

- **Null/Empty Abrechnungsfamilie**: Since there is no fallback chain implemented right now, if `client_name` is empty, it immediately falls back to the hardcoded static string ("Unbekannt", "Anonym", etc.). 
- **Null/Empty Unterart**: Same behaviour; it just falls back to the static string.
- **Existing Fallback Chain**: There is no fallback chain beyond the simple OR operator (`|| 'Unbekannt'`).

## Your Recommendation

As a senior developer, my recommendation is to implement a **single shared utility** (e.g., `resolvePassengerName(trip)` in `src/features/trips/lib/resolve-passenger-name.ts`). 

1. **Consistent Logic**: This utility should check for `trip.client_name`. If falsy, it should check `trip.billing_variant?.billing_types?.name` (Abrechnungsfamilie). If that is also falsy, it should fall back to `trip.payer?.name`, and finally default to `"Unbekannter Fahrgast"`.
2. **Type Safety**: Define a specific interface for the enriched trip type that this utility expects (including the `billing_variant` and `payer` joins), and cast or handle standard `Trip` types safely.
3. **Refactoring**: Replace the inline checks in `share-utils.ts`, `trip-row.tsx`, and `kanban-trip-card.tsx` with this single utility. This eliminates the inconsistency between "Anonym", "Unbekannter Kunde", and "Unbekannter Fahrgast" while providing a much more useful fallback (the Abrechnungsfamilie name) for trips where the passenger name isn't required.
