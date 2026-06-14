# Client duplicate merge audit — Röller case

**Date:** 2026-06-14  
**Scope:** Read-only audit of client/trip schema, constraints, app write paths, and duplicate-handling logic. No code or schema changes.  
**Trigger:** Two `clients` rows in production share `last_name = 'Röller'`; one has a blank `first_name`, the other has `first_name = 'Uwe'`.

**Sources read:**

- Docs: `clients.md`, `trip-client-linking.md`, `bulk-upload-behavior-rules.md`, `bulk-trip-upload.md`, `client-price-tags.md`, `access-control.md`, `invoices-module.md` (§1.4), `docs/plans/pr4-nonclient-name-audit.md`, `docs/plans/reporting-audit.md`
- Migrations: all `supabase/migrations/*client*`, `20260412120000_backfill_trip_client_ids.sql`, `20260409170000_add_missing_rls.sql`, `20260412140000_client_price_tags.sql`, `20260505180000_manual_km_overrides_foundation.sql`, `20260331120000_create_invoices.sql`, `05-kundennummer-system.sql`
- App: `clients.service.ts`, `client-form.tsx`, `client-display-name.ts`, `match-client.ts`, `resolve-client-by-name.ts`, `trips.service.ts`, `build-trip-details-patch.ts`, `resolve-clients-step.tsx`, `bulk-upload-dialog.tsx`, `create-trip-form.tsx`
- Live DB (Supabase project `etwluibddvljuhkxjkxs`): FK delete rules, `clients`/`trips` columns, Röller row sample

---

## Executive summary

| Question | Answer |
| -------- | ------ |
| Exact identity columns? | `clients`: `id`, `company_id`, `first_name`, `last_name`, `company_name`, `is_company`, `phone`, `kts_patient_id`, `customer_number`, address fields, etc. Trips link via **`trips.client_id`** (nullable FK); display via **`trips.client_name`** / **`trips.client_phone`** snapshots. |
| Existing merge workflow? | **None.** No RPC, server action, or UI for “merge clients” or bulk trip reassignment. Trip `client_id` changes go through **`tripsService.updateTrip`** (per row). Client delete is **`clientsService.deleteClient`** (hard `DELETE`). |
| What blocks deleting a client with trips? | **`trips_client_id_fkey`** uses **`ON DELETE NO ACTION`** — Postgres rejects delete while any trip references the row. Same for **`invoices.client_id`**. RLS does **not** block admin delete; FKs do. |
| Safest merge sequence? | Confirm same person → pick canonical row → reassign **`trips`** (and **`recurring_rules`** / **`invoices`** if any) → merge **`client_price_tags`** / **`client_km_overrides`** conflicts → delete duplicate only when no **`NO ACTION`** FKs remain. |
| Blank vs populated first name as duplicates? | **No dedicated dedup.** Name matchers use **different rules**; blank-first + same-last is **not** treated as “same client” unless normalized full name or last+ZIP uniquely matches. |

**Critical finding for Röller:** Production has **two distinct Stammdaten rows** with **different phones** and **different trip name snapshots** (`"Röller"` vs `"Uwe Röller"`). They may be **two people in the same household/PLZ**, not a safe automatic merge. Verify identity before consolidating.

---

## 1. Database structure — client identity

### 1.1 Table `public.clients`

Effective schema from live DB + `database.types.ts` (base `CREATE TABLE` predates tracked migrations).

| Column | Type | Nullable | Role |
| ------ | ---- | -------- | ---- |
| `id` | `uuid` | NO | PK, `gen_random_uuid()` |
| `company_id` | `uuid` | NO | Tenant scope (RLS) |
| `is_company` | `boolean` | NO | `false` for persons; `true` when only `company_name` set |
| `first_name` | `text` | YES | Vorname |
| `last_name` | `text` | YES | Nachname |
| `company_name` | `text` | YES | Firmenname (companies) |
| `phone` | `text` | YES | Primary phone |
| `phone_secondary` | `text` | YES | |
| `email` | `text` | YES | |
| `street`, `street_number`, `zip_code`, `city` | `text` | NO | Required address |
| `lat`, `lng` | `double precision` | YES | Geocoding |
| `customer_number` | `integer` | NO | Unique per `(company_id, customer_number)`; auto via trigger |
| `kts_patient_id` | `text` | YES | KTS SchneidID on Stammdaten |
| `birthdate` | `date` | YES | |
| `is_wheelchair` | `boolean` | NO | Default `false` |
| `greeting_style` | `text` | YES | |
| `relation` | `text` | YES | |
| `notes` | `text` | YES | |
| `reference_fields` | `jsonb` | YES | Bezugszeichen for invoice PDF |
| `price_tag` | `numeric` | YES | Legacy gross; synced with global `client_price_tags` |
| `requires_daily_scheduling` | `boolean` | YES | |
| `stations` | `text[]` | YES | |
| `created_at`, `updated_at` | `timestamptz` | | |

