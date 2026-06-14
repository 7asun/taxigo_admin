# PR4 non-client passenger name audit

Read-only audit for PR4 CSV import name fallback (~30% of KTS trips have no `client_id`).
Answers are grounded in current code — no schema or application changes.

**Scope files read:** `database.types.ts`, `create-trip-form.tsx`, `schema.ts`, `create-trip-draft.ts`, `build-return-trip-insert.ts`, `duplicate-trips.ts`, `kts-listing-page.tsx`, `kts-trip-row.ts`, `trip-detail-sheet.tsx`, `trips.service.ts`, `docs/kts-architecture.md`, plus supporting references (`add-passenger-inline.tsx`, `build-trip-details-patch.ts`, `trip-client-linking.md`, `kts-columns.tsx`, `bulk-upload-dialog.tsx`).

---

## Executive summary

| Finding | Impact on PR4 |
| ------- | --------------- |
| `trips.client_name` is `string \| null` — the **only** persisted passenger name on the trip row | Non-client matching must use this field (or `kts_patient_id`) |
| All create/edit UI paths store **`"Vorname Nachname"`** (space-separated), never `"Nachname, Vorname"` | CSV `"Nachname, Vorname …"` must be **parsed and reordered** before comparison — direct string match against `client_name` will fail |
| No `passenger_first_name` / `passenger_last_name` columns on `trips` | Structured names exist only in form state / `PassengerEntry`, not in DB |
| `kts_patient_id` **can** be set on non-client trips via trip detail sheet | Step 1 ID matching covers non-client trips when dispatchers enter the SchneidID |
| Create-trip flow does **not** copy `kts_patient_id` at insert time | Non-client KTS trips often have null ID until someone edits the trip |

**Minimum PR4 intervention:** Keep Step 1 `kts_patient_id` matching; for Step 2 name fallback, normalize CSV `"Nachname, Vorname"` → `"Vorname Nachname"` and compare to `trips.client_name` (and to `concat_ws(' ', clients.first_name, clients.last_name)` when `client_id` is set). Flag ambiguous matches — do **not** assume comma format in `client_name`. Adding DB columns is **not** required for PR4 v1.

---

## 1. `trips.client_name` — exact format and origin

### Database type

From `src/types/database.types.ts` (`trips.Row`):

```typescript
client_name: string | null;
```

Also on `Insert` / `Update` as optional `client_name?: string | null`.

### Origin — not in schema or draft

`schema.ts` and `create-trip-draft.ts` have **no** `client_name` field. The draft stores passengers as `PassengerEntry[]` with separate `first_name` / `last_name`:

```typescript
// create-trip-draft.ts — draft payload only
passengers: z.array(z.any()),
```

Name composition happens at **submit** in `create-trip-form.tsx`, not in the draft helper.

### How `client_name` is set without a linked client

When `requirePassenger` is true (normal passenger mode), each passenger row writes:

```typescript
client_name:
  [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
```

(`create-trip-form.tsx` lines 1548–1550, same pattern for return legs at 1638–1639.)

This is **computed at submit** from two free-text form fields — not a single unstructured “Name” box.

When `requirePassenger` is false (anonymous mode), the trip is created with:

```typescript
client_id: null,
client_name: null,
```

(`create-trip-form.tsx` lines 1389–1390.)

### Format

**Enforced by UI composition, not DB constraint:** `"Vorname Nachname"` with a single ASCII space between trimmed parts. Examples:

- `Waltraud Kunz` (not `Kunz, Waltraud`)
- Company clients may use `first_name` only in Vorname field with empty Nachname → `"Acme"` or `"Maria"`

Documented intent in `docs/trip-client-linking.md`:

> `client_name` — Denormalized display string (**first + last** or CSV text).

Current application code always uses **first + space + last** for manual create, bulk upload, and detail-sheet save (see §4).

---

## 2. Separate first/last name fields on `trips`

### Full `trips.Row` (name-related excerpt)

From `src/types/database.types.ts` lines 1468–1550 — **no** `passenger_first_name`, `passenger_last_name`, `first_name`, `last_name`, `vorname`, or `nachname` on `trips`:

```typescript
trips: {
  Row: {
    // … billing, KTS, route fields …
    client_id: string | null;
    client_name: string | null;
    client_phone: string | null;
    // … no other passenger name columns …
  };
}
```

### `clients.Row` (for contrast)

Structured names live on **`clients`**, not `trips`:

```typescript
clients: {
  Row: {
    first_name: string | null;
    last_name: string | null;
    kts_patient_id: string | null;
    // …
  };
}
```

### Conclusion

For non-client passengers (`client_id IS NULL`), **`client_name` is the only name field** on the trip row. Structured first/last exist only in:

- UI state (`PassengerEntry`, detail-sheet drafts)
- `clients` table when linked

---

## 3. Non-client trip creation flow

### Form fields shown

Passengers are added via `AddPassengerInline` (`add-passenger-inline.tsx`):

- Section title: **"Erster Fahrgast"** (required) or **"Weiterer Fahrgast"**
- **Two separate inputs**, not one “Name” field:
  - Label **"Vorname"** — `ClientAutoSuggest` (free text + optional Stammdaten pick)
  - Label **"Nachname"** — plain `Input`, placeholder `'Nachname'`

```tsx
<Label className={labelClass}>Vorname</Label>
<ClientAutoSuggest … />
…
<Label className={labelClass}>Nachname</Label>
<Input … placeholder='Nachname' />
```

(`add-passenger-inline.tsx` lines 211–234.)

### Without selecting a client

1. Dispatcher types Vorname / Nachname manually.
2. Debounced effect may **silently** set `client_id` if `resolveClientByName(fullName)` finds exactly one Stammdaten match — using normalized `"Vorname Nachname"`:

```typescript
const fullName = [p.first_name, p.last_name]
  .filter(Boolean)
  .join(' ')
  .trim();
const id = await resolveClientByName(fullName, companyId, supabase);
```

(`create-trip-form.tsx` lines 328–337; RPC uses `concat_ws(' ', first_name, last_name)` per `resolve-client-by-name.ts`.)

3. On submit, even when `client_id` stays null:

```typescript
client_id: passengerClientId,  // null for true non-client
client_name:
  [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
```

### What gets written to DB

| Field | Non-client value |
| ----- | ---------------- |
| `client_id` | `null` |
| `client_name` | `"<Vorname> <Nachname>"` or partial if one field empty |
| `client_phone` | from passenger phone field |
| `kts_patient_id` | **not set at create** — `baseTrip` only includes `normalizeKtsInsert({ kts_document_applies, kts_source })` (lines 1306–1309) |

---

## 4. `client_name` for linked clients

When a Stammdaten client is selected, the form still stores **separate** `first_name` / `last_name` on `PassengerEntry` (copied from client on select):

```typescript
setFirstName(client.first_name || '');
setLastName(client.last_name || '');
```

(`add-passenger-inline.tsx` lines 127–128.)

At submit, **same composition** as non-client — snapshot at creation time, not a live join:

```typescript
client_name:
  [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
```

**Separator:** single space (`' '`), **not** comma. Order: **Vorname then Nachname**.

Detail-sheet updates use the same rule via `clientDisplayNameFromParts`:

```typescript
export function clientDisplayNameFromParts(first: string, last: string, company?: string): string {
  const parts = [first, last].map((s) => s.trim()).filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  return company?.trim() || '';
}
```

(`build-trip-details-patch.ts` lines 21–28; persisted in patch at lines 128–133.)

Bulk upload and client-link wizard also use space format:

```typescript
client_name: matchedClient
  ? `${matchedClient.first_name || ''} ${matchedClient.last_name || ''}`.trim() || null
  : fullNameFromCsv,  // `${firstname} ${lastname}`.trim()
```

(`bulk-upload-dialog.tsx` lines 972–976.)

---

## 5. `client_name` in the KTS listing

### Search

`kts-listing-page.tsx` searches snapshot fields:

```typescript
query = query.or(
  `client_name.ilike.%${term}%,kts_patient_id.ilike.%${term}%`
);
```

(lines 81–85.)

### Display — primary passenger column

`kts-columns.tsx` column `client_name` / header **"Fahrgast"**:

```typescript
cell: ({ row }) => {
  const name = row.original.client_name?.trim();
  const fallback = row.original.kts_patient_id?.trim();
  if (name) {
    return <span className='font-medium'>{name}</span>;
  }
  if (fallback) {
    return <span className='text-muted-foreground font-medium'>{fallback}</span>;
  }
  return <span className='text-muted-foreground'>—</span>;
},
```

**Yes:** `client_name` is the primary display name; `kts_patient_id` is fallback when name is empty. There is no `clients` embed in the listing query.

