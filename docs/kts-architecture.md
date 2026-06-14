# KTS (Krankentransportschein) — architecture

**Last updated:** 2026-06-10 (PR4.1 accountant CSV import UI)

> See [access-control.md](access-control.md) for the full role-based access control architecture.


This document is the **canonical reference** for how Krankentransportschein (KTS) is modeled in TaxiGo Admin: catalog defaults, trip-level flags, CSV, and the boundary to future clearing/review workflows.

**Related:** [Abrechnungsfamilie und Unterart](billing-families-variants.md) (Kostenträger → Familie → Unterart). KTS is an **additional operational layer** on top of that billing classification.

---

## 1. Why KTS is separate from Abrechnung

- **Billing catalog** answers: *who pays and how is the trip categorized for invoicing?* (`payers` → `billing_types` → `billing_variants` → `trips.billing_variant_id`).
- **KTS** answers: *does this trip require a Krankentransportschein and the associated clearing process?*

In practice these diverge: a hospital Kostenträger can still produce a KTS case; a variant may be named “… KTS” while the system needs an explicit, queryable flag for pipelines and reporting.

**V1 principle:** persist an explicit boolean on the trip plus **how it was set** (catalog vs manual). Do **not** infer KTS only from variant `name` / `code`.

---

## 2. Catalog cascade (defaults)

### 2.1 Tri-state semantics

| Level | Storage | “Unset” representation | “Yes” | “No” |
| ----- | ------- | ------------------------ | ----- | ---- |
| **Unterart** | `billing_variants.kts_default` | SQL `NULL` | `true` | `false` |
| **Familie** | `billing_types.behavior_profile.kts_default` | `'unset'` (or key absent → normalize to `'unset'`) | `'yes'` | `'no'` |
| **Kostenträger** | `payers.kts_default` | SQL `NULL` | `true` | `false` |
| **System** | — | — | — | `false` |

**Precedence (most specific wins):** variant → familie (`behavior_profile`) → payer → system default `false`.

### 2.2 Why Unterart is required in V1

Example: under the same Abrechnungsfamilie, variants **„Dialyse · KTS“** and **„Dialyse · Standard“** need different defaults. Only a **variant-level** column can express that without splitting families artificially.

### 2.3 Resolver (single implementation)

Implement **one** pure function used everywhere (Neue Fahrt, Trip-Detail, bulk CSV, recurring generation), e.g.:

`src/features/trips/lib/resolve-kts-default.ts`

**Contract:**

- **Input:** payer row (`kts_default`), family `behavior_profile` (or `undefined` if no family context yet), selected variant or `null` / `undefined`.
- **Output:** `{ value: boolean; source: 'variant' | 'familie' | 'payer' | 'system_default' }`.
- **Rules:**
  - If `variant?.kts_default !== null && variant !== undefined` → use variant boolean (Postgres `NULL` = unset).
  - Else read normalized `behavior_profile.kts_default`; if `'yes'` / `'no'` → use that as **familie** source.
  - Else if `payer.kts_default !== null && payer.kts_default !== undefined` → use payer boolean.
  - Else `value: false`, `source: 'system_default'`.

**Neue Fahrt — nur Kostenträger:** Wenn noch keine Unterart gewählt ist, wird derselbe Resolver mit `variant = undefined` und ohne Familien-`behavior_profile` aufgerufen, sodass **`payers.kts_default`** sofort greift (kein Warten auf Unterart). Sobald eine Unterart gesetzt wird, läuft die volle Kaskade und kann den Kostenträger-Default überschreiben.

**Normalization:** Missing or legacy `behavior_profile` keys must behave like `'unset'` (same idea as [`normalizeBillingTypeBehavior`](../src/features/trips/lib/normalize-billing-type-behavior-profile.ts) for other flags).

**Inline comment standard (resolver file):** One short file-level comment block stating precedence + that all call sites must use this module — avoids drift between CSV and UI.

---

## 3. Trip persistence (V1)

| Column | Type | Purpose |
| ------ | ---- | ------- |
| `kts_document_applies` | `boolean NOT NULL` | Operational flag: this trip is a KTS case for clearing / reporting. |
| `kts_fehler` | `boolean NOT NULL` (default `false`) | Marks that the KTS document for this trip is erroneous (operational / QA). Independent of the catalog cascade; not set by `resolveKtsDefault`. |
| `kts_fehler_beschreibung` | `text` (nullable) | Optional free-text explanation. Persisted as `NULL` whenever `kts_fehler` is false (no stale text). Description may be empty even when `kts_fehler` is true. |
| `kts_source` | `varchar` (nullable) | How the flag was set: `variant`, `familie`, `payer`, `manual`, `system_default`. |
| `kts_patient_id` | `text` (nullable) | **PR3:** Snapshot of external patient ID at KTS enable / client link time — stable for PR4 CSV matching; **not cleared** when KTS is turned off. |
| `kts_status` | `kts_status` enum (nullable) | **PR3.1:** Current physical state of the KTS document; `NULL` when `kts_document_applies` is false. See §3.4. |
| `kts_belegnummer` | `text` (nullable) | **PR4:** Rechnungsnummer from accountant CSV — **invoiced**, not Krankenkasse payment ref. See §3.7. |
| `kts_invoice_amount` | `numeric(10,2)` (nullable) | **PR4:** Gesamtpreis **invoiced** to Krankenkasse — not amount **paid** (Flow 3 / PR4.2). |
| `kts_eigenanteil` | `numeric(10,2)` (nullable) | **PR4:** Patient co-payment (Eigenanteil) from accountant CSV. |
| `kts_external_invoice_id` | `uuid` FK (nullable) | **PR4:** Links trip → `kts_external_invoices` import batch. |
| `base_net_price` | `numeric` (nullable) | **Phase 1 (2026-04):** transport net only; backfilled. For KTS, resolver net is €0; aligned with `net_price` / `gross` via `resolveTripPrice`. |
| `approach_fee_net` | `numeric` (nullable) | **Phase 1:** Anfahrt net; KTS and taxameter paths use 0 where the resolver omits Anfahrt. |

