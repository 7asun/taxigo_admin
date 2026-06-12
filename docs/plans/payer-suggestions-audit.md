# Payer suggestions audit — trip creation flow

**Date:** 2026-06-12  
**Scope:** Trip creation UI, client/payer data model, existing hooks, RLS, and a phase-1 path for ranked “top 3 payer suggestions” without changing submit behavior.  
**No code changes** — research only.

---

## Executive summary

Payer selection in **Neue Fahrt** is a required React Hook Form field (`payer_id`) owned by `CreateTripForm` and rendered in `CreateTripPayerSection`. It appears **before** passenger/client selection. The trip stores `payer_id` and `billing_variant_id` **directly on `trips`**, not via invoices.

There is **no** `default_payer` on `clients`. The closest existing pattern is `useClientPayers` in the invoice builder, which loads deduplicated `(payer_id, billing_variant_id)` pairs from **all** `trips` and `recurring_rules` for a `client_id` — but it is **not** ranked, **not** used in trip creation, and **not** limited to top N.

`ClientTripsPanel` (create-trip dialog side panel) shows **upcoming** trips for a client, not payer usage history.

**Safest phase 1:** read-only ranked hints + optional **clickable chips** that call the same `form.setValue('payer_id', …)` path as the dropdown, shown once a Stammdaten `client_id` is known. **Do not** auto-select payer or auto-submit.

---

## Trip creation entry points

| Surface | File | Notes |
|--------|------|-------|
| Global dialog / drawer | `src/features/trips/components/create-trip/create-trip-dialog.tsx` | Vaul drawer (&lt;768px) or Dialog (md+). Optional `preselectedClientId` (e.g. Cmd+K). Desktop: `ClientTripsPanel` when client known. |
| Header button | `src/features/trips/components/create-trip-dialog-button.tsx` | Opens `CreateTripDialog`. |
| Full page | `src/app/dashboard/trips/new/page.tsx` | Wraps `CreateTripForm` only — **no** side panel. |
| Form implementation | `src/features/trips/components/create-trip/create-trip-form.tsx` | Re-exported from `create-trip-form.tsx`. |
| Recurring rules (related) | `src/features/recurring-rules/components/create-recurring-rule-sheet.tsx` | Separate flow; also has `payer_id` — out of scope for trip-create suggestions unless product wants parity later. |

Form section order (fixed today):

1. **Kostenträger** (`CreateTripPayerSection`)
2. Abholung (passengers / addresses)
3. Ziel
4. Abfahrt / Rückfahrt
5. Extras

Pickup/dropoff blocks are `pointer-events-none opacity-40` until `isPayerSelected` (`!!watchedPayerId`).

---

## 1. Where is payer selected, and who owns state?

### UI location

`CreateTripPayerSection` (`src/features/trips/components/create-trip/sections/payer-section.tsx`):

- **Kostenträger** — `FormField` `name='payer_id'`, shadcn `Select` over `payers` from context.
- **Abrechnungsfamilie** — local `billingFamilyId` + `setBillingFamilyId` (not an RHF field; drives variant scope).
- **Unterart** — `FormField` `name='billing_variant_id'`.
- Optional billing metadata: `billing_calling_station`, `billing_betreuer`, KTS, Reha-Schein, no-invoice switches.

### State ownership

| Concern | Owner | Mechanism |
|---------|--------|-----------|
| `payer_id` | `CreateTripForm` | `useForm<TripFormValues>` — `defaultValues.payer_id: ''`, `form.watch('payer_id')` → `watchedPayerId` |
| `billing_variant_id` | `CreateTripForm` | RHF field; cleared when payer changes (effect on `watchedPayerId`) |
| `billingFamilyId` | `CreateTripForm` | `useState('')`; passed via `TripFormSectionsProvider` |
| Payer list | `useTripFormData(watchedPayerId)` | `usePayersQuery()` → `referenceKeys.payers()` |
| Variants for payer | `useTripFormData` | `useBillingVariantsForPayerQuery(payerId)` |
| Header billing label | `CreateTripDialog` | `onBillingTypeChange` callback from form |
| Linked client for side panel | `CreateTripForm` | `passengers[].client_id` or `preselectedClientId` → `onClientSelect` |

Context wiring: `trip-form-sections-context.tsx` exposes `watchedPayerId`, `payers`, `billingTypes`, `billingFamilyId`, etc., to section components without prop drilling.

### Payer-change side effects (existing)