---

## 6. Trip detail sheet — name display and edit

### Display

Sheet title uses composed drafts, falling back to `resolvePassengerLabel(trip)`:

```tsx
{clientDisplayNameFromParts(clientFirstDraft, clientLastDraft)
  || resolvePassengerLabel(trip)}
```

(`trip-detail-sheet.tsx` lines 1156–1159.)

### Loading non-client trip into drafts

When no embedded `clients` row, name is **split on first whitespace run**:

```typescript
const parts = (trip.client_name ?? '').trim().split(/\s+/);
setClientFirstDraft(parts[0] ?? '');
setClientLastDraft(parts.slice(1).join(' ') ?? '');
```

(lines 513–516.) This is **editable** — same Vorname/Nachname inputs as linked trips (lines 1913–1940).

### Save path

Patch uses `clientDisplayNameFromParts` → `client_name` (space-separated). Non-client trips: **`client_name` is directly editable** via the two name fields; there is no read-only gate when `client_id` is null.

### No separate DB columns on save

Edits update `client_name` only — not `clients.first_name` unless the user changes Stammdaten separately.

---

## 7. Name format consistency — assessment

### Is `client_name` stored in a consistent, parseable format?

**Within the app:** Yes — consistently **`Vorname Nachname`** (space-separated) from all known write paths:

| Write path | Format |
| ---------- | ------ |
| Create trip (passenger mode) | `[first_name, last_name].join(' ')` |
| Trip detail save | `clientDisplayNameFromParts` → space join |
| Bulk CSV upload | `"${firstname} ${lastname}".trim()` |
| Duplicate / Rückfahrt | copies existing `client_name` snapshot |

**Versus PR4 accountant CSV Patient field:** **No** — CSV uses `"Nachname, Vorname DOB - Address (SchneidID)"`. The comma order is **not** stored in `client_name`.

### Can `"Kunz, Waltraud"` be extracted from `client_name`?

**Not reliably by comma split.** Stored value is expected to be `"Waltraud Kunz"`. Comma-based parsing of `client_name` would fail for essentially all UI-created rows.

### Data quality risks

1. **Order mismatch** — CSV Nachname-first vs trip Vorname-first → silent non-match if compared literally.
2. **Heuristic split on load** — detail sheet treats first token as Vorname, remainder as Nachname → wrong for particles (`Maria de la Cruz`), swapped entry, or single-field names.
3. **Partial names** — only Vorname or only Nachname allowed at create → incomplete match vs full CSV name.
4. **Legacy / manual SQL** — `trip-client-linking.md` allows “CSV text” in principle; no code path writes comma format today, but ad-hoc data may exist.
5. **Anonymous KTS trips** — `client_name` null when payer does not require passenger; name fallback impossible (ID-only or unmatched).

**Honest verdict:** `client_name` is **structured but not CSV-isomorphic**. Matching requires **normalization**, not raw equality or comma parsing of the trip field.

---

## 8. Recommendation for PR4 name matching

### Should PR4 use `trips.client_name` as-is for non-client passengers?

**Use it with normalization — not as-is.**

Algorithm sketch:

1. Parse CSV Patient → `csv_last`, `csv_first` (before DOB ` - `).
2. Build `csv_full = trim(lower(concat_ws(' ', csv_first, csv_last)))`.
3. For candidate trip with `client_id IS NULL`: `trip_full = trim(lower(client_name))`.
4. Match when `trip_full = csv_full` (exact after normalization) or high-confidence fuzzy variant.
5. For `client_id IS NOT NULL`: prefer `trim(lower(concat_ws(' ', c.first_name, c.last_name)))` via SQL join — same normalization as `resolve_client_id_by_name`.

**Do not** expect `"Kunz, Waltraud"` substring in `client_name`.

### Add `passenger_last_name` / `passenger_first_name` columns now?

**Not required for PR4 v1.** High migration + form surface cost; current UI already captures structured names at entry but drops structure at persist. Consider for a later PR if match rates are insufficient.

### Better approach given the codebase

| Priority | Approach |
| -------- | -------- |
| 1 | **`kts_patient_id` exact match** (SchneidID from CSV parentheses) — primary |
| 2 | **Normalized full-name match** — CSV reorder + compare to `client_name` or joined `clients` names |
| 3 | **Manual review bucket** for single candidate fuzzy / date-only collisions |
| 4 | **Optional post-PR4** — backfill `kts_patient_id` on non-client trips in KTS queue UI; enforce ID entry when KTS ON |