**Constraints (live DB):**

- PK: `clients_pkey` on `id`
- UNIQUE: `clients_customer_number_company_id_key` on `(company_id, customer_number)`
- **No** unique constraint on `(company_id, first_name, last_name)` or name+phone

**Triggers:**

- `ensure_client_number` **BEFORE INSERT** → `assign_client_number()` (from `05-kundennummer-system.sql`)

**RLS** (`20260409170000_add_missing_rls.sql`):

- Policy `clients_company_admin`: **FOR ALL** to `authenticated` when `current_user_is_admin()` and `company_id = current_user_company_id()`
- Drivers have **no** access to `clients`

### 1.2 Trip passenger fields (`public.trips`)

| Column | Type | Nullable | FK / notes |
| ------ | ---- | -------- | ---------- |
| `client_id` | `uuid` | YES | FK → `clients.id`, constraint **`trips_client_id_fkey`**, **`ON DELETE NO ACTION`** |
| `client_name` | `text` | YES | Denormalized display string; **not** FK-enforced |
| `client_phone` | `text` | YES | Snapshot from client or CSV |
| `company_id` | `uuid` | YES | Must match client’s company for tenant consistency |
| `kts_patient_id` | `text` | YES | Trip-level KTS ID (may differ from `clients.kts_patient_id`) |

See `docs/trip-client-linking.md` for the three passenger modes (linked / name-only / anonymous).

**Important:** `invoice_line_items` snapshot passenger names from **`trips.client_name`** at invoice creation; they do **not** hold a `client_id` FK. Reassigning trips does **not** rewrite issued invoices.

---

## 2. All foreign keys → `clients`

From live `information_schema` (project `etwluibddvljuhkxjkxs`):

| Table | Column | Constraint | ON DELETE |
| ----- | ------ | ---------- | --------- |
| `trips` | `client_id` | `trips_client_id_fkey` | **NO ACTION** |
| `invoices` | `client_id` | `invoices_client_id_fkey` | **NO ACTION** |
| `recurring_rules` | `client_id` | `recurring_rules_client_id_fkey` | **CASCADE** |
| `client_price_tags` | `client_id` | `client_price_tags_client_id_fkey` | **CASCADE** |
| `client_km_overrides` | `client_id` | `client_km_overrides_client_id_fkey` | **CASCADE** |

**Implications:**

- **Trips** and **per_client invoices** prevent deleting a client until `client_id` is cleared or moved.
- **Recurring rules**, **price tags**, and **KM overrides** on the deleted row are **removed automatically** on client delete — reassign or merge these **before** delete if the canonical client should keep them.

`recurring_rules.client_id` is **NOT NULL** in types; rules cannot exist without a client row.

---

## 3. Application write paths (create / update / delete / link)

### 3.1 Clients

| Operation | Location | Behavior |
| --------- | -------- | -------- |
| List / search | `src/features/clients/api/clients.service.ts` | `ilike` on `first_name`, `last_name`, `company_name`, email, phones |
| Create | `clientsService.createClient` → `INSERT clients` | Form: `client-form.tsx`; bulk wizard: `resolve-clients-step.tsx` |
| Update | `clientsService.updateClient` → `UPDATE clients` | Same form; no merge logic |
| Delete | `clientsService.deleteClient` → `DELETE clients WHERE id` | `client-detail-panel.tsx`, `cell-action.tsx`; **no** pre-check for trips |

Company detection in form: `is_company = !!company_name && !first_name && !last_name` (`client-form.tsx`). Person rows may have **empty string** `first_name` (not `NULL`) — still stored and affects `concat_ws` normalization (see §6).

### 3.2 Trips ↔ client linking