When `watchedPayerId` changes, the form resets `billing_variant_id`, `reha_schein`, and `billingFamilyId`, and re-runs KTS / no-invoice catalog cascades (`resolveKtsDefault`, `resolveNoInvoiceRequiredDefault`). Any suggestion chip must use the same `field.onChange` / `form.setValue('payer_id', id)` path so these effects stay consistent.

---

## 2. Database tables and columns

### Client / passenger

| Table / field | Role |
|---------------|------|
| `clients` | Stammdaten Fahrgast. PK `id` (UUID). Tenant `company_id`. Names, address, `price_tag`, `kts_patient_id`, etc. **No `payer_id` or `default_payer`.** |
| `trips.client_id` | Optional FK → `clients.id`. Canonical link for aggregation and invoice `per_client` mode. |
| `trips.client_name` | Denormalized display string; used when `client_id` is null. |
| `trips.client_phone` | Contact snapshot on trip. |

See `docs/trip-client-linking.md` for the three passenger situations (linked, name-only, anonymous).

### Payer (Kostenträger)

| Table / field | Role |
|---------------|------|
| `payers` | Catalog row per Kostenträger: `id`, `company_id`, `name`, `number`, `kts_default`, `no_invoice_required_default`, `rechnungsempfaenger_id`, etc. |
| `billing_types` | Abrechnungsfamilie; `payer_id` FK. |
| `billing_variants` | Unterart; `billing_type_id` FK. |

### Trip ↔ payer relationship

| Table / field | Role |
|---------------|------|
| `trips.payer_id` | FK → `payers.id` (nullable in DB; **required** in create form Zod). |
| `trips.billing_variant_id` | FK → `billing_variants.id` (required on submit when payer has variants). |
| `trips.billing_type_id` | Denormalized family id for price engine / reporting. |
| `recurring_rules.payer_id` / `billing_variant_id` | Template for cron-generated trips; same leaf model as trips. |

### Related billing (not trip FK at creation)

| Table | Role |
|-------|------|
| `invoices` | Issued document: **required** `payer_id`, optional `client_id` (`per_client` mode). Downstream of trips. |
| `invoice_line_items` | Links trips to invoices; snapshots billing labels at issue time. |
| `client_price_tags` | Optional `(client_id, payer_id?, billing_variant_id?)` **pricing** — not a default payer preference. |
| `client_km_overrides` | Same scoping pattern for km overrides. |
| `billing_pricing_rules` | Payer/family/variant-scoped pricing rules. |

Model diagram:

```text
clients ──(optional)──► trips.client_id
payers  ──────────────► trips.payer_id
billing_types (family) ◄── billing_variants ◄── trips.billing_variant_id

invoices.payer_id ──► payers   (aggregate billing, not trip creation)
```

Reference: `docs/billing-families-variants.md`, `src/types/database.types.ts` (`trips`, `clients`, `payers`).

---

## 3. Is payer stored on the trip row or through a billing entity?

**Directly on the trip row** via foreign keys:

- `trips.payer_id` → `payers`
- `trips.billing_variant_id` → `billing_variants` (family via join)

Invoices reference the same payer catalog when trips are billed later; they do **not** mediate trip creation. Submit payload in `create-trip-form.tsx` sets `payer_id` and `billing_variant_id` on each inserted `trips` row (`tripsService.createTrip`).

---

## 4. Can the code already query previous trips for a selected client during trip creation?

### Partially — not for payer ranking

| Mechanism | Where | What it loads | Used in trip create? |
|-----------|--------|---------------|----------------------|
| `ClientTripsPanel` | `src/features/trips/components/client-trips-panel.tsx` | Up to 10 **future** trips (`scheduled_at >= start of today`), status not `cancelled`/`completed`, by `client_id` (fallback `client_name` if unlinked). Embeds `payer:payers(name)` for display only. | Yes — dialog side panel when `onClientSelect` fires |
| `useClientPayers` | `src/features/invoices/hooks/use-client-payers.ts` | **All** `trips` + `recurring_rules` for `client_id`; dedupe by `payer_id` + `billing_variant_id`; **no** count, **no** sort by frequency | **No** — invoice builder `per_client` mode only |
| `searchClients` / `searchClientsById` | `use-trip-form-data.ts` | Client Stammdaten search by text or id | Yes — passenger autocomplete |
| `resolveClientByName` | debounced in `create-trip-form.tsx` | Best-effort link free-text passenger to `clients.id` after payer chosen | Yes — silent enrichment |

**Conclusion:** Upcoming trips for dispatch context exist; **historical payer usage for suggestions does not exist** in the trip creation path. The invoice-builder hook is the closest reusable query but lives under `features/invoices` and returns unordered unique combinations.

---