Aligns with `docs/kts-architecture.md` §3.0 snapshot design and `pr4-schema-audit.md` §8 server-side join — with correction that **`client_name` is space-format, not comma-format**.

---

## 9. `kts_patient_id` for non-client passengers

### Can `client_id IS NULL` trips have `kts_patient_id`?

**Yes.** Column on `trips`:

```typescript
kts_patient_id: string | null;
```

No check constraint tying it to `client_id`.

### How is it set?

| When | Behaviour |
| ---- | --------- |
| **Create trip** | **Not set.** `normalizeKtsInsert` in submit only passes `kts_document_applies` + `kts_source` — no patient ID from client or form. |
| **Trip detail — linked client** | Read-only snapshot; edit via Kundenprofil. Copy on KTS switch ON or client select when KTS already ON. |
| **Trip detail — no client** | **Editable** `Input` “KTS Patienten-ID” when `kts_document_applies` (lines 1812–1827). |
| **Save** | `buildKtsPatchFromDrafts` writes `kts_patient_id` from draft; not cleared when KTS turned off. |

From `docs/kts-architecture.md` §3.0:

> **Name-only trip** (no `client_id`): editable **KTS Patienten-ID** on **Trip aktualisieren**.

### Implication for PR4

Non-client trips **can** participate in Step 1 ID matching **if** a dispatcher entered the SchneidID in the trip sheet. Many will still have `kts_patient_id IS NULL` until operational workflow improves. Name fallback remains necessary for that subset.

---

## 10. Senior recommendation — minimum intervention

### Options evaluated

| Option | Verdict |
| ------ | ------- |
| **A.** `client_name` as-is + fuzzy + manual review | **Insufficient alone** — order mismatch guarantees misses; fuzzy without normalization is noisy |
| **B.** Add structured name columns + form changes | **Defer** — correct long-term, disproportionate for PR4 import-only scope |
| **C.** Enforce format going forward + legacy gap | **Partial** — format is already enforced (space Vorname-Nachname); legacy gap is reorder/normalization, not enforcement |
| **D.** Skip name fallback; ID-only | **Too strict** — many non-client rows lack `kts_patient_id` at create time |

### Recommended minimum for PR4

**Hybrid: D for Step 1, normalized A for Step 2, manual review for the rest.**

1. **Step 1 — `kts_patient_id` exact match** (all trips, including non-client).
2. **Step 2 — normalized name + Berlin transport date:**
   - Linked: `LEFT JOIN clients` → `concat_ws(' ', first_name, last_name)`.
   - Non-client: `trips.client_name` compared after CSV `"Nachname, Vorname"` → `"Vorname Nachname"` normalization (same lowercase trim rules as `resolve_client_id_by_name`).
3. **Step 3 — unmatched bucket** with preview UI showing parsed CSV name vs trip name side-by-side for clerk resolution.
4. **No schema migration in PR4** for name columns.
5. **Post-PR4 ops (optional):** prompt for KTS Patienten-ID on non-client KTS trips in queue; consider backfill script from accountant export.

### Accuracy vs cost

- **Cost:** Normalization functions in import RPC + preview (~small, server-side).
- **Accuracy:** Covers the dominant `"Vorname Nachname"` storage pattern; fails gracefully on anonymous/null-name trips and ambiguous splits.
- **Risk accepted:** ~30% non-client cohort without SchneidID relies on name normalization quality; flag low-confidence rather than auto-apply invoice data.

---

## Appendix — service signatures

`trips.service.ts`:

```typescript
export type InsertTrip = Database['public']['Tables']['trips']['Insert'];
export type UpdateTrip = Database['public']['Tables']['trips']['Update'];

async createTrip(trip: InsertTrip) { … }
async updateTrip(id: string, trip: UpdateTrip) { … }
```

Both accept **`client_name`** and **`kts_patient_id`** as optional fields per generated types — no server-side name formatting in the service layer.

---

## Appendix — copy paths (duplicate / return)

`build-return-trip-insert.ts`:

```typescript
client_id: outbound.client_id,
client_name: outbound.client_name,
```

`duplicate-trips.ts` copies `client_name` and `kts_patient_id` from source trip into new insert (snapshot preservation per KTS architecture §3.2).

---

*Audit date: 2026-06-10. No code or schema changes.*
