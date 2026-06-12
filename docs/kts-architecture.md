# KTS (Krankentransportschein) — architecture

**Last updated:** 2026-05-14

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

Copy `kts_document_applies`, `kts_fehler`, `kts_fehler_beschreibung`, and `kts_source` together with other billing metadata (`duplicate-trips.ts`, `build-return-trip-insert.ts`). **Convention (V1):** when the flag is copied from another trip without re-running the resolver, set `kts_source = 'manual'` so it is obvious the value was not freshly resolved from the catalog (see plan notes if you later introduce a dedicated `duplicated` value).

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
| `buildKtsPatchFromDrafts` | Detail-sheet diff vs current `trip` row |
| `updateTripKts` | `normalizeKtsPatch` → `tripsService.updateTrip` |

**Hook:** [`use-update-kts-mutation.ts`](../src/features/kts/hooks/use-update-kts-mutation.ts) — inline Fahrten table KTS cells.

**Consumers:** `kts-cells.tsx`, `build-trip-details-patch.ts`, `paired-trip-sync.ts` (partner leg snapshot via `normalizeKtsPatch`).

### `normalizeKtsPatch` cascade rules (canonical)

1. **`kts_document_applies: false`** (key present) → set `kts_fehler: false`, `kts_fehler_beschreibung: null` — **does not** clear `kts_patient_id` (PR4 CSV stability).
2. **`kts_fehler: false`** (key present) → set `kts_fehler_beschreibung: null`.
3. **`kts_document_applies: true`** (key present) and **`kts_source` absent** from input patch → set `kts_source: 'manual'`.
4. **`kts_fehler_beschreibung` present** → trim whitespace; empty string → `null`.
5. **`kts_patient_id` present** → trim whitespace; empty string → `null`.

Copy/insert paths (Neue Fahrt submit, duplicate, Rückfahrt, recurring cron, bulk CSV) are **out of scope for PR1**; see [`docs/plans/kts-pr1-deferred-paths-audit.md`](plans/kts-pr1-deferred-paths-audit.md).

---

## 7.2 Module A–C roadmap (multi-PR)

Architecture: **Option 1** — KTS flags stay on `trips`; new tables are satellites. See [`docs/plans/kts-module-a-architecture-audit.md`](plans/kts-module-a-architecture-audit.md).

| PR | Scope |
| -- | ----- |
| **PR1** (shipped) | `kts.service.ts` — unify edit-path writes; no schema |
| **PR2** (schema shipped) | `kts_corrections` table + RLS + `trip_kts_correction_summaries` RPC — migration `20260610120000_kts_corrections.sql` |
| **PR2.1** (shipped) | `kts.service.ts` — `fetchTripCorrections`, `insertKtsCorrection`, `closeKtsCorrection`; hook `use-kts-corrections.ts` |
| **PR2.2** (shipped) | Trip detail — `KtsCorrectionTimeline`, `KtsCorrectionForm` (`kts_fehler` gate) |
| **PR3** (shipped) | `kts_patient_id` on `clients` + `trips` — master + snapshot; `ClientForm` + trip detail UI; migration `20260610130000_kts_patient_id.sql` |
| **PR4** (next) | `kts_external_invoices` + `kts_external_invoice_trips` — external Beleg recording, CSV matching on `trips.kts_patient_id` |
| **Deferred** | Accountant gate — block handoff while open correction round exists |
| **PR5** | Bank CSV reconciliation against external invoice numbers |
| **PR6** (future) | KTS-Abrechnung dashboard (Korrekturen / Beim Steuerberater / Abgeschlossen) |

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

Bei Schema-Änderungen: `database.types.ts` und ggf. dieses Dokument anpassen.

---

## 10. Code map (folder structure)

| Concern | Location |
| ------- | -------- |
| **KTS write service (PR1)** | `src/features/kts/kts.service.ts` (`normalizeKtsPatch`, `buildKtsPatchFromDrafts`, `updateTripKts`); hook `src/features/kts/hooks/use-update-kts-mutation.ts`; edit consumers: `kts-cells.tsx`, `build-trip-details-patch.ts`, `paired-trip-sync.ts`; insert-payload consumers: `duplicate-trips.ts`, `build-return-trip-insert.ts` (PR1.5: copy-path sanitization) |
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

*Changelog footer: 2026-06-10 — PR1: §7.1 KTS write service, §7.2 Module A–C roadmap, code map + §9 status. 2026-05-14 — Reha-Schein (V1): Abschnitt + Code-Pfad-Hinweise. 2026-04-24 — Section 3: `base_net_price` / `approach_fee_net` + `net_price` combined invariant (Option A Phase 1); 2026-04-04 — Fahrten-Tabelle: Verweis auf Fremdfirma-Spalten und `driver-select-cell` ergänzt (siehe `fremdfirma.md`).*