| Path | Mechanism |
| ---- | --------- |
| Manual create | `create-trip-form.tsx` — sets `client_id` from picker or debounced `resolveClientByName` |
| Trip detail edit | `build-trip-details-patch.ts` — PATCH `client_id`, `client_name`, `client_phone`; may trigger price recalc via `shouldRecalculatePrice` |
| Bulk CSV | `matchClient` then optional `resolveClientByName` (`bulk-upload-dialog.tsx`) |
| Post-upload wizard | `resolve-clients-step.tsx` — **creates new client** and `UPDATE trips SET client_id, client_name, …` |
| SQL backfill | `20260412120000_backfill_trip_client_ids.sql` — one-time + RPC |
| Duplicate / return trips | `duplicate-trips.ts`, `build-return-trip-insert.ts` — **copy** source `client_id` and `client_name` |

**No API route or server action** implements “move all trips from client A to B.”

### 3.3 RPC helper

```sql
resolve_client_id_by_name(p_company_id uuid, p_full_name text) RETURNS uuid
```

- Returns `clients.id` only when **exactly one** row matches normalized  
  `lower(trim(concat_ws(' ', first_name, last_name))) = lower(trim(p_full_name))`  
  within the company.
- Ambiguous or zero matches → `NULL`.
- Granted to `authenticated` and `service_role`.

---

## 4. Existing merge / reassignment workflow

**There is none.**

- No `merge_clients`, `reassign_trips`, or dedup admin UI.
- Trip reassignment is **manual per trip** (detail sheet) or **raw SQL** / script using `UPDATE trips SET client_id = …`.
- Bulk upload wizard only **creates** a new client and links **one** trip at a time — it does not attach trips to an **existing** duplicate.

The closest patterns:

1. **`resolve-clients-step.tsx`** — `UPDATE trips` after `createClient` (single trip).
2. **`20260412120000_backfill_trip_client_ids.sql`** — batch `UPDATE trips SET client_id` by name match (historical, not a merge tool).
3. **`clientsService.deleteClient`** — expects row to be deletable; UI shows Postgres error if FK blocks.

---

## 5. What blocks deleting a client that still has trips?

### 5.1 Postgres foreign keys (hard block)

Deleting a client referenced by `trips.client_id` fails with a **foreign key violation** (`trips_client_id_fkey`, **NO ACTION**).

Same for `invoices.client_id` when set (e.g. `mode = 'per_client'`).

### 5.2 RLS (does not block admin delete)

Admins with `clients_company_admin` may **DELETE** rows in their company. RLS is not the blocker — **FKs are**.

### 5.3 Triggers

Only **`ensure_client_number`** on INSERT. **No** trigger prevents client DELETE or cascades trips.

### 5.4 Application layer

`deleteClient` does not count trips first; the user sees the Supabase/Postgres error message.

---

## 6. Safest sequence to consolidate two duplicate clients

Use only after **human confirmation** that both rows are the same person (see §8 for Röller).

Assume:

- **Canonical** = row to keep (prefer complete `first_name`, richer metadata, lower `customer_number` if immaterial).
- **Duplicate** = row to remove.

### Phase 0 — Discovery (read-only)

```sql
-- Replace UUIDs
SELECT id, first_name, last_name, phone, zip_code, customer_number,
       (SELECT count(*) FROM trips t WHERE t.client_id = c.id) AS trips,
       (SELECT count(*) FROM recurring_rules r WHERE r.client_id = c.id) AS rules,
       (SELECT count(*) FROM invoices i WHERE i.client_id = c.id) AS invoices
FROM clients c
WHERE id IN ('<duplicate_id>', '<canonical_id>');

SELECT id, client_id, client_name, client_phone, scheduled_at, status
FROM trips
WHERE client_id IN ('<duplicate_id>', '<canonical_id>');
```

Check `client_price_tags`, `client_km_overrides` for both IDs.

### Phase 1 — Reassign dependent rows (transaction recommended)