*General pricing:* **Phase 2:** `trips.net_price` is a **read-only generated column** — always `COALESCE(base_net_price,0) + COALESCE(approach_fee_net,0)` for dashboards, CSV, and stats. Inserts/updates set **`base_net_price` and `approach_fee_net` only** (see `option-a-schema-split-audit`, migration `20260425120000_net_price_generated.sql`).

- On **save** after catalog-driven prefill: set `kts_source` to the resolver’s `source`.
- If the **user changes** the switch away from the last resolved default, persist `kts_source = 'manual'`.
- **Do not** add `kts_review_status` on `trips` in V1; reserve the concept for V2 (`kts_reviews` table below).

**KTS-Fehler (UI v1):** Edited only in the **trip detail sheet** (not Neue Fahrt). Shown in the Fahrten table and on **Fahrten drucken** / PDF-style cards when `kts_fehler` is true. Neue Fahrt keeps schema defaults (`false` / `null`) and may still persist those via `createTrip` when KTS applies (see create-trip submit normalization).

### 3.0 Patient ID (PR3 — `kts_patient_id`)

| Table | Column | Role |
| ----- | ------ | ---- |
| `clients` | `kts_patient_id` | **Master** — external patient ID from the accountant billing system; edited in **Kundenprofil** (`ClientForm` KTS section). |
| `trips` | `kts_patient_id` | **Snapshot** — copied once when KTS is enabled or a linked client is selected; used for PR4 CSV row matching without live joins. |

**Snapshot rationale:** Same pattern as `client_name` / `client_phone` ([`trip-client-linking.md`](trip-client-linking.md)): the trip row keeps the ID that was valid at the operational moment, even if the client master is edited later.

**UI rules (trip detail, when `kts_document_applies`):**

- **Linked client** (`client_id` set): read-only display of the trip snapshot + link to `/dashboard/clients/{id}` (profile is the edit surface).
- **Name-only trip** (no `client_id`): editable **KTS Patienten-ID** on **Trip aktualisieren**.

**Copy triggers (UI, not on every render):** KTS switch ON (from embedded client when IDs match) and client autosuggest select (when KTS is already ON). `normalizeKtsPatch` does **not** clear `kts_patient_id` when `kts_document_applies` becomes `false`.

Migration: `supabase/migrations/20260610130000_kts_patient_id.sql`.

### 3.1 Recurring rules

Mirror the trip fields on `recurring_rules` (same pattern as `billing_calling_station` / `billing_variant_id` in [billing-families-variants.md](billing-families-variants.md)). Cron copies onto generated trips; admins may override per trip afterward.

### 3.2 Duplicate and Rückfahrt

Copy `kts_document_applies`, `kts_source`, and `kts_patient_id` with other billing metadata (`duplicate-trips.ts`, `build-return-trip-insert.ts`). **Workflow fields reset** via `normalizeKtsInsert`: new rows start at `kts_status = 'ungeprueft'`, `kts_fehler = false` — do **not** inherit source fehler/status (new physical document). **Convention:** set `kts_source = 'manual'` on duplicate when not re-running the resolver.

### 3.3 `kts_corrections` (PR2 — satellite table)

One row per **correction round** per trip (append-only history). Admin sends a KTS document for correction; each round records who it was sent to, when sent, and when the corrected document was received (`received_at` null while the round is open).

| Column | Type | Purpose |
| ------ | ---- | ------- |
| `id` | `uuid` PK | Round id |
| `company_id` | `uuid NOT NULL` FK → `companies` | Tenant scope (`ON DELETE CASCADE`) |
| `trip_id` | `uuid NOT NULL` FK → `trips` | Parent trip (`ON DELETE CASCADE`) |
| `sent_to` | `text NOT NULL` | Recipient (doctor / hospital / institute — free text) |
| `sent_at` | `timestamptz NOT NULL` | When the document was sent for correction |
| `received_at` | `timestamptz` (nullable) | When the corrected document was received; `NULL` = open round |
| `notes` | `text` (nullable) | Optional round notes |
| `created_at` | `timestamptz NOT NULL` | Row insert time |
| `created_by` | `uuid` FK → `auth.users` | Optional audit (`ON DELETE SET NULL`) |

**Indexes:** `trip_id`; `company_id`; `(trip_id, created_at DESC)` — supports latest-round lookups and `trip_kts_correction_summaries`.

**RLS:** `SELECT`, `INSERT`, `UPDATE` where `company_id` matches `accounts.company_id` for `auth.uid()` (same subquery pattern as `billing_pricing_rules`). **No `DELETE` policy** — append-only; rows removed only via cascade from `trips` / `companies`. Table grant: `SELECT`, `INSERT`, `UPDATE` to `authenticated`, `service_role` (no `DELETE`).

Migration: `supabase/migrations/20260610120000_kts_corrections.sql`.

### 3.4 `kts_status` state machine (PR3.1)

**Migration:** `supabase/migrations/20260610140000_kts_status.sql`

Enum `public.kts_status` on `trips` — single source of truth for **where the physical document is now**. `kts_corrections` (§3.3) is the **history** of correction rounds; complementary, not duplicate.

