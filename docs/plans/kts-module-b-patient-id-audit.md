# KTS Module B — Patient ID Audit

**Date:** 2026-06-10  
**Status:** **Complete** — implemented in **KTS PR3** (`kts_patient_id` on `clients` + `trips`). See [`docs/kts-architecture.md`](../kts-architecture.md) §3.0 and migration `supabase/migrations/20260610130000_kts_patient_id.sql`.

**Scope:** Read-only audit for introducing **external / KTS patient identifiers** on clients and trips (planned PR2.3+ / Module B).  
**Constraint:** Audit was read-only; implementation followed this audit in PR3.

**Related:** [`docs/plans/kts-module-b-audit.md`](kts-module-b-audit.md) (import/CSV infrastructure), [`docs/trip-client-linking.md`](../trip-client-linking.md) (client_id vs client_name), [`docs/kts-architecture.md`](../kts-architecture.md).

---

## Sources read

- All **109** Supabase migrations — grep for `kts_patient_id`, `external_patient_id`, `patient_id` on `trips` / `clients` (no matches).
- `src/types/database.types.ts` — `clients` and `trips` table definitions.
- `src/features/trips/api/trips.service.ts`
- `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx`
- `src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts`
- `src/features/clients/components/client-form.tsx`, `client-detail-panel.tsx`
- `src/app/dashboard/clients/[id]/page.tsx`, `page.tsx`, `new/page.tsx`
- `src/components/ui/client-auto-suggest.tsx`, `src/features/trips/hooks/use-trip-form-data.ts`
- Client-related feature files under `src/features/clients/`
- Module docs under `docs/` (KTS, trip-client-linking, kundennummer, invoices-module, bulk-trip-upload, etc.)

---

## Audit answers

### 1. Clients table — columns and patient-ID fields

**Table name:** `public.clients` (UI label: Fahrgast / passenger; no separate `patients` table).

**Every column on `clients` (from `Database['public']['Tables']['clients']['Row']` in `database.types.ts`):**

| Column | Type (Row) | Notes |
| ------ | ---------- | ----- |
| `id` | `string` (uuid) | Primary key |
| `company_id` | `string` (uuid) | Tenant scope |
| `customer_number` | `number` | Auto-assigned KND-NR integer (see `docs/kundennummer-system.md`) |
| `first_name` | `string \| null` | |
| `last_name` | `string \| null` | |
| `company_name` | `string \| null` | |
| `is_company` | `boolean` | Derived on save when only company_name set |
| `greeting_style` | `string \| null` | |
| `street` | `string` | Required |
| `street_number` | `string` | Required |
| `zip_code` | `string` | Required |
| `city` | `string` | Required |
| `lat` | `number \| null` | Geocoding |
| `lng` | `number \| null` | Geocoding |
| `phone` | `string \| null` | |
| `phone_secondary` | `string \| null` | Migration `20260325200000` |
| `email` | `string \| null` | Migration `20260325200000` |
| `birthdate` | `string \| null` | Migration `20260528070000` |
| `relation` | `string \| null` | e.g. Angehörige |
| `notes` | `string \| null` | |
| `is_wheelchair` | `boolean` | Migration `20260325100000` |
| `price_tag` | `number \| null` | Legacy global client price |
| `reference_fields` | `Json \| null` | Ordered `{ label, value }[]` for invoice PDF; migration `20260410140000` |
| `requires_daily_scheduling` | `boolean \| null` | |
| `stations` | `string[] \| null` | |
| `created_at` | `string` | |
| `updated_at` | `string \| null` | |

**`external_patient_id` / `kts_patient_id` on clients:** **Does not exist.**

**Migration search:** Grep across all `supabase/migrations/*.sql` for `kts_patient_id`, `external_patient_id`, and `patient_id` column definitions on `clients` or `trips` returned **zero matches**. The only “patient” hit is commentary text in `20260331100000_add_address_fields_to_payers.sql` (“patient transport”), not a column name.

**Closest existing extensibility:** `reference_fields` JSONB — free-form label/value pairs already edited in `ClientForm` (“Bezugszeichen / Referenzfelder”). A dedicated `external_patient_id` column would be clearer for KTS matching than burying the ID in reference_fields.

---

### 2. Trips table — `kts_patient_id` and all `kts_*` columns

**`kts_patient_id` on trips:** **Does not exist** (not in `database.types.ts`, not in any migration).

**All `kts_*` columns currently on `trips`:**

