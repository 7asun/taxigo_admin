# PR4.1 unmatched audit — Heike Lange (13.03.2026)

Read-only trace of the KTS CSV import matching cascade for a reported case: patient **Heike Lange**, trip on **13.03.2026**, landing in **Nicht zugeordnet** despite admin belief that name and date match.

**Audit date:** 2026-06-10  
**Source files:** `src/features/kts/lib/kts-csv-import-utils.ts`, `src/features/kts/kts.service.ts`, `src/features/kts/hooks/use-kts-invoice-import.ts`

No code or schema changes.

---

## 1. Step 3 existence

**Answer: Step 3 is absent.**

`matchSingleRow` implements only:

| Step | Mechanism | Lines |
|------|-----------|-------|
| Step 1 | `scheinId` → filter `dateCandidates` by `kts_patient_id` | 331–357 |
| Step 2a | Exact normalized name compare | 373–377, 402–410 |
| Step 2b | Partial token overlap via `hasPartialNameMatch` | 378–385, 413–429 |
| Fallback | Unmatched push when no candidates or no name match | 359–361, 432 |

There is **no** address-based fallback, no last-name-only fallback, and no function other than `hasPartialNameMatch` for fuzzy name matching.

The full `matchSingleRow` cascade ends at:

```432:432:src/features/kts/lib/kts-csv-import-utils.ts
  pushUniquePreviewRow(result.unmatched, seen, buildPreviewRow(csvRow, null));
```

No Step 3 block exists anywhere in `kts-csv-import-utils.ts`.

---

## 2. `normalizeCsvPatientName` — trace for Heike Lange

**Input (audit example):**

```text
Lange, Heike 01.01.1950 - Schramperweg 108, 26129 Oldenburg, DE (54870)
```

**Implementation:** lines 86–126.

### a) `scheinId` extraction

```typescript
const scheinMatch = trimmed.match(/\((\d+)\)\s*$/);
const scheinIdRaw = scheinMatch?.[1] ?? null;
const scheinId =
  scheinIdRaw && scheinIdRaw !== '0' ? scheinIdRaw : null;
```

- Regex matches trailing `(54870)`.
- **`scheinId = "54870"`**

### b) Strip parenthetical

```typescript
const withoutSchein = scheinMatch
  ? trimmed.slice(0, scheinMatch.index).trim()
  : trimmed;
```

- **`withoutSchein = "Lange, Heike 01.01.1950 - Schramperweg 108, 26129 Oldenburg, DE"`**

### c) Split on first comma

```typescript
const commaIdx = withoutSchein.indexOf(',');
lastName = withoutSchein.slice(0, commaIdx).trim();
const rest = withoutSchein.slice(commaIdx + 1).trim();
```

- **`lastName = "Lange"`**
- **`rest = "Heike 01.01.1950 - Schramperweg 108, 26129 Oldenburg, DE"`**

(Note: commas inside the address are **not** used — only the **first** comma splits Nachname from the remainder.)

### d) First whitespace token of remainder → `firstName`

```typescript
firstName = rest.split(/\s+/)[0]?.trim() ?? '';
```

- **`firstName = "Heike"`** (birthdate `01.01.1950` is the **second** token, not the first)

### e) `normalized`

```typescript
normalized: clientDisplayNameFromParts(firstName, lastName),
```

`clientDisplayNameFromParts` (lines 21–28 of `build-trip-details-patch.ts`):

```typescript
const parts = [first, last].map((s) => s.trim()).filter(Boolean);
if (parts.length > 0) return parts.join(' ');
```

- **`normalized = "Heike Lange"`**

**Runtime verification** (bun, same logic): `{ scheinId: "54870", firstName: "Heike", normalized: "Heike Lange" }`.

---

## 3. `tripDisplayName` — both cases

**Implementation:** lines 177–185.

```typescript
function tripDisplayName(trip: KtsCandidateTrip): string {
  if (trip.client_id && trip.clients) {
    return clientDisplayNameFromParts(
      trip.clients.first_name ?? '',
      trip.clients.last_name ?? ''
    );
  }
  return trip.client_name?.trim() ?? '';
}
```

### Case A — `client_id` set, `clients.first_name = 'Heike'`, `clients.last_name = 'Lange'`

- Condition `trip.client_id && trip.clients` is **true**.
- Returns `clientDisplayNameFromParts('Heike', 'Lange')`.
- **Result: `"Heike Lange"`**

### Case B — `client_id` null, `client_name = 'Heike Lange'`

- First branch false (`client_id` falsy).
- Returns `trip.client_name?.trim() ?? ''`.
- **Result: `"Heike Lange"`**

### Case C — `client_id` set, `clients` null, `client_name = 'Heike Lange'`

- `trip.client_id && trip.clients` → **false** (clients is null).
- Falls through to `client_name`.
- **Result: `"Heike Lange"`**

### Case D — `client_id` set, `clients` null, `client_name` null/empty

- Both branches yield empty string.
- **Result: `""`** → trip is **skipped** in the name loop (`if (!display) continue;`, line 371).

---

## 4. `normalizeCompareName`

**Implementation:** lines 173–175.