| DB value | UI label (DE) | Meaning |
| -------- | ------------- | ------- |
| `ungeprueft` | Ungeprüft | Paper not yet checked, or returned and awaiting re-check |
| `korrekt` | Korrekt | Checked clean — ready for handover (PR3.3) |
| `fehlerhaft` | Fehlerhaft | Error recorded — not yet sent to issuer |
| `in_korrektur` | In Korrektur | Paper physically with issuer |
| `uebergeben` | Übergeben | Handed to accountant (PR3.3) |
| `abgerechnet` | Abgerechnet | Accountant invoice data stamped via CSV import (PR4) — **invoiced**, not paid |
| `NULL` | — | KTS not applicable (`kts_document_applies = false`) |

**Valid transitions:**

| From | To | Action |
| ---- | -- | ------ |
| KTS enabled | `ungeprueft` | `normalizeKtsPatch` rule A / `normalizeKtsInsert` |
| `ungeprueft` | `korrekt` | `markKtsChecked` |
| `ungeprueft` | `fehlerhaft` | `markKtsFehlerhaft` |
| `korrekt` | `fehlerhaft` | `markKtsFehlerhaft` (re-open) |
| `fehlerhaft` | `ungeprueft` | `clearKtsMistake` (PR3.2 queue) |
| `fehlerhaft` | `in_korrektur` | `sendKtsCorrection` |
| `in_korrektur` | `ungeprueft` | `receiveKtsCorrection` (re-check required) |
| `korrekt` | `uebergeben` | `createKtsHandover` / RPC `create_kts_handover` (PR3.3) |
| eligible trip | `abgerechnet` | RPC `apply_kts_invoice_import` (PR4) — does **not** require `uebergeben` |
| any / KTS off | `NULL` | `kts_document_applies: false` |

**`kts_fehler` sync** (maintained by `normalizeKtsPatch` rule C):

| `kts_status` | `kts_fehler` |
| ------------ | ------------ |
| `fehlerhaft`, `in_korrektur` | `true` |
| `ungeprueft`, `korrekt`, `uebergeben`, `abgerechnet` | `false` |
| `NULL` | `false` |

**ON/OFF:** KTS ON → `ungeprueft` (enable-only patches). KTS OFF → `NULL`.

**Backfill:** never auto-`korrekt` or `uebergeben`. Existing rows: `in_korrektur` if open correction + fehler; else `fehlerhaft` if fehler; else `ungeprueft`.

**PR3.2 dependency:** KTS page filter tabs query `kts_status` (partial index `idx_trips_company_kts_status`).

### 3.6 `kts_handovers` batch records (PR3.3)

**Migration:** `supabase/migrations/20260610160000_kts_handovers.sql`

One row per handover batch to the accountant. Trips reference the batch via `trips.kts_handover_id`.

| Column | Type | Role |
| ------ | ---- | ---- |
| `id` | uuid PK | Handover batch id returned by RPC |
| `company_id` | uuid FK → `companies` | Tenant scope |
| `created_at` | timestamptz | When the batch was created |
| `created_by` | uuid FK → `auth.users` | Admin who created the batch |

**RLS:** `SELECT` + `INSERT` where `company_id` matches `accounts.company_id` for `auth.uid()` (same pattern as `kts_corrections`). **No UPDATE/DELETE** — append-only audit.

**Trip link:** `trips.kts_handover_id` FK → `kts_handovers(id) ON DELETE SET NULL`; partial index `idx_trips_kts_handover_id`.

**RPC:** `create_kts_handover(p_company_id uuid, p_trip_ids uuid[])` — `SECURITY DEFINER`, admin + company guard (`current_user_is_admin()` AND `p_company_id = current_user_company_id()`). Single transaction: validate all trips are `korrekt` with `kts_document_applies = true` → insert handover → update trips to `uebergeben`, set `kts_handover_id`, `kts_fehler = false`.

### 3.7 `kts_external_invoices` + accountant CSV import (PR4)

**Migrations:** `20260610170000_kts_abgerechnet_status.sql`, `20260610171000_kts_external_invoices.sql`, `20260610172000_kts_invoice_import_rpc.sql`

Flow 2 (accountant invoice CSV): admin imports semicolon-delimited CSV from the accountant; system matches rows to trips (client-side in PR4.1), stamps invoice snapshot columns, sets `kts_status = abgerechnet`. **Amounts are invoiced, not paid** — Krankenkasse payment matching is Flow 3 (PR4.2: `versendet`, `bezahlt`, `ruecklaufer`).

#### `kts_external_invoices` table

One row per CSV import run — append-only audit log (same RLS pattern as `kts_handovers`: `SELECT` + `INSERT` via `accounts.company_id`, no UPDATE/DELETE).

| Column | Type | Role |
| ------ | ---- | ---- |
| `id` | uuid PK | Import batch id returned by RPC |
| `company_id` | uuid FK → `companies` | Tenant scope |
| `created_at` | timestamptz | When the import was committed |
| `created_by` | uuid FK → `auth.users` | Admin who ran the import |
| `kts_handover_id` | uuid FK → `kts_handovers` (nullable) | Optional audit hint — not enforced 1:1 |
| `row_count` | integer | Trips actually stamped (excludes skipped already-imported) |
| `source_filename` | text | Original CSV filename for audit |

#### Trip invoice snapshot columns (PR4)

Stamped atomically by `apply_kts_invoice_import` — see §3 trip persistence table for column list. `trips.kts_external_invoice_id` FK links each stamped trip to its import batch. `trips.kts_handover_id` (PR3.3) remains the handover link; import batch may optionally reference the same handover via `kts_external_invoices.kts_handover_id`.

#### RPC: `apply_kts_invoice_import`