| Column | Type | Purpose |
| ------ | ---- | ------- |
| `kts_document_applies` | `boolean NOT NULL` | Operational KTS flag |
| `kts_source` | `string \| null` | How flag was set: `variant`, `familie`, `payer`, `manual`, `system_default` |
| `kts_fehler` | `boolean NOT NULL` | Document erroneous |
| `kts_fehler_beschreibung` | `text \| null` | Free-text error description |

Migrations: `20260403120000_kts_catalog_and_trips.sql` (`kts_document_applies`, `kts_source`); `20260504130000_kts_fehler.sql` (`kts_fehler`, `kts_fehler_beschreibung`).

**Also on `recurring_rules` (not trips):** `kts_document_applies`, `kts_source` — cron copies to generated trips.

**Satellite table:** `kts_corrections` (PR2) — correction rounds, not patient ID.

---

### 3. Client detail page — files, route, form, save path

**Two entry points:**

| View | Route | Renderer |
| ---- | ----- | -------- |
| **Classic (table) edit** | `/dashboard/clients/[id]` | `src/app/dashboard/clients/[id]/page.tsx` — RSC fetches `clients` row, renders `ClientForm` |
| **Column (Miller) edit** | `/dashboard/clients?clientId=<uuid>` | `src/app/dashboard/clients/page.tsx` → `ClientsColumnView` → `ClientDetailPanel` → `ClientForm` (`noCard`) |
| **Create** | `/dashboard/clients/new` | `src/app/dashboard/clients/new/page.tsx` → `ClientForm` with `initialData={null}` |

**Primary form component:** `src/features/clients/components/client-form.tsx`  
**Panel wrapper (column view):** `src/features/clients/components/client-detail-panel.tsx`

**Form sections (in order):**

1. **Kontakt** — Anrede, Vorname, Nachname, Telefon, E-Mail, Telefon 2, Geburtsdatum; optional Firma (toggle)
2. **Adresse** — Straße (+ `AddressAutocomplete`), Nr., PLZ, Stadt
3. **Weitere Angaben** — Beziehung, Notizen
4. **Bezugszeichen / Referenzfelder** — dynamic label/value rows (max ~6 recommended), persisted as `reference_fields` JSONB
5. **Einstellungen** — Rollstuhl switch (hidden in `noCard` mode; panel header provides switch)

**Column view extras** (not in standalone `[id]` page card footer): Kunden-Preise, KM-Overrides, Regelfahrten list — in `ClientDetailPanel`.

**How updates are saved:**

- **Not** a server action.
- **Client component** → `react-hook-form` + Zod → `clientsService.updateClient()` / `clientsService.createClient()` in `src/features/clients/api/clients.service.ts` (browser Supabase client, RLS).
- Column view: header button calls `formRef.current?.submit()` imperatively.
- Classic page: inline submit button on `ClientForm`.
- On success: toast + `router.push('/dashboard/clients')` (classic) or `onSuccess` callback (column view).

---

### 4. Client data flow into the trip detail sheet

#### 4a. Copied onto trip row vs read live from `clients`

The project uses a **denormalized snapshot pattern** on trips (documented in `docs/trip-client-linking.md`):

| Field | On `trips` row | Source when saving |
| ----- | -------------- | ------------------ |
| `client_id` | FK, nullable | Set when user picks from autosuggest; cleared when typing breaks link |
| `client_name` | Denormalized string | Composed from first + last draft on **Trip aktualisieren** |
| `client_phone` | Denormalized string | From draft on save |
| `is_wheelchair` | Trip flag | From client on select, or manual toggle |

**Not copied from client on trip save:** address, email, birthdate, `reference_fields`, `customer_number`, greeting — those stay on `clients` only unless separately mirrored (they are not on the trip row).

When a client is **selected** (`handleTripClientSelect` in `trip-detail-sheet.tsx`):

```typescript
setClientIdDraft(client.id);
setClientFirstDraft(client.first_name ?? '');
setClientLastDraft(client.last_name ?? '');
setClientPhoneDraft(client.phone ?? '');
setWheelchairDraft(!!client.is_wheelchair); // if defined
```

Drafts are persisted via `buildTripDetailsPatch` → `patch.client_id`, `patch.client_name`, `patch.client_phone`, `patch.is_wheelchair` on **Trip aktualisieren**.

#### 4b. Join / embed when fetching the trip

**Yes — optional embed on detail fetch.**

`tripsService.getTripById` (`trips.service.ts`):

```typescript
.select(
  '*, billing_variant:billing_variants(...), clients(*), payers(*), driver:accounts!..., fremdfirma:...'
)
```

List/kanban queries typically use `select('*')` **without** `clients` embed.

