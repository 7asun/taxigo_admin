# KTS (Krankentransportschein) — architecture

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
| `kts_source` | `varchar` (nullable) | How the flag was set: `variant`, `familie`, `payer`, `manual`, `system_default`. |

- On **save** after catalog-driven prefill: set `kts_source` to the resolver’s `source`.
- If the **user changes** the switch away from the last resolved default, persist `kts_source = 'manual'`.
- **Do not** add `kts_review_status` on `trips` in V1; reserve the concept for V2 (`kts_reviews` table below).

### 3.1 Recurring rules

Mirror the trip fields on `recurring_rules` (same pattern as `billing_calling_station` / `billing_variant_id` in [billing-families-variants.md](billing-families-variants.md)). Cron copies onto generated trips; admins may override per trip afterward.

### 3.2 Duplicate and Rückfahrt

Copy `kts_document_applies` and `kts_source` together with other billing metadata (`duplicate-trips.ts`, `build-return-trip-insert.ts`). **Convention (V1):** when the flag is copied from another trip without re-running the resolver, set `kts_source = 'manual'` so it is obvious the value was not freshly resolved from the catalog (see plan notes if you later introduce a dedicated `duplicated` value).

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

## 6. CSV import

Optional Spalten **`kts_document_applies`**, **`kts`**, **`kts_document`** (gleiche Semantik). Werte: u. a. `true`/`false`, `1`/`0`, `ja`/`nein`, `yes`/`no`. Leer/fehlend → nach Abrechnungsauflösung `resolveKtsDefault()`; gesetzt → expliziter Wert und `kts_source = 'manual'`. Ungültige Zellen → `invalid_kts_cell`, Zeile wird nicht importiert. Wenn die Unterart erst im Wizard nachgetragen wird, wird KTS dort erneut aus der Kaskade berechnet (siehe `resolve-billing-variants-step.tsx`).

Vollständige Kopfzeile und Spaltenbeschreibung: [bulk-trip-upload.md](bulk-trip-upload.md).

---

## 7. Invoicing (V1)

**Soft warning only:** In Schritt **Positionen prüfen** ([`step-3-line-items.tsx`](../src/features/invoices/components/invoice-builder/step-3-line-items.tsx)): Hinweis-Banner, wenn mindestens eine Position `kts_document_applies` hat, plus **KTS**-Badge pro Zeile. **No hard block** in V1.

**V2 direction:** optional exclusion from standard invoice batch generation and a dedicated clearing queue (product decision).

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

Die Liste in der ursprünglichen Reihenfolge ist umgesetzt (Migration, Resolver, Katalog-UI, Trip anlegen/bearbeiten, Duplikat/Rückfahrt, Regeln + Cron, CSV, Rechnungs-Hinweise, **Fahrten-Dashboard-Liste** mit KTS-Spalte/Badge). Bei Schema-Änderungen: `database.types.ts` und ggf. dieses Dokument anpassen.

---

## 10. Code map (folder structure)

| Concern | Location |
| ------- | -------- |
| Resolver | `src/features/trips/lib/resolve-kts-default.ts` |
| Behavior JSON + dialog | `src/features/payers/components/billing-type-behavior-dialog.tsx`, `src/features/payers/types/payer.types.ts` |
| Trip create | `src/features/trips/components/create-trip/*` |
| Trip detail | `src/features/trips/trip-detail-sheet/*` |
| Fahrten-Liste (Tabelle + Mobil) | `src/features/trips/components/trips-tables/columns.tsx` (u. a. **KTS**, **Fremdfirma**, **Abrechnung Fremdfirma**), `driver-select-cell.tsx`, `trips-mobile-card-list.tsx` — Fremdfirma-Spalten nur Desktop; Details [fremdfirma.md](fremdfirma.md) |
| Bulk import | `src/features/trips/components/bulk-upload-dialog.tsx`, `bulk-upload/resolve-billing-variants-step.tsx` |
| Recurring cron | `src/app/api/cron/generate-recurring-trips/route.ts` |
| Fahrten-CSV-Export (optional Spalte) | `src/features/trips/components/csv-export/csv-export-constants.ts`, `src/app/api/trips/export/route.ts` — Spalte `kts_document_applies` |
| Rechnung Builder Schritt 3 | `src/features/invoices/api/invoice-line-items.api.ts` (Fetch `kts_document_applies`), `step-3-line-items.tsx` |

Add **short** comments at resolver entry points and where `kts_source` is assigned; avoid duplicating this full document in code.

---

*Last updated: 2026-04-04 — Fahrten-Tabelle: Verweis auf Fremdfirma-Spalten und `driver-select-cell` ergänzt (siehe `fremdfirma.md`).*