```sql
apply_kts_invoice_import(
  p_company_id      uuid,
  p_rows            jsonb,
  p_handover_id     uuid DEFAULT NULL,
  p_source_filename text DEFAULT NULL
) RETURNS uuid
```

Each `p_rows` element: `{ trip_id, belegnummer, invoice_amount, eigenanteil }` — **pre-matched in PR4.1** (Papa Parse + name/ID cascade; see [`docs/plans/pr4-nonclient-name-audit.md`](plans/pr4-nonclient-name-audit.md)).

**Guards:** admin + company; non-empty `p_rows`; optional handover must belong to company.

**Skip-not-fail:** trips with `kts_belegnummer IS NOT NULL` are skipped (NOTICE with ids); import still succeeds.

**Does not require** `kts_status = uebergeben` — admin may invoice trips that were not formally handed over.

**PR4.1.1 (migration `20260610173000`):** `apply_kts_invoice_import` v2 writes back `kts_patient_id` from the CSV Schein-ID when admin approves a match and the trip has no existing patient ID (optional `patient_id` per row; COALESCE never overwrites with null).

**Indexes:** `idx_trips_kts_external_invoice_id`, `idx_trips_company_kts_patient_id` (partial, KTS + patient id). No Berlin-date expression index in PR4 — PR4.1 matches dates in TypeScript; add server-side index if candidate RPC is added later.

#### PR4.1 CSV import UI (shipped)

**Entry:** `src/app/dashboard/kts/kts-header.tsx` — **CSV importieren** opens `KtsCsvImportDialog` (Dialog, not Sheet).

| Layer | Location | Role |
| ----- | -------- | ---- |
| Dialog UI | `kts-csv-import-dialog.tsx` | Multi-step: upload → match preview → commit → summary (mirrors Zahlungsabgleich pattern) |
| Orchestration | `use-kts-csv-import.ts` | Step state, Papa Parse, checkbox selection, RPC commit |
| Hooks / service | `use-kts-invoice-import.ts`, `applyKtsInvoiceImport`, `fetchKtsCandidateTrips` in `kts.service.ts` | Lazy candidate fetch on file select; mutation + invalidation |
| Matching (pure TS) | `kts-csv-import-utils.ts` | `normalizeCsvPatientName`, `parseGermanAmount`, `parseGermanDate`, `matchKtsCsvRows`, `validateKtsAccountantCsvHeaders` |

**Matching cascade (client-side):**

1. **Schein-ID** — `kts_patient_id` + Berlin calendar day of `scheduled_at` vs CSV `Transportdatum`.
2. **Name fallback** — CSV `"Nachname, Vorname …"` normalized via `normalizeCsvPatientName` → compare to `clientDisplayNameFromParts(clients.*)` or `trips.client_name` (see [`docs/plans/pr4-nonclient-name-audit.md`](plans/pr4-nonclient-name-audit.md)).
3. **Already imported** — `kts_belegnummer IS NOT NULL` → skip bucket (aligns with RPC skip-not-fail).

**Preview buckets:** Zugeordnet (pre-checked), Niedrige Konfidenz (unchecked by default — admin opt-in), Nicht zugeordnet (display only), Bereits importiert (display only).

**Candidate fetch:** all `kts_document_applies = true` trips for company with `clients(first_name, last_name)` embed — **no `kts_status` filter** (non-`uebergeben` trips show hint but remain importable).

**Invalid CSV:** wrong headers (bank export, trip export) → loading error sub-state with German message + **Erneut versuchen**.

**Badge:** `abgerechnet` — blue cva variant + filter entry in `src/lib/kts-status.ts` (green reserved for `bezahlt` in PR4.2).

**Next:** PR4.2 (`versendet`, `bezahlt`, `ruecklaufer` + Krankenkasse payment CSV); PR4.3 (manual Unmatched linking, handover dropdown, import history).

### 3.5 KTS processing queue page (PR3.2)

**Route:** `/dashboard/kts` — top-level nav leaf (icon `post`, shortcut `k,s`).

**Purpose:** Speed-first admin queue for checking physical KTS documents against trips. Not a replacement for Fahrten list KTS columns (`kts-cells.tsx` remains until post-PR3.2 cleanup).

| Layer | Location | Role |
| ----- | -------- | ---- |
| Page shell | `src/app/dashboard/kts/page.tsx`, `kts-page-shell.tsx` | `PageContainer scrollable={false}`; `TripsRscRefreshProvider` (KTS rows are trips) |
| KPIs | `kts-kpi-section.tsx` + `use-kts-kpis.ts` | Client `useQuery` → RPC `get_kts_queue_kpis` (migration `20260610150000_kts_queue_kpis.sql`) |
| Listing RSC | `kts-listing-page.tsx` | Supabase query; forced `kts_document_applies = true`; embed `kts_corrections(id, …)` |
| Filters | `kts-filters-bar.tsx` inside listing | URL params `kts_status`, `search`, `overdue`; default `kts_status=ungeprueft` on first visit |
| Table | `kts-table/` fork of `DataTable` | Inline expand (single row); actions via `use-kts-status.ts`; korrekt-only row selection + bulk handover bar (`kts-handover-bulk-bar.tsx`) |

**Product invariants (PR3.2):**

- **Single expand:** `expandedRow: { id, mode } | null` — not a Set; one paper-focused interaction at a time.
- **Send inline:** one field (`sent_to`); `sent_at` defaults server-side in `sendKtsCorrection`; notes stay in trip detail sheet.
- **No default date filter:** queue shows full backlog sorted `scheduled_at ASC` (oldest first) — admin works chronologically, not today-only.
- **Overdue list filter:** two-query pattern (`kts_corrections` → trip ids → `.in('id', …)`); PostgREST embed date filters not used (unreliable).
- **`receiveKtsCorrection`:** RSC embed must include correction `id`; actions cell guards missing open round.