**Hydration in detail sheet** (`useEffect` on `trip`):

- If `trip.clients` embed present → populate name drafts from embed.
- Else if `trip.client_id` set → fallback `searchClientsById(trip.client_id)` to fill name/phone drafts.
- Else → split `trip.client_name` into first/last drafts; phone from `trip.client_phone`.

**Display in lists/PDFs** uses **trip snapshot fields**, not live client joins — same principle as invoice line items.

#### 4c. Client select / autosuggest — file and writes

| Piece | File |
| ----- | ---- |
| Autosuggest UI | `src/components/ui/client-auto-suggest.tsx` |
| Search API | `useTripFormData().searchClients` — `src/features/trips/hooks/use-trip-form-data.ts` (queries `clients` with ilike, limit 8) |
| Wired in sheet | `trip-detail-sheet.tsx` — `ClientAutoSuggest` on **Vorname** field; Nachname is plain `Input` |
| Select handler | `handleTripClientSelect` — updates **React drafts only** until save |
| Persist | `handleSaveTripDetails` → `buildTripDetailsPatch` → `updateTripMutation` (`tripsService.updateTrip`) |

Typing in Vorname without picking a suggestion calls `onSelect(null)` → clears `client_id` draft while keeping typed name.

---

### 5. “No client” trips — identification pattern

Per `docs/trip-client-linking.md`, three situations:

| Situation | `client_id` | `client_name` |
| --------- | ----------- | ------------- |
| **Stammdaten-linked** | Set (uuid) | Usually matches client |
| **Named, not registered** | `null` | Non-empty (CSV or manual name) |
| **Anonymous** | `null` | `null` |

**There is no separate boolean** like `is_guest` or `has_no_client`. **`client_id IS NULL`** is the signal for “not in database”; combined with `client_name` to distinguish named vs anonymous.

Bulk CSV and create-trip form may later set `client_id` via `resolve_client_id_by_name` RPC (best-effort, non-blocking).

---

### 6. KTS section in trip detail sheet (current shipped state: PR2.2)

**Note:** PR2.3 (patient ID UI) is **not** in the codebase yet. Below reflects **post-PR2.2** UI (correction timeline + form).

**Visibility:** Rendered only when `payerDraft` is set (Kostenträger selected). Block: dashed border, `col-span-2`, two logical rows.

**Row 1 — KTS document**

| UI | State | Saved via |
| -- | ----- | --------- |
| Label “KTS / Krankentransportschein” | — | — |
| Catalog hint text (`ktsCatalogHint`) | Shown when switch ON | Display only (not persisted) |
| `Switch` — KTS document applies | `ktsDocumentAppliesDraft` | **Trip aktualisieren** → `kts_document_applies`, `kts_source` |

**Row 2 — only when `ktsDocumentAppliesDraft === true`**

| UI | State | Saved via |
| -- | ----- | --------- |
| `Switch` — KTS-Fehler | `ktsFehlerDraft` | **Trip aktualisieren** → `kts_fehler`, `kts_fehler_beschreibung` (cleared when fehler off) |
| `Textarea` — error description | `ktsFehlerBeschreibungDraft` | **Trip aktualisieren** (only when fehler on) |
| `KtsCorrectionTimeline` | query `kts_corrections` | **Independent** — read-only list + “Abschließen” per round |
| `KtsCorrectionForm` / “+ Korrektur erfassen” | `showCorrectionForm` | **Independent** — `useInsertKtsCorrectionMutation` → immediate insert; **not** gated on Trip aktualisieren |
| Close correction | per-row button | **Independent** — `useCloseKtsCorrectionMutation` |

**Cascade on UI (not separate saves):** Turning KTS document OFF clears fehler drafts, description, and correction form visibility. Turning fehler OFF clears description and correction form.

**Main save button label:** Footer shows **“Trip aktualisieren”** when `detailsDirty` (includes KTS draft changes). There is no separate “Speichern” for KTS alone.

---

### 7. Read-only field + link to related record — existing patterns

No dedicated shared component named “ReadOnlyLinkedField”. Closest **in-repo patterns:**

| Pattern | Location | Behaviour |
| ------- | -------- | --------- |
| **Table cell link** | `src/features/recurring-rules/components/recurring-rules-columns.tsx` | `Link` to `/dashboard/clients?clientId=${id}` with `text-primary … hover:underline` |
| **Linked partner navigation** | `src/features/trips/trip-detail-sheet/components/linked-partner-callout.tsx` | Read-only summary + `Button` calling `onNavigateToTrip(partner.id)` |
| **Invoice PDF preview** | `src/features/invoices/components/invoice-pdf/invoice-pdf-preview.tsx` | `Link` to `/dashboard/invoices/${invoice.id}` |
| **Shift reconciliation deep link** | `src/features/driver-planning/components/day-plan-edit-popover.tsx` | `Link` with query params |
| **Muted read-only display** | Invoice builder Step 3 / Step 4 | Read-only amounts and locked payer selectors when invoice is frozen |