```typescript
function normalizeCompareName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
```

### a) Trip side — `tripDisplayName` → `"Heike Lange"`

- **`normalizeCompareName("Heike Lange")` → `"heike lange"`**

### b) CSV side — `normalizeCsvPatientName` → `normalized` `"Heike Lange"`

- **`normalizeCompareName("Heike Lange")` → `"heike lange"`**

**Are they identical?** **Yes** — both produce `"heike lange"`.

Step 2 exact compare (line 373):

```typescript
normalizeCompareName(display) === normalizeCompareName(normalized)
```

would be **`true`** for this input pair.

---

## 5. Date filter for 13.03.2026

### `parseGermanDate('13.03.2026')` — lines 147–170

- `parts = ['13', '03', '2026']`
- **`ymd = "2026-03-13"`**

### `tripBerlinYmd` for `scheduled_at = '2026-03-13 07:30:00+00'` — lines 187–190

```typescript
function tripBerlinYmd(trip: KtsCandidateTrip): string | null {
  if (!trip.scheduled_at) return null;
  return parseScheduledAtOrFallback(trip.scheduled_at)?.ymd ?? null;
}
```

`parseScheduledAtOrFallback` delegates to `parseScheduledAt`, which formats the instant in `getTripsBusinessTimeZone()` (default `Europe/Berlin`).

**Runtime verification:** `parseScheduledAtOrFallback('2026-03-13 07:30:00+00')?.ymd` → **`"2026-03-13"`**

(07:30 UTC = 08:30 CET on 13 March 2026 — still the same Berlin calendar day.)

### Comparison

| Source | ymd |
|--------|-----|
| CSV `Transportdatum` 13.03.2026 | `2026-03-13` |
| Trip `2026-03-13 07:30:00+00` | `2026-03-13` |

**Identical.** No Berlin TZ edge case for this timestamp.

---

## 6. `dateCandidates` walk-through

For a CSV row with `Transportdatum = '13.03.2026'` and a candidate trip with `client_name = 'Heike Lange'`, `scheduled_at = '2026-03-13 07:30:00+00'`:

```typescript
// matchKtsCsvRows → matchSingleRow
const transportYmd = parseGermanDate(csvRow.transportdatum); // "2026-03-13"

const dateCandidates = dedupeTripsById(
  tripsOnDate(trips, transportYmd).filter((t) => !consumedTripIds.has(t.id))
);
```

**`tripsOnDate`** (lines 192–194):

```typescript
return trips.filter((t) => tripBerlinYmd(t) === ymd);
```

- `tripBerlinYmd(trip)` → `"2026-03-13"`
- `transportYmd` → `"2026-03-13"`
- **Trip passes date filter** (assuming it is in the `trips` array passed to `matchKtsCsvRows`).

**Additional gates before name matching:**

1. Trip must be in `trips` input → only trips returned by `fetchKtsCandidateTrips` (see §7).
2. Trip must not be in `consumedTripIds` from an earlier CSV row in the same import.
3. If `dateCandidates.length === 0` after filters → **unmatched immediately** (lines 359–361), name logic never runs.

**If the trip is present and not consumed:** it **would** appear in `dateCandidates`, and with `normalized` and `display` both `"Heike Lange"`, Step 2 exact match **would** claim it (lines 402–410) → **matched** bucket, not unmatched.

**Conclusion for §6:** Given the stated trip shape and CSV format, the trip **should match**. Unmatched implies a **pre–Step 2 failure** (not in pool, wrong date in DB, `scheduled_at` null, consumed, or empty `tripDisplayName`) or a **name/date mismatch in actual data** differing from the audit assumptions.

---

## 7. Candidate fetch — client join

`use-kts-invoice-import.ts` delegates to `fetchKtsCandidateTrips` in `kts.service.ts` (lines 27–36 of hook; lines 452–488 of service).

**Exact Supabase select** — lines 436–446:

```typescript
const KTS_CANDIDATE_SELECT = `
  id,
  scheduled_at,
  kts_patient_id,
  client_name,
  client_id,
  kts_status,
  kts_belegnummer,
  kts_handover_id,
  clients(first_name, last_name)
`;
```

**Query filters** — lines 456–460:

```typescript
.from('trips')
.select(KTS_CANDIDATE_SELECT)
.eq('company_id', companyId)
.eq('kts_document_applies', true);
```

**Answer:** `clients(first_name, last_name)` **is embedded**.

Post-fetch normalization handles array-or-object embed (lines 467–474).

### If `client_id` IS NOT NULL but embed is missing/null

Per `tripDisplayName` (§3 Case C/D):

- If `client_name` is populated → name comes from `client_name`.
- If `client_name` is empty **and** `clients` is null → `display = ""` → trip **skipped** in name loop → can contribute to unmatched if no other trips match.

Missing embed alone does **not** force null display when `client_name` is set.

---

## 8. `hasPartialNameMatch`

**Implementation:** lines 204–212.

```typescript
function hasPartialNameMatch(normalized: string, candidate: string): boolean {
  const a = normalizeCompareName(normalized);
  const b = normalizeCompareName(candidate);
  if (!a || !b) return false;
  if (a === b) return false;
  const aTokens = a.split(' ').filter(Boolean);
  const bTokens = b.split(' ').filter(Boolean);
  return aTokens.some((t) => bTokens.includes(t));
}
```