**Badge styling:** [`src/lib/kts-status.ts`](../src/lib/kts-status.ts) (`ktsStatusBadge` cva + `KTS_STATUS_LABELS`).

**Deferred:** mobile card list; remove Fahrten `KtsFehlerSwitchCell`.

---

## 4. Admin UI — catalog

Same mental model as **Verhalten** switches (e.g. Abholadresse sperren):

- **Kostenträger:** optional tri-state control → `payers.kts_default` (`NULL` / true / false). In [`payer-details-sheet.tsx`](../src/features/payers/components/payer-details-sheet.tsx) **immer sichtbar** (eigenes Feld), nicht nur im Modus „Bearbeiten“; Speichern löst sofort `updatePayer` aus. Die angezeigte Zeile wird mit dem TanStack-Cache von [`usePayers`](../src/features/payers/hooks/use-payers.ts) **per `id` gemerged**, damit nach `invalidateQueries` KTS/Name nicht am Klick-Snapshot der Elternliste hängen bleiben.
- **Abrechnungsfamilie:** `kts_default` in `behavior_profile` in [`billing-type-behavior-dialog.tsx`](../src/features/payers/components/billing-type-behavior-dialog.tsx) + Zod + [`BillingTypeBehavior`](../src/features/payers/types/payer.types.ts).
- **Unterart:** tri-state on variant edit UI → `billing_variants.kts_default`.

**Query / Invalidation:** `updatePayer` invalidiert sowohl `['payers']` (Admin-Liste mit `billing_types(count)`) als auch [`referenceKeys.payers()`](../src/query/keys/reference.ts) (schmale Liste für **Neue Fahrt** inkl. `kts_default`). Siehe [src/query/README.md](../src/query/README.md) („Kostenträger: two query keys“).

**Inline comments:** At each save path, one line referencing “cascade: variant overrides familie overrides payer” is enough.

---

## 5. Trip UI — Neue Fahrt / Bearbeiten

- **Control:** single switch **„KTS / Krankentransportschein“** in the Kostenträger / Abrechnung section. **Sichtbar**, sobald ein Kostenträger gewählt ist — auch **ohne** Unterart; die Voreinstellung nutzt dann nur die Kostenträger-Stufe der Kaskade, bis eine Unterart gesetzt wird (dann volle Kaskade).
- **Prefill:** run resolver when payer / Familie / Unterart change (same module as CSV/cron).
- **Hints:** if pre-filled `true`, show inline text by source, e.g. *Voreingestellt aus Unterart: …* / *… aus Abrechnungsfamilie …* / *… aus Kostenträger …*.
- **Override:** switch stays editable. If user turns off a catalog-`true`, show a soft warning that the value was catalog-derived. On save → `kts_source = 'manual'`.
- **Manual on:** if resolver said `false` and user enables KTS → `kts_source = 'manual'`.
- **Billing change:** when payer/Familie/Unterart changes, re-run resolver **unless** the user has already manually overridden the KTS switch for this editing session (track with local “KTS dirty” state).
- **Fahrten-Liste (`/dashboard/trips`):** Spalte **KTS** in der Tabellenansicht (`kts_document_applies`); bei `true` ein **KTS**-Badge (gleiche Optik wie im Rechnungs-Builder). Schmale Viewports: dasselbe Badge in der Kartenliste neben dem Status.

---

## Reha-Schein (V1)

**Separate from KTS.** Reha-Schein is a simple operational flag per trip (`trips.reha_schein`), not part of the KTS resolver or catalog cascade.

| Storage | Purpose |
| ------- | ------- |
| `payers.reha_schein_enabled` | Kostenträger gate: nur wenn `true`, zeigen Neue Fahrt und Trip-Detail den Schalter für diese Fahrt. |
| `trips.reha_schein` | Persistierte Fahrt-Stellung (`false` wenn kein Gate oder beim Speichern normalisiert). |
| `recurring_rules.reha_schein` | Spiegelt wie bei KTS-Flags: beim Cron-Lauf wird der Wert auf generierte Fahrten übernommen. **Stand V1:** In der Admin-UI für Regelfahrten gibt es noch **keinen** eigenen Edit für dieses Feld — neue Regeln bleiben ohne UI-Eingabe bei `false`, bis nachgereicht. |

### UI surfaces

- **Kostenträger:** eigener Toggle im Kostenträger-Detailpanel (Analogon zu Manuelle KM: eigener Patch + Invalidation für `referenceKeys.payers()`, nicht nur `updatePayer`).
- **Neue Fahrt / Trip-Detail:** Schalter unter der KTS-Gruppe nur bei gewähltem Kostenträger mit Gate. Wechsel des Kostenträgers setzt das Draft wie bei Neue Fahrt zurück (`false`; Rückwahl des gespeicherten Kostenträgers lädt wieder den DB-Zustand).

### Verknüpfte Hin-/Rückfahrt (`linked_trip_id`)

`reha_schein` liegt in `PAIRED_SYNC_COLUMN_KEYS`; bei „Trip aktualisieren“ mit **Diese Fahrt + Gegenfahrt** wird der gleiche Gespeicherte Wert wie für Kunde/Route auf das Partnerbein geschrieben (kein eigener Produkt-Lease-Swap wie bei Adressen).

### Propagation (Code-Pfade)

- Duplikat: `copyRouteAndPassengerFields` in `duplicate-trips.ts`
- Rückfahrt: `buildReturnTripInsert` (übernahme vom Outbound wie KTS-Felder)
- Regelfahrten-Cron: `buildTripPayload` in `generate-recurring-trips/route.ts`