1. **`trips`** — for each trip on duplicate:

   ```sql
   UPDATE trips
   SET client_id = '<canonical_id>',
       client_name = trim(concat_ws(' ', '<canonical_first>', '<canonical_last>')),
       client_phone = COALESCE(client_phone, '<canonical_phone>')
   WHERE client_id = '<duplicate_id>';
   ```

   - Use canonical display name from Stammdaten (`clientDisplayName` / `concat_ws` + `filter(Boolean)` in app terms).
   - If `shouldRecalculatePrice` fields change, consider re-running pricing (app does this on `updateTrip`; raw SQL skips engine).
   - **Do not** change `client_name` on trips already on **issued** invoices if PDF history matters — snapshots on `invoice_line_items` are frozen anyway.

2. **`recurring_rules`** — if duplicate has rules:

   ```sql
   UPDATE recurring_rules SET client_id = '<canonical_id>' WHERE client_id = '<duplicate_id>';
   ```

   Prefer UPDATE over relying on CASCADE + recreate, to preserve rule IDs and cron history.

3. **`invoices`** — if any `per_client` invoice headers point at duplicate:

   ```sql
   UPDATE invoices SET client_id = '<canonical_id>' WHERE client_id = '<duplicate_id>';
   ```

   Only safe for **draft** headers; **sent/paid** invoices are legal snapshots — prefer leaving historical `client_id` or legal review before changing.

4. **`client_price_tags` / `client_km_overrides`** — merge manually:

   - Unique partial indexes: one active global tag per client, one per `(client_id, payer_id)`, one per `(client_id, billing_variant_id)`.
   - If both rows have conflicting scoped tags, **deactivate or re-scope** duplicate’s rows onto canonical **before** delete (delete cascades tags on duplicate row).

5. **Optional canonical enrichment** — copy non-empty fields from duplicate → canonical (`kts_patient_id`, `notes`, `reference_fields`, `birthdate`, secondary phone) via `UPDATE clients`, then fix blank `first_name` (`''` → proper name or `NULL`).

### Phase 2 — Delete duplicate

```sql
DELETE FROM clients WHERE id = '<duplicate_id>';
```

Succeeds only when:

- No `trips.client_id` references duplicate
- No `invoices.client_id` references duplicate
- (`recurring_rules`, tags, overrides CASCADE or already moved)

### Phase 3 — Verify

- Trip counts on canonical match sum of both.
- Fahrgast detail panel / invoice builder `eq('client_id', …)` includes all trips.
- `resolve_client_id_by_name` for full name returns canonical (single match).

### What **not** to do

- Delete duplicate **before** reassigning trips → FK error.
- Assume same `last_name` + same PLZ ⇒ same person (see `matchClient` strategy 3 warning).
- Merge Röller rows without checking phones and trip snapshots (§8).

---

## 7. Duplicate detection in codebase

### 7.1 No client dedup feature

- Client list sorts by `last_name`, `first_name`, `company_name` — **no** duplicate badge or merge action.
- No unique index on name fields.
- `customer_number` is unique per company but unrelated to identity.

### 7.2 Trip-side name resolution (not client dedup)

| Mechanism | Treats blank first + full first as same? | Notes |
| --------- | ---------------------------------------- | ----- |
| `resolve_client_id_by_name` / SQL backfill | **No** | Full normalized name must match exactly. `"Röller"` ≠ `"Uwe Röller"`. |
| `matchClient` strategy 2 (first + last) | **No** | Requires **both** CSV first and last. |
| `matchClient` strategy 3 (last + ZIP) | **Indirectly** | Only when CSV **omits** first name. Matches any client with same last+ZIP; **ambiguous if multiple** → no match. Can link to **blank-first** row if it is the **only** `Röller` at that ZIP. |
| `matchClient` strategy 1 (phone) | **No** | Phone is person-specific; different phones → no match. |
| Create-trip debounced `resolveClientByName` | **No** | Uses full `"Vorname Nachname"` string. |

**Blank `first_name` vs `NULL`:**

- SQL: `concat_ws(' ', NULL, 'Röller')` → `'Röller'`; `concat_ws(' ', '', 'Röller')` → `' Röller'` → trim → `'Röller'`.
- App display: `[first_name, last_name].filter(Boolean)` — **empty string is falsy**, displays as `"Röller"` only from last name.

The codebase does **not** implement “same last name + missing first name ⇒ duplicate of named row.”

### 7.3 Documentation

- `docs/trip-client-linking.md` — ambiguous names leave `client_id` null.
- `docs/bulk-upload-behavior-rules.md` §1.5 — same semantics.
- `match-client.ts` header comment — false positives worse than false negatives; strategy 3 only when CSV has **no** first name.