**Recommendation for patient-ID link:** Follow **recurring-rules column** style — `Link` with `href={/dashboard/clients/${clientId}}` or column-view `?clientId=` — plus muted read-only text for the ID value. Trip detail sheet does **not** currently link to client profile from the passenger block.

---

### 8. Client routing — exact URLs

| Purpose | URL |
| ------- | --- |
| Client list (default column view) | `/dashboard/clients` |
| Client list (table view) | `/dashboard/clients?view=table` |
| Client detail (classic page) | `/dashboard/clients/[id]` — e.g. `/dashboard/clients/550e8400-e29b-41d4-a716-446655440000` |
| Client detail (column view) | `/dashboard/clients?clientId=<uuid>` |
| New client | `/dashboard/clients/new` |

**For a link from trip detail when `trip.client_id` is set:**

- Prefer **`/dashboard/clients/${trip.client_id}`** — works in all contexts (direct navigation, bookmark).
- Alternative consistent with regelfahrten table: **`/dashboard/clients?clientId=${trip.client_id}`** — opens column view with panel pre-selected.

**When `client_id` is null** (name-only trip): link should go to **`/dashboard/clients/new`** or a search/create flow — not `[id]`.

---

### 9. Existing tests — KTS detail sheet and client form

**Trip detail sheet KTS UI:** **No tests** — no files matching `trip-detail-sheet`, `KtsCorrection`, or `kts-correction` under `**/*test*`.

**Client form:** **No tests** — no files matching `client-form` or `ClientForm` under tests.

**Related KTS tests (not detail sheet):**

| File | Coverage |
| ---- | -------- |
| `src/features/trips/lib/__tests__/trip-price-engine.test.ts` | `kts_document_applies` triggers price recalculation / KTS zero pricing |
| `src/features/trips/lib/__tests__/duplicate-trips.test.ts` | `kts_document_applies` in duplicate payload |
| `src/features/invoices/lib/__tests__/resolve-trip-price.test.ts` | `kts_override` / `kts_document_applies` pricing |
| `src/features/invoices/hooks/__tests__/apply-tax-rate-override.test.ts` | `kts_override` line items |
| Various invoice PDF / line-item tests | `kts_override` snapshot flags |

**`kts.service.ts` (`normalizeKtsPatch`, `buildKtsPatchFromDrafts`):** **No unit tests** yet.

**`build-trip-details-patch.ts`:** **No unit tests** yet.

**`resolve-kts-default.ts`:** **No dedicated test file** (only indirect via price engine).

---

### 10. `build-trip-details-patch.ts` — KTS handling

**Yes — KTS fields are handled** via delegation to `buildKtsPatchFromDrafts` from `@/features/kts/kts.service`.

**Inputs read (from `BuildTripDetailsPatchInput`):**

- `ktsDocumentAppliesDraft`
- `ktsFehlerDraft`
- `ktsFehlerBeschreibungDraft`
- `ktsSourceForSave`

**Processing:**

```typescript
Object.assign(
  patch,
  buildKtsPatchFromDrafts({
    trip,
    ktsDocumentAppliesDraft: input.ktsDocumentAppliesDraft,
    ktsFehlerDraft: input.ktsFehlerDraft,
    ktsFehlerBeschreibungDraft: input.ktsFehlerBeschreibungDraft,
    ktsSourceForSave: input.ktsSourceForSave
  })
);
```

**Outputs (when drafts differ from `trip` row):**

| Patch key | Logic (via `buildKtsPatchFromDrafts` + `normalizeKtsPatch`) |
| --------- | ------------------------------------------------------------- |
| `kts_document_applies` | Boolean draft vs trip |
| `kts_source` | `ktsSourceForSave` when document applies/source changes |
| `kts_fehler` | Boolean draft vs trip |
| `kts_fehler_beschreibung` | Trimmed text; `null` when fehler off or empty |

**Cascade rules in `normalizeKtsPatch`:**

- `kts_document_applies: false` → forces `kts_fehler: false`, `kts_fehler_beschreibung: null`
- `kts_fehler: false` → `kts_fehler_beschreibung: null`
- `kts_document_applies: true` without `kts_source` in patch → `kts_source: 'manual'`