## 5. Client identifier in the form — stable for aggregation?

### Identifier

- **Primary:** `passengers[].client_id` — UUID from `clients.id` when user picks Stammdaten in `AddPassengerInline` / `AddressGroupCard` (`src/features/trips/components/trip-address-passenger/add-passenger-inline.tsx` sets `client_id: selectedClient?.id`).
- **Secondary:** `preselectedClientId` prop (Cmd+K / global open) — same UUID.
- **Not a form-level field:** There is no top-level RHF `client_id` on the trip form (unlike invoice step 2). Client identity is per passenger row.

### Stability for aggregates

| Case | Safe for `eq('client_id', …)`? |
|------|--------------------------------|
| Stammdaten-linked passenger | **Yes** — stable UUID, company-scoped via RLS |
| Name-only passenger (`client_id` null) | **No** — would need `client_name` heuristics (fragile; panel already has name fallback for *upcoming* trips only) |
| Anonymous trip | **No** |
| Best-effort `resolveClientByName` | **Yes when resolved** — same UUID; debounced after payer selected |

For payer suggestions, gate the query on **non-null `client_id`** from the first linked passenger (same rule as `CreateTripForm` uses for `onClientSelect` / `ClientTripsPanel`).

---

## 6. Existing hooks / actions to extend

| Asset | Path | Extend for payer-by-client? |
|-------|------|-----------------------------|
| `useClientPayers` | `src/features/invoices/hooks/use-client-payers.ts` | **Best starting point** — add trip count, `ORDER BY count DESC`, `LIMIT 3`, optional exclude `cancelled`. Consider moving to `features/trips/hooks` or shared `features/clients` to avoid invoice coupling. |
| `useTripFormData` | `src/features/trips/hooks/use-trip-form-data.ts` | Client search only; could host a thin wrapper hook. |
| `usePayersQuery` / `useBillingVariantsForPayerQuery` | `src/features/trips/hooks/use-trip-reference-queries.ts` | Resolve payer names; load variants after chip click. |
| `fetchPayers` | `src/features/trips/api/trip-reference-data.ts` | Reference list already cached. |
| `referenceKeys` | `src/query/keys/reference.ts` | Add e.g. `clientPayerSuggestions(clientId)`. |
| Server actions | — | **None required for phase 1** — trip create already uses browser Supabase client; RLS scopes reads. |

`useClientPayers` query key today: `['client_payers', clientId]` (not in `referenceKeys` — consider aligning).

**Ranking logic (client-side extension of existing query):**

```sql
-- Conceptual; implement via Supabase .select() + JS reduce, or .rpc() later
SELECT payer_id, billing_variant_id, COUNT(*) AS trip_count
FROM trips
WHERE client_id = $1 AND payer_id IS NOT NULL
  AND status != 'cancelled'  -- product choice
GROUP BY payer_id, billing_variant_id
ORDER BY trip_count DESC
LIMIT 3;
```

Include `recurring_rules` in phase 1 only if product wants “scheduled pattern” weighted equally (invoice hook merges both; for **frequency** ranking, trips-only is simpler and matches “historical usage” language).

---

## 7. Default / preferred / last payer on client profile?

| Concept | Exists? | Where |
|---------|---------|--------|
| `clients.default_payer_id` | **No** | — |
| Preferred payer on profile | **No** | — |
| Last payer | **No** persisted field | Infer from `trips` history only |
| `payers.kts_default` / `no_invoice_required_default` | **Yes** | Catalog defaults when **that** payer is selected — not client-specific |
| `client_price_tags` with `payer_id` | **Yes** | Negotiated **price** scope, not default payer UI |
| `recurring_rules.payer_id` | **Yes** | Active series template for client |
| Invoice builder historical combos | **Yes** | `useClientPayers` + `step-2-params.tsx` — UX precedent for “past Abrechnung” |

`docs/clients.md` documents `client_km_overrides` and `reference_fields`, not payer preferences.

---

## 8. Post-creation payer changes — edge cases

Payer changes **after** creation are **first-class** in the product:

| Path | Behavior |
|------|----------|
| Trip detail sheet | `payerDraft` / `billingVariantDraft`; save via `build-trip-details-patch.ts` → `tripsService.updateTrip` |
| Paired Hin/Rück sync | `payer_id` in `PAIRED_SYNC_COLUMN_KEYS` — can mirror to linked leg (`docs/trip-detail-sheet-editing.md`) |
| Recurring series | Editing rule `payer_id` affects **future** materialized trips, not retroactive history |
| Invoices | `invoice_line_items` snapshot billing labels; changing `trips.payer_id` does not rewrite issued PDFs |
| Duplication | `duplicate-trips.ts` copies `payer_id` from source |