### Nicht-Ziele (V1)

- Kein Fehler-Boolean / Freitext analog `kts_fehler`
- Keine Preislogik / Invoice-Hooks
- Keine CSV-/PDF-/Export-Spalte und keine eigene Clearing-Liste

---

## 6. CSV import

Optional Spalten **`kts_document_applies`**, **`kts`**, **`kts_document`** (gleiche Semantik). Werte: u. a. `true`/`false`, `1`/`0`, `ja`/`nein`, `yes`/`no`. Leer/fehlend → nach Abrechnungsauflösung `resolveKtsDefault()`; gesetzt → expliziter Wert und `kts_source = 'manual'`. Ungültige Zellen → `invalid_kts_cell`, Zeile wird nicht importiert. Wenn die Unterart erst im Wizard nachgetragen wird, wird KTS dort erneut aus der Kaskade berechnet (siehe `resolve-billing-variants-step.tsx`).

Vollständige Kopfzeile und Spaltenbeschreibung: [bulk-trip-upload.md](bulk-trip-upload.md).

---

## 7. Invoicing (V1)

**Soft warning only:** In Schritt **Positionen prüfen** ([`step-3-line-items.tsx`](../src/features/invoices/components/invoice-builder/step-3-line-items.tsx)): Hinweis-Banner, wenn mindestens eine Position `kts_document_applies` hat, plus **KTS**-Badge pro Zeile. **No hard block** in V1.

**V2 direction:** optional exclusion from standard invoice batch generation and a dedicated clearing queue (product decision).

---

## 7.1 KTS write service (PR1)

**Location:** [`src/features/kts/kts.service.ts`](../src/features/kts/kts.service.ts)

All **edit** paths for trip-level KTS columns delegate to this module. Catalog defaults remain in [`resolve-kts-default.ts`](../src/features/trips/lib/resolve-kts-default.ts).

| Export | Role |
| ------ | ---- |
| `normalizeKtsPatch` | Pure cascade normalizer (canonical rules below) |
| `normalizeKtsInsert` | New trip inserts — reset workflow to `ungeprueft`, preserve catalog/identity fields |
| `buildKtsPatchFromDrafts` | Detail-sheet diff vs current `trip` row |
| `updateTripKts` | `normalizeKtsPatch` → `tripsService.updateTrip` |
| `markKtsChecked` | Transition → `korrekt` |
| `markKtsFehlerhaft` | Transition → `fehlerhaft` + beschreibung |
| `clearKtsMistake` | Transition → `ungeprueft` (false-positive clear) |
| `sendKtsCorrection` | Insert correction round + → `in_korrektur` |
| `receiveKtsCorrection` | Close round + → `ungeprueft` |
| `createKtsHandover` | PR3.3 batch handover RPC wrapper |
| `KTS_OVERDUE_DAYS` | Constant `10` — KPI RPC + overdue list filter |

**Hooks:** [`use-update-kts-mutation.ts`](../src/features/kts/hooks/use-update-kts-mutation.ts) — inline Fahrten table KTS cells. [`use-kts-status.ts`](../src/features/kts/hooks/use-kts-status.ts) — status transition mutations + `useCreateKtsHandoverMutation` (KTS queue). [`use-kts-kpis.ts`](../src/features/kts/hooks/use-kts-kpis.ts) — stat card counts.

**Consumers:** `kts-cells.tsx`, `build-trip-details-patch.ts`, `paired-trip-sync.ts` (partner leg via `normalizeKtsPatch`).

### `normalizeKtsPatch` cascade rules (canonical)

1. **`kts_document_applies: false`** (key present) → set `kts_fehler: false`, `kts_fehler_beschreibung: null` — **does not** clear `kts_patient_id` (PR4 CSV stability).
2. **`kts_fehler: false`** (key present) → set `kts_fehler_beschreibung: null`.
3. **`kts_document_applies: true`** (key present) and **`kts_source` absent** from input patch → set `kts_source: 'manual'`.
4. **`kts_fehler_beschreibung` present** → trim whitespace; empty string → `null`.
5. **`kts_patient_id` present** → trim whitespace; empty string → `null`.
6. **Rule B — KTS OFF** → `kts_status: null`.
7. **Rule A — KTS enable-only** → `kts_status: 'ungeprueft'` (patch has `kts_document_applies: true` without `kts_status`, `kts_fehler`, or `kts_fehler_beschreibung` keys).
8. **Rule C — status in patch** → sync `kts_fehler` from status.
9. **Rule D — `kts_status: null`** → clear fehler + beschreibung.

Insert paths use `normalizeKtsInsert` (Neue Fahrt, duplicate, Rückfahrt, recurring cron, bulk CSV).

---

## 7.2 Module A–C roadmap (multi-PR)

Architecture: **Option 1** — KTS flags stay on `trips`; new tables are satellites. See [`docs/plans/kts-module-a-architecture-audit.md`](plans/kts-module-a-architecture-audit.md).