**Not handled today:** `kts_patient_id` (column does not exist).

---

## Senior recommendation: auto-populate `kts_patient_id` when KTS switch turns ON

### Context from this audit

- Trip passenger data already uses **write-time snapshots** (`client_name`, `client_phone`) decoupled from live `clients` rows — same rationale as invoice line items (§14 UStG immutability).
- KTS external CSV matching (PR4) will need a **stable identifier on the trip** at clearing time, not a value that changes when someone edits the client profile next week.
- Corrections are **append-only satellite rows**; trip-level KTS flags are operational state on `trips`.

### Recommendation: **copy once at the moment KTS is enabled (write to trip row), not read live on every render**

**Proposed behaviour:**

1. **Source of truth for the master ID:** new column on `clients` — e.g. `external_patient_id` (or `kts_patient_id` on clients only). Edited in `ClientForm` / Kundenprofil.
2. **Trip column:** `trips.kts_patient_id` — optional **snapshot** populated when:
   - User turns **KTS document ON** (`kts_document_applies` false → true), **if** `client_id` is set and client has an external ID; **or**
   - User **links a client** while KTS is already ON; **or**
   - User **manually edits** the field on the trip (override for name-only passengers).
3. **Do not** re-sync from client on every render or every sheet open — that would silently change historical trips when the client profile is updated.
4. **UI display:** Show `trip.kts_patient_id` as the authoritative value for this trip. Optionally show a subtle hint when `client_id` is set and `clients.external_patient_id !== trip.kts_patient_id` (“Kundenprofil wurde geändert — ID auf dieser Fahrt unverändert”) with actions:
   - **“Vom Kundenprofil übernehmen”** — explicit user sync (writes trip row once).
   - **“Patienten-ID im Kundenprofil hinterlegen →”** — `Link` to `/dashboard/clients/${client_id}` when trip has client but ID empty.

### Why not read live only?

| Risk | Live read from `clients` | Snapshot on trip |
| ---- | ------------------------ | ---------------- |
| Client ID updated after trip created | Trip display + CSV match change retroactively | Trip keeps clearing-time value; audit-safe |
| Name-only trip (`client_id` null) | No client row to read | Trip-level manual ID still works |
| PR4 external Beleg matching | Unstable join key over time | Stable `trips.kts_patient_id` per trip |
| Consistency with codebase | Breaks snapshot pattern used for `client_name`, invoice line items | Aligns with existing architecture |

### Why copy at toggle ON (not only at trip creation)?

- KTS can be turned on **after** trip creation (manual override, catalog change, detail sheet edit).
- Toggle ON is the **operational moment** the trip enters the KTS clearing pipeline — analogous to invoicing copying snapshots at issue time.
- If KTS is toggled OFF then ON again, product should decide: **keep previous** `kts_patient_id` vs re-copy from client (recommend: re-copy only if trip field is empty, else preserve unless user clicks sync).

### Implementation sketch (no code — for PR2.3 planning)

- Extend `buildKtsPatchFromDrafts` / detail sheet save path to set `kts_patient_id` when `kts_document_applies` transitions to `true` (fetch client once in save handler or service — not on every render).
- Add optional read-only display + link in KTS block; manual override field if empty.
- **Do not** add `kts_patient_id` to correction insert path — corrections are logistics, not patient identity.

### Hybrid that is acceptable

- **Display** may *suggest* client’s current ID when trip field is empty (preview before save).
- **Persist** only on Trip aktualisieren or explicit “übernehmen” — never auto-persist live client reads on render.

---

## Gaps for PR2.3 / Module B

1. Schema: add `clients.external_patient_id` (or agreed name) + `trips.kts_patient_id`.
2. `ClientForm` section for patient ID + validation (likely single text field, not reference_fields).
3. Trip detail KTS block: read-only / override display + profile link.
4. `buildKtsPatchFromDrafts` + `normalizeKtsPatch` extension + tests (currently untested).
5. CSV import (PR4): match on `trips.kts_patient_id` snapshot, not live client join.
6. Regenerate `database.types.ts` after migration.

---

## Related documents

- [`docs/plans/kts-module-b-audit.md`](kts-module-b-audit.md)
- [`docs/plans/kts-module-a-architecture-audit.md`](kts-module-a-architecture-audit.md)
- [`docs/kts-architecture.md`](../kts-architecture.md)
- [`docs/trip-client-linking.md`](../trip-client-linking.md)
- [`docs/kundennummer-system.md`](../kundennummer-system.md)