### Would `"Heike Lange"` (trip) partially match `"Heike Lange"` (CSV normalized)?

- After normalize: `a = "heike lange"`, `b = "heike lange"`.
- Line 208: **`if (a === b) return false`** — partial match is **explicitly disabled** when strings are equal.
- Equal names are handled only by the **exact** match branch (line 373), not partial.

### Conditions that return `false` even when tokens overlap

1. Either side empty after normalize → `false` (line 207).
2. **Exact equality** after normalize → `false` (line 208) — by design.
3. No shared token between token lists → `false` (line 211).

For identical `"Heike Lange"` / `"Heike Lange"`, partial match returns **false**; exact match must succeed instead.

---

## 9. Senior diagnosis

### Expected path for stated inputs

With CSV Patient `"Lange, Heike … (54870)"`, Transportdatum `13.03.2026`, and trip `client_name = 'Heike Lange'`, `scheduled_at = '2026-03-13 07:30:00+00'`, `kts_document_applies = true`:

1. Step 1: `scheinId = "54870"` — matches only if `trip.kts_patient_id === "54870"`. If not, falls through (not unmatched by itself).
2. Trip in `dateCandidates` ✓
3. Step 2 exact: `"heike lange" === "heike lange"` ✓ → **matched**

**The stated scenario should not land in unmatched** unless actual DB/CSV data differs from assumptions or a pre-name gate fails.

### Ranked candidates

| Rank | Candidate | Verdict | Rationale |
|------|-----------|---------|-----------|
| **1** | **Other — trip absent from candidate pool or empty display name** | **Possible (most likely)** | Unmatched with zero name hits requires `dateCandidates.length === 0` (lines 359–361) **or** every candidate skipped at `if (!display) continue` (371) **or** name compare fails. Pool exclusion: `kts_document_applies !== true` (fetch filter line 460), trip not loaded, wrong company. Empty display: `client_id` set + `clients` null + `client_name` empty (§3 Case D). |
| **2** | **Other — trip stored under different display name** | **Possible** | e.g. `client_name = "Lange, Heike"`, typo, maiden name, double-barrelled first name not in first token (`"Heike-Maria"` vs `"Heike"`), encoding corruption before windows-1252 fix. Exact and partial both fail → unmatched. |
| **3** | **Other — `scheduled_at` null or Berlin ymd ≠ CSV day in actual row** | **Possible** | `tripBerlinYmd` returns null if `scheduled_at` missing (line 188). Different instant could shift Berlin day near midnight (not for `07:30:00+00` example). |
| **4** | **Other — trip consumed by earlier CSV row** | **Possible** | Same import file: earlier row claims trip ID; later Lange row sees empty `dateCandidates` → unmatched (361). |
| **5** | **d) Step 3 not implemented** | **Confirmed absent, ruled out as direct cause** | Cascade stops after partial match. Irrelevant **when** Step 2 exact would succeed; only matters when name match is partial/address-only — not the case for equal `"Heike Lange"`. |
| **6** | **a) firstName picks birthdate** | **Ruled out** for `"Nachname, Vorname DD.MM.YYYY …"` format | Trace §2: first token after comma is `"Heike"`, not `01.01.1950`. Would matter only if CSV **lacks** the comma (no-comma branch lines 110–117 assigns wrong parts). |
| **7** | **b) clients embed missing** | **Ruled out as sole cause** | Embed present in SELECT (§7). Missing embed falls back to `client_name` when set. |
| **8** | **c) Date mismatch (Berlin TZ)** | **Ruled out** for `2026-03-13 07:30:00+00` vs `13.03.2026` | Both → `2026-03-13` (§5). |

### Step 1 nuance

If `kts_patient_id` on the trip is **set to a different Schein-ID** than CSV `54870`, Step 1 does **not** match but Step 2 should still exact-match `"Heike Lange"`. Step 1 failure alone does **not** explain unmatched.

If `kts_patient_id` matches a **different trip** on the same date, that trip is claimed; Lange's trip might still match on Step 2 unless consumed/conflicting.

### Recommended verification (operational, not code)

1. Confirm trip row: `kts_document_applies`, `scheduled_at`, `client_name`, `client_id`, joined `clients` names, `kts_patient_id`.
2. Confirm trip appears in browser network response for `fetchKtsCandidateTrips` query.
3. Confirm CSV Patient string byte-exact (comma present, encoding, Schein-ID).
4. Check whether another CSV row in the same file consumed this trip ID.

---

## File index

| Concern | Location |
|---------|----------|
| Matching cascade | `src/features/kts/lib/kts-csv-import-utils.ts` |
| Candidate fetch SELECT | `src/features/kts/kts.service.ts` L436–488 |
| Hook wrapper | `src/features/kts/hooks/use-kts-invoice-import.ts` L27–36 |
| Berlin ymd parse | `src/features/trips/lib/trip-time.ts` L163–198 |
| Display name helper | `src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts` L21–28 |