| PR | Scope |
| -- | ----- |
| **PR1** (shipped) | `kts.service.ts` — unify edit-path writes; no schema |
| **PR2** (schema shipped) | `kts_corrections` table + RLS + `trip_kts_correction_summaries` RPC — migration `20260610120000_kts_corrections.sql` |
| **PR2.1** (shipped) | `kts.service.ts` — `fetchTripCorrections`, `insertKtsCorrection`, `closeKtsCorrection`; hook `use-kts-corrections.ts` |
| **PR2.2** (shipped) | Trip detail — `KtsCorrectionTimeline`, `KtsCorrectionForm` (`kts_fehler` gate) |
| **PR3** (shipped) | `kts_patient_id` on `clients` + `trips` — migration `20260610130000_kts_patient_id.sql` |
| **PR3.1** (shipped) | `kts_status` enum + state machine — migration `20260610140000_kts_status.sql`; transition functions + `use-kts-status.ts` |
| **PR3.2** (shipped) | KTS queue page `/dashboard/kts` — RPC `get_kts_queue_kpis`, RSC listing, expand table, filters — migration `20260610150000_kts_queue_kpis.sql` |
| **PR3.3** (shipped) | `kts_handovers` batch handover → `uebergeben` — migration `20260610160000_kts_handovers.sql`; korrekt-only selection + bulk bar |
| **PR4** (shipped schema) | `abgerechnet` enum + `kts_external_invoices` + trip invoice columns + RPC `apply_kts_invoice_import` — migrations `20260610170000`–`20260610172000` |
| **PR4.1** (shipped) | CSV import Dialog + client-side matching + `applyKtsInvoiceImport` + `abgerechnet` badge/filter — see §3.7 |
| **PR4.2** (next) | `versendet`, `bezahlt`, `ruecklaufer` enum values + Krankenkasse payment CSV (Flow 3) |
| **PR4.3** (after PR4.2) | Manual Unmatched linking, handover dropdown in import dialog, import history view |
| **Deferred** | Accountant gate — block handoff while open correction round exists |
| **PR5** | Bank CSV reconciliation against external invoice numbers |
| **PR6** (future) | Extended KTS-Abrechnung dashboard metrics |

`kts_reviews` (§8) remains the append-only **workflow status** history; `kts_corrections` (PR2) tracks **per-round logistics** — complementary, not duplicate.

---

## 7.3 Deferred / security backlog

**Why:** `SECURITY DEFINER` RPCs in this project intentionally bypass RLS for aggregation performance; tenant isolation must be enforced **inside the function** (e.g. `current_user_company_id()` + `JOIN trips`), not assumed from caller-supplied UUIDs.

| ID | Item | Status | Reference |
| -- | ---- | ------ | --------- |
| **KTS-SEC-01** | `trip_kts_correction_summaries` — in-function tenant guard (`JOIN trips` + `company_id`) | **RESOLVED** (2026-06-10) | [`docs/plans/kts-rpc-tenant-guard-deferred.md`](plans/kts-rpc-tenant-guard-deferred.md); migration `20260610125000_kts_rpc_tenant_guard.sql` |

---

## 8. V2 roadmap — review pipeline (do not build in V1)

### 8.1 Lifecycle (conceptual)

States such as: Fehlerhaft → In Korrektur → Korrigiert → Abgegeben → Bezahlt, with possible loops when a Schein is still wrong after correction.

### 8.2 `kts_reviews` (append-only)

- One row per transition; **never update** rows — current status = latest by `created_at`.
- Columns (conceptual): `trip_id`, `status`, `previous_status`, `notes`, `created_by` (nullable FK to your staff user table when available), `created_by_label` (free text until clearing has logins), `created_at`.

Align `created_by` with the project’s real user/profile table when implementing.

### 8.3 UI

Collapsible **KTS-Status** on trip detail when `kts_document_applies = true`: badge + timeline + “Status ändern” modal.

---

## 9. Implementation status (V1)

Die Liste in der ursprünglichen Reihenfolge ist umgesetzt (Migration, Resolver, Katalog-UI, Trip anlegen/bearbeiten, Duplikat/Rückfahrt, Regeln + Cron, CSV, Rechnungs-Hinweise, **Fahrten-Dashboard-Liste** mit KTS-Spalte/Badge). Ergänzend: **Reha-Schein** (Kostenträger-Gate, Trip-Flag, Cron-Spiegelung, keine Regelfahrten-Formular-Spalte in V1) — Abschnitt *Reha-Schein (V1)*.

**PR1 (2026-06):** KTS write service layer — [`kts.service.ts`](../src/features/kts/kts.service.ts) + inline mutation hook; edit paths unified (§7.1). Schema unchanged.

**PR2 (2026-06):** `kts_corrections` satellite table + RLS + summary RPC `trip_kts_correction_summaries` (§3.3). Application CRUD/UI deferred to PR2.1 / PR2.2.

**PR2.1 (2026-06):** correction CRUD in `kts.service.ts` + `useTripCorrections` / insert / close mutations.

**PR2.2 (2026-06):** correction timeline + inline form in trip detail sheet (`kts_fehler` gate).

**PR3 (2026-06):** `kts_patient_id` on `clients` (master) and `trips` (snapshot); `ClientForm` KTS section; trip detail auto-copy on KTS ON / client select; `buildKtsPatchFromDrafts` extension (§3.0).

**PR3.1 (2026-06):** `kts_status` enum on `trips` (§3.4); migration `20260610140000_kts_status.sql`; transition functions; `normalizeKtsInsert` on all create paths; hooks `use-kts-status.ts`.

**PR3.2 (2026-06):** KTS processing queue `/dashboard/kts` (§3.5); migration `20260610150000_kts_queue_kpis.sql`; `clearKtsMistake`; `src/lib/kts-status.ts`; expand table + filters.

**PR3.3 (2026-06):** `kts_handovers` batch handover (§3.6); migration `20260610160000_kts_handovers.sql`; RPC `create_kts_handover`; korrekt-only selection + bulk bar.