**Frequency in data:** Not measured in repo. Expect payer changes to be **uncommon but intentional** (corrections, Kostenträger wechsel). Ranking should use historical rows **as recorded** (including trips later edited — unless product excludes them). Phase 1 should not penalize or hide payers that were corrected away on recent trips without explicit product rules.

---

## 9. Safest ranked “top 3” query approach

| Approach | Fit for phase 1 | Notes |
|----------|-----------------|-------|
| **Direct aggregate (Supabase client)** | **Recommended** | Matches `useClientPayers` / `ClientTripsPanel` patterns; no migration; admin RLS already allows `trips` SELECT by company. Rank in JS or use PostgREST raw SQL only if needed. |
| **Database view** | Defer | Postgres 15+ needs `security_invoker` on views exposed to API; adds migration + policy review for little gain at low volume. |
| **SQL function (RPC)** | Defer | Justified when volume, indexing, or driver-role access requires server-side aggregation. `get_controlling_breakdown` is the precedent for **revenue** breakdowns, not client payer frequency. |

**Index note:** `idx_trips` patterns exist (`20260514130000_trips_performance_indexes.sql`); if aggregates slow down, add `(company_id, client_id, payer_id)` partial index where `client_id IS NOT NULL` in a later phase.

---

## 10. RLS and permissions for historical reads

Trip creation runs in **dashboard** → **admin only** (layers 1–2 in `docs/access-control.md`). Browser client uses anon key + user JWT.

| Table | Policy (admin dispatcher) | Impact on suggestions |
|-------|---------------------------|------------------------|
| `trips` | `trips_select_company_admin`: `current_user_is_admin()` AND `company_id = current_user_company_id()` | Can read all company trips for `client_id` filter |
| `clients` | Admin company-scoped | Client search / `searchClientsById` |
| `payers` | Admin company-scoped | Payer names for chips |
| `billing_variants` / `billing_types` | Admin (catalog tables) | Optional variant label on chip |
| `recurring_rules` | **Not listed** in `access-control.md` RLS table; queried by `useClientPayers` today | Verify production has admin company policy before merging rules into rank |
| `invoices` | Admin only | Not needed for trip-create suggestions |

**Drivers** cannot access trip creation UI; driver `trips` SELECT policies are irrelevant here.

**No service role** needed for phase 1 read-only client hook.

---

## 11. Files to touch for phase 1 (suggestions only, no behavior change)

### New

| File | Purpose |
|------|---------|
| `src/features/trips/hooks/use-client-payer-suggestions.ts` (or extend `use-client-payers.ts` with `mode: 'ranked'`) | Query + rank top 3 `(payer_id, billing_variant_id?, trip_count, last_used_at?)` |
| Optional: `src/features/trips/components/create-trip/payer-suggestion-chips.tsx` | Presentational chips |

### Modify

| File | Change |
|------|--------|
| `src/query/keys/reference.ts` | `clientPayerSuggestions(clientId)` |
| `src/features/trips/components/create-trip/create-trip-form.tsx` | Derive `suggestionClientId` from first `passengers[].client_id` or `preselectedClientId`; pass to context |
| `src/features/trips/components/create-trip/trip-form-sections-context.tsx` | Optional: `suggestionClientId`, suggestions loading state |
| `src/features/trips/components/create-trip/sections/payer-section.tsx` | Render read-only hint + chips below Kostenträger `Select` |
| `docs/plans/payer-suggestions-audit.md` | Keep in sync when shipping |

### Do **not** change for phase 1

| File | Reason |
|------|--------|
| `create-trip-form.tsx` `handleSubmit` / Zod schema | No auto-fill of `payer_id` |
| `trips.service.ts` insert shape | Unchanged |
| Supabase migrations | Not required for read-only aggregate |
| `ClientTripsPanel` | Different concern (upcoming dispatch) |
| Invoice builder | Already has its own combo select |

### Optional parity (later)

- `src/app/dashboard/trips/new/page.tsx` — page has no side panel; suggestions in payer section still apply.
- `create-recurring-rule-sheet.tsx` — separate product decision.

---

## 12. Senior recommendation — phase 1 UX pattern

### Recommended: **read-only panel + clickable quick-select chips**

**Why not automatic default with warning?**

- Payer is **required** and listed **first**; most dispatches pick Kostenträger before linking Stammdaten. Auto-selecting when client appears would **change payer after the user may have already chosen one** — confusing and risky for billing/KTS cascades.
- Silent wrong payer is worse than no suggestion; warnings add friction without beating explicit chips.
- Form already resets variant/KTS state on payer change — auto-default would trigger that cascade unexpectedly.