---

## 8. Production case study — Röller (same company)

Queried live DB 2026-06-14 (`company_id = 8df83726-cd59-4fd0-87df-0bd905915fec`):

| Field | Row A (blank first) | Row B (Uwe) |
| ----- | ------------------- | ----------- |
| `id` | `8ff36b45-579a-478f-9018-0e2aa650b586` | `500c9e65-3a3b-470e-a04a-ba53f0af717e` |
| `first_name` | `''` (empty string) | `Uwe` |
| `last_name` | `Röller` | `Röller` |
| `phone` | `044869198594` | `01752409593` |
| `zip_code` / `city` | `26188` / `Edewecht` | `26188` / `Edewecht` |
| `customer_number` | 10065 | 10074 |
| `kts_patient_id` | null | null |
| Trip count | 2 | 2 |
| Recurring rules | 0 | 0 |
| Invoices (`client_id`) | 0 | 0 |
| Price tags / KM overrides | 0 | 0 |

**Normalized names:**

- Row A: `lower(trim(concat_ws(' ', first_name, last_name)))` → **`röller`**
- Row B: → **`uwe röller`**

**Trips:**

| Trip | `client_id` | `client_name` | `client_phone` |
| ---- | ----------- | ------------- | -------------- |
| `b0cbfc74-…`, `f5004537-…` | Row A | `Röller` | `044869198594` |
| `722c6a54-…`, `72778a61-…` | Row B | `Uwe Röller` | `01752409593` |

### 8.1 Interpretation

- **Different phones** and **different trip name snapshots** strongly suggest **two individuals** (e.g. family members), not a single person entered twice.
- Row A may be a **data-entry artifact** (missing Vorname on Stammdaten) while trips correctly use surname-only display.
- **`matchClient` last+ZIP** could incorrectly prefer Row A for CSV rows with only `lastname=Röller` and `pickup_zip=26188` **if Row B were absent** — with both present, strategy 3 yields **ambiguous** → no auto-link (safe).

### 8.2 If merge is still desired (same person confirmed)

1. Choose canonical — almost certainly **Row B (`Uwe`)** if same person; fill/fix Row A’s missing first name on canonical instead of merging into blank-first row.
2. `UPDATE trips SET client_id = Row B, client_name = 'Uwe Röller', …` for Row A’s two trips **only if** those trips belong to Uwe (verify dates/routes with dispatch).
3. `DELETE` Row A after trip count on A is zero.
4. If trips on A belong to a **different** person, **do not merge** — fix Row A’s `first_name` on Stammdaten instead.

### 8.3 If they are two people (recommended default)

- **Do not merge.**
- Set Row A `first_name` to the correct Vorname (or mark as separate household member).
- Optionally add disambiguation in `notes` or ensure CSV imports include `firstname` to avoid wrong strategy-3 links.

---

## 9. Related docs and files

| Topic | Path |
| ----- | ---- |
| Trip ↔ client model | `docs/trip-client-linking.md` |
| CSV client matching | `docs/bulk-upload-behavior-rules.md`, `src/features/trips/components/bulk-upload/match-client.ts` |
| RPC wrapper | `src/features/trips/lib/resolve-client-by-name.ts` |
| Client CRUD | `src/features/clients/api/clients.service.ts` |
| Trip PATCH | `src/features/trips/api/trips.service.ts`, `build-trip-details-patch.ts` |
| RLS | `docs/access-control.md`, `supabase/migrations/20260409170000_add_missing_rls.sql` |
| Name backfill migration | `supabase/migrations/20260412120000_backfill_trip_client_ids.sql` |
| Client pricing children | `docs/client-price-tags.md`, `docs/clients.md` (KM overrides) |

---

## 10. Gaps / future work (informational only)

Not in scope for this audit, but relevant if product wants safe merges:

1. Admin **“Merge Fahrgäste”** tool: preview trip/rule/invoice counts, transactional reassignment, conflict UI for price tags.
2. **Pre-delete guard** in `deleteClient`: list blocking trips/invoices.
3. **Dedup hint** in client list when `(company_id, lower(last_name), zip_code)` collides with different `first_name` / phone.
4. Normalize **`first_name = ''` → NULL** on save to align SQL `concat_ws` with app `filter(Boolean)`.