**PR4 (2026-06):** Accountant CSV import schema (§3.7): `abgerechnet` enum; `kts_external_invoices` table; trip columns `kts_belegnummer`, `kts_invoice_amount`, `kts_eigenanteil`, `kts_external_invoice_id`; RPC `apply_kts_invoice_import`. Migrations `20260610170000_kts_abgerechnet_status.sql`, `20260610171000_kts_external_invoices.sql`, `20260610172000_kts_invoice_import_rpc.sql`.

**PR4.1 (2026-06):** Accountant CSV import UI (§3.7): Dialog in `kts-header.tsx`; `kts-csv-import-dialog.tsx`, `use-kts-csv-import.ts`, `use-kts-invoice-import.ts`, `kts-csv-import-utils.ts`; `applyKtsInvoiceImport` + `fetchKtsCandidateTrips` in `kts.service.ts`; full `abgerechnet` badge/filter in `kts-status.ts`.

Bei Schema-Änderungen: `database.types.ts` und ggf. dieses Dokument anpassen.

---

## 10. Code map (folder structure)

| Concern | Location |
| ------- | -------- |
| **KTS write service (PR1 + PR3.1)** | `src/features/kts/kts.service.ts` — `normalizeKtsPatch`, `normalizeKtsInsert`, `buildKtsPatchFromDrafts`, `updateTripKts`, transition functions; hooks `use-update-kts-mutation.ts`, `use-kts-status.ts`; edit consumers: `kts-cells.tsx`, `build-trip-details-patch.ts`, `paired-trip-sync.ts`; insert: `duplicate-trips.ts`, `build-return-trip-insert.ts`, `recurring-trip-generator.ts`, `create-trip-form.tsx`, `bulk-upload-dialog.tsx` |
| **KTS status enum (PR3.1)** | Migration `20260610140000_kts_status.sql`; query key `tripKeys.ktsStatus(tripId)` |
| **KTS queue page (PR3.2)** | Route `src/app/dashboard/kts/`; `kts-listing-page.tsx`, `kts-filters-bar.tsx`, `kts-kpi-section.tsx`, `kts-table/*`; RPC `get_kts_queue_kpis`; hooks `use-kts-kpis.ts`; badges `src/lib/kts-status.ts`; URL params `kts_status`, `overdue` in `searchparams.ts` |
| **KTS accountant CSV import (PR4.1)** | `kts-csv-import-dialog.tsx`, `use-kts-csv-import.ts`, `use-kts-invoice-import.ts`, `kts-csv-import-utils.ts`; header button `kts-header.tsx`; service `applyKtsInvoiceImport`, `fetchKtsCandidateTrips` in `kts.service.ts` |
| **KTS corrections (PR2 schema + PR2.1 CRUD + PR2.2 UI)** | Table `public.kts_corrections` (§3.3); RPC `trip_kts_correction_summaries(p_trip_ids uuid[])` → `trip_id`, `correction_count`, `latest_sent_to`, `latest_sent_at`, `latest_received_at` (list badges — PR2.1.1). Service: `fetchTripCorrections`, `insertKtsCorrection`, `closeKtsCorrection` in `src/features/kts/kts.service.ts`. Hooks: `useTripCorrections`, `useInsertKtsCorrectionMutation`, `useCloseKtsCorrectionMutation` in `src/features/kts/hooks/use-kts-corrections.ts`. Key: `tripKeys.ktsCorrections(tripId)`. UI (PR2.2): `kts-correction-timeline.tsx`, `kts-correction-form.tsx`; wired from `trip-detail-sheet.tsx` when `kts_fehler` draft is true |
| Resolver | `src/features/trips/lib/resolve-kts-default.ts` |
| Behavior JSON + dialog | `src/features/payers/components/billing-type-behavior-dialog.tsx`, `src/features/payers/types/payer.types.ts` |
| Trip create | `src/features/trips/components/create-trip/*` |
| Trip detail | `src/features/trips/trip-detail-sheet/*` |
| Hin/Rück PATCH-Spiegel (Reha inkl.) | `src/features/trips/trip-detail-sheet/lib/paired-trip-sync.ts` |
| Reha Kostenträger-Toggle | `src/features/payers/components/payer-details-sheet.tsx`, `src/features/payers/api/payers.service.ts` (`updatePayerRehaScheinEnabled`) |
| Fahrten-Liste (Tabelle + Mobil) | `src/features/trips/components/trips-tables/columns.tsx` (u. a. **KTS**, **Fremdfirma**, **Abrechnung Fremdfirma**), `driver-select-cell.tsx`, `trips-mobile-card-list.tsx` — Fremdfirma-Spalten nur Desktop; Details [fremdfirma.md](fremdfirma.md) |
| Fahrten list `?sort=` | `src/features/trips/trips-sort-map.ts` |
| Bulk import | `src/features/trips/components/bulk-upload-dialog.tsx`, `bulk-upload/resolve-billing-variants-step.tsx` |
| Recurring cron | `src/app/api/cron/generate-recurring-trips/route.ts` |
| Fahrten-CSV-Export (optional Spalte) | `src/features/trips/components/csv-export/csv-export-constants.ts`, `src/app/api/trips/export/route.ts` — Spalte `kts_document_applies` |
| Rechnung Builder Schritt 3 | `src/features/invoices/api/invoice-line-items.api.ts` (Fetch `kts_document_applies`), `step-3-line-items.tsx` |

Add **short** comments at resolver entry points and where `kts_source` is assigned; avoid duplicating this full document in code.

---

*Changelog footer: 2026-06-10 — PR4.1: CSV import Dialog, matching utils, abgerechnet badge. PR4: §3.7 `kts_external_invoices`, `abgerechnet`, `apply_kts_invoice_import`. PR3.3: §3.6 handover. PR3.2: §3.5 queue. PR3.1: `kts_status`. PR1: §7.1 KTS write service.*