**Why not read-only panel alone?**

- Chips that call the **same** `payer_id` `onValueChange` as the dropdown give speed without new submit paths. Label chips with payer name + optional trip count (“12 Fahrten”) and optionally Familie/Unterart if ranking at variant granularity.
- Keep chips **disabled** while `isLoading` payers reference data to avoid orphan ids.

**UX placement**

- Show suggestions **in `CreateTripPayerSection`** once `suggestionClientId` is set (passenger linked or Cmd+K preset), **below** the Kostenträger dropdown.
- If payer already selected manually, show suggestions as “Häufig für [Name]” **without** overriding; chips can still allow one-click switch (user intent).
- If only `client_name` (no `client_id`), show nothing or a muted “Stammdaten verknüpfen für Vorschläge” — do not rank on name string.

**Phase 2+ (out of scope)**

- Auto-suggest **Unterart** chip second step after payer chip (reuse `billing_variant_id` setValue).
- Reorder form (client before payer) — large UX change; not phase 1.
- Server RPC if client trip history &gt; few thousand rows per Fahrgast.

---

## Recommended implementation path

Smallest safe version to ship first:

1. **Hook:** `useClientPayerSuggestions(clientId)` — enabled when `clientId` is non-null; query `trips` with `.eq('client_id', clientId).not('payer_id', 'is', null)`; aggregate in JS to top **3** `payer_id` by count (optionally tie-break by `max(scheduled_at)`); `staleTime` 5m like `useClientPayers`. **Trips only** in v1 (skip `recurring_rules` unless product insists).

2. **Query key:** `referenceKeys.clientPayerSuggestions(clientId)` for cache + invalidation consistency.

3. **UI:** In `payer-section.tsx`, when suggestions exist, render a compact row: “Frühere Kostenträger für [Vorname Nachname]” + up to 3 chips. Click → `form.setValue('payer_id', id)` (and existing payer-change effects run). **No** change to validation, submit, or default `payer_id`.

4. **Wire client id** in `create-trip-form.tsx`: `const suggestionClientId = passengers.find(p => p.client_id)?.client_id ?? preselectedClientId ?? null`.

5. **Tests / manual QA:** Linked client with 3+ historical payers; anonymous passenger (no UI); payer already selected then client linked (chips appear, no auto swap); chip click resets variant per existing effect; mobile drawer layout.

6. **Docs:** One paragraph in `docs/billing-families-variants.md` § Neue Fahrt pointing to suggestions behavior.

**Explicit non-goals for v1:** DB migration, auto-selection, invoice/recurring merge in rank, name-only client fallback, changing section order, driver app.

---

## Numbered answers (quick reference)

| # | Answer |
|---|--------|
| 1 | `CreateTripPayerSection` / RHF `payer_id` in `CreateTripForm`; `billingFamilyId` local state; lists from `useTripFormData`. |
| 2 | `clients` + `trips.client_id` / `client_name`; `payers` + `trips.payer_id`; `billing_variants` + `trips.billing_variant_id`. |
| 3 | **Direct FK on `trips`**; invoices are downstream. |
| 4 | **Upcoming trips** yes (`ClientTripsPanel`); **payer history for create** no. |
| 5 | `passengers[].client_id` (UUID); stable when set; null for anonymous/name-only. |
| 6 | **Extend `useClientPayers`** pattern + new query key; no server action required. |
| 7 | **No** client default payer; catalog defaults on `payers`; `client_price_tags` is pricing only. |
| 8 | **Yes** — detail sheet + paired sync; intentional; frequency unknown. |
| 9 | **Direct client aggregate** first; view/RPC later if needed. |
| 10 | Admin company-scoped RLS on `trips`/`clients`/`payers`; drivers irrelevant. |
| 11 | Hook, `reference.ts`, `payer-section.tsx`, `create-trip-form.tsx`, context types; optional chip component. |
| 12 | **Read-only hints + clickable chips**; not auto-default. |

---

## Related documentation

- `docs/billing-families-variants.md` — Neue Fahrt payer/family/variant flow
- `docs/trip-client-linking.md` — `client_id` vs `client_name`
- `docs/trip-detail-sheet-editing.md` — post-create payer edits
- `docs/client-price-tags.md` — client+payer pricing (not suggestions)
- `docs/access-control.md` — RLS summary
- `src/query/README.md` — `referenceKeys.payers()` vs `['payers']`
