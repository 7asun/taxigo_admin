# PR4.1 — Jordan duplicate preview rows audit

**Date:** 2026-06-10  
**Scope:** Read-only analysis of why `matchKtsCsvRows` produces 4 preview rows instead of 2 for Andreas Jordan (Belegnummer 261527, 08.04.2026).  
**File:** [`src/features/kts/lib/kts-csv-import-utils.ts`](../src/features/kts/lib/kts-csv-import-utils.ts) (480 lines, read in full).

**Scenario (confirmed by reporter):**

| Source | Count | Detail |
| ------ | ----- | ------ |
| CSV rows | 2 | Identical Patient / Transportdatum / Belegnummer / amounts — outbound + return lines |
| DB trips | 2 | `44bdc1b3` (07:30), `9e40c502` (09:00); both `kts_patient_id = null` |
| Actual preview | 4 | 2 CSV rows × 2 trips each |
| Expected preview | 2 | One trip per CSV row |

---

## 1. Loop structure

**Outer loop — CSV rows** (`matchKtsCsvRows`):

```469:476:src/features/kts/lib/kts-csv-import-utils.ts
  for (const csvRow of csvRows) {
    const transportYmd = parseGermanDate(csvRow.transportdatum);
    if (!transportYmd) {
      pushUniquePreviewRow(result.unmatched, seen, buildPreviewRow(csvRow, null));
      continue;
    }
    matchSingleRow(csvRow, trips, transportYmd, result, seen);
  }
```

- **Outer:** `for (const csvRow of csvRows)` — iterates **CSV rows**.
- **Inner:** no loop over CSV rows inside `matchSingleRow`; instead loops over **candidate trips** on the same date.

**Inner loop — date-filtered trips** (`matchSingleRow`, Step 2 name scan):

```352:369:src/features/kts/lib/kts-csv-import-utils.ts
  for (const trip of dateCandidates) {
    const display = tripDisplayName(trip);
    if (!display) continue;

    if (normalizeCompareName(display) === normalizeCompareName(normalized)) {
      if (!exactIds.has(trip.id)) {
        exactIds.add(trip.id);
        exactMatches.push(trip);
      }
    } else if (
      !exactIds.has(trip.id) &&
      hasPartialNameMatch(normalized, display) &&
      !partialIds.has(trip.id)
    ) {
      partialIds.add(trip.id);
      partialMatches.push(trip);
    }
  }
```

**Additional loops (not the main match cascade):**

- `parseKtsCsvRows`: `data.forEach((raw, index) => { … })` (line 429) — builds `KtsCsvRow[]` before matching.
- `partitionByImportStatus`: `for (const trip of alreadyImported)` (285), `for (const trip of fresh)` (295) — emits preview rows for **all** trips passed in.
- `dedupeTripsById`: `for (const trip of trips)` (250) — collapses duplicate trip IDs in an array.

**Answer:** Outer = **CSV rows**; inner name-match = **candidate trips on that date**. There is no nested “CSV inside trip” loop.

---

## 2. Step 2 name match result (Jordan)

### Step 1 for Jordan

Schein-ID is extracted from CSV Patient trailing `(54863)` → `scheinId = '54863'` (lines 93–96). Step 1 runs when `scheinId` is truthy (318):

```318:323:src/features/kts/lib/kts-csv-import-utils.ts
  if (scheinId) {
    const idMatches = dedupeTripsById(
      dateCandidates.filter(
        (t) => (t.kts_patient_id?.trim() ?? '') === scheinId
      )
    );
```

Both trips have `kts_patient_id = null` → `idMatches.length === 0` → Step 1 **does not match**; execution falls through to Step 2.

### Date filter — present, applied before name compare

```316:316:src/features/kts/lib/kts-csv-import-utils.ts
  const dateCandidates = dedupeTripsById(tripsOnDate(trips, transportYmd));
```

```192:194:src/features/kts/lib/kts-csv-import-utils.ts
function tripsOnDate(trips: KtsCandidateTrip[], ymd: string): KtsCandidateTrip[] {
  return trips.filter((t) => tripBerlinYmd(t) === ymd);
}
```

Step 2 **only** iterates `dateCandidates` (line 352), not the full `trips` array. Names are **not** compared across all trips regardless of date.

### How many trips does Step 2 return for Jordan?

For each CSV row on `08.04.2026`:

1. `dateCandidates` = **2 trips** (both Jordan trips on that Berlin date).
2. Name loop collects **both** into `exactMatches` (exact string match after normalization).
3. `allShareSameBelegnummer(exactMatches)` — both have `kts_belegnummer = null` → single empty string in set → **true** (lines 371–380 skipped).
4. Branch at lines 383–385:

```383:385:src/features/kts/lib/kts-csv-import-utils.ts
  if (exactMatches.length >= 1) {
    partitionByImportStatus(csvRow, exactMatches, 'matched', null, result, seen);
    return;
```

**Per CSV row, Step 2 returns 2 matched preview rows** (one per trip in `exactMatches`).

**Answer:** Step 2 filters **by date first**, then name. For Jordan it finds **2 exact name matches per CSV row** → **2 preview rows per CSV row** → **4 total** for 2 CSV rows.

---

## 3. Trip consumption

Every CSV row receives the **full, unmodified** candidate array:

```475:475:src/features/kts/lib/kts-csv-import-utils.ts
    matchSingleRow(csvRow, trips, transportYmd, result, seen);
```

Inside `matchSingleRow`, `trips` is only read — filtered into `dateCandidates` (316); **never spliced, filtered for “already claimed”, or copied to a shrinking pool**.

**Answer:** **No consumption.** Each CSV row searches the **full** `trips` array (date-filtered only). Matched trips remain available for the next CSV row.

---

## 4. Assignment strategy

There is **no 1:1 assignment**. Matching is **N:N**:

- Each CSV row independently finds **all** trips that pass Step 1 or Step 2 on that date.
- `partitionByImportStatus` adds **every** trip in the match set to the bucket (295–304):

```295:304:src/features/kts/lib/kts-csv-import-utils.ts
  for (const trip of fresh) {
    const row = buildPreviewRow(csvRow, trip, {
      lowConfidenceReason:
        bucket === 'lowConfidence' ? lowConfidenceReason : null
    });
    if (bucket === 'matched') {
      pushUniquePreviewRow(result.matched, seen, row);
    } else {
      pushUniquePreviewRow(result.lowConfidence, seen, row);
    }
  }
```

The only “multi-trip” guard is `allShareSameBelegnummer` → **Low-Confidence** when multiple matches have **different** existing `kts_belegnummer` (371–380). It does **not** limit one-trip-per-CSV-row when beleg numbers are equal or both null.

**Answer:** **Pure N:N** — no logic that a trip can be claimed by only one CSV row, and no logic that one CSV row claims only one trip when multiple exact matches exist.

---

## 5. `dedupeTripsById` — where called

**Definition** (lines 247–256):

```247:256:src/features/kts/lib/kts-csv-import-utils.ts
function dedupeTripsById(trips: KtsCandidateTrip[]): KtsCandidateTrip[] {
  const seen = new Set<string>();
  const out: KtsCandidateTrip[] = [];
  for (const trip of trips) {
    if (seen.has(trip.id)) continue;
    seen.add(trip.id);
    out.push(trip);
  }
  return out;
}
```

**Call sites (all pre-partition / pre-match on trip arrays, not on output buckets):**

| Line | Context |
| ---- | ------- |
| 281 | `partitionByImportStatus` — `const uniqueTrips = dedupeTripsById(trips)` |
| 316 | `matchSingleRow` — `dateCandidates = dedupeTripsById(tripsOnDate(...))` |
| 319–323 | Step 1 — `idMatches = dedupeTripsById(dateCandidates.filter(...))` |

**Not called** in `matchKtsCsvRows` on the full candidate pool before the outer CSV loop. **Not called** on output buckets after matching.

**Answer:** Called on **input trip arrays** inside matching/partitioning — **not** on cross-CSV-row consumption and **not** on final output deduplication beyond `pushUniquePreviewRow`.

---

## 6. `pushUniquePreviewRow` — dedupe key

**Key function** (258–260):

```258:260:src/features/kts/lib/kts-csv-import-utils.ts
function previewDedupeKey(csvRowIndex: number, tripId: string | null): string {
  return `${csvRowIndex}:${tripId ?? 'unmatched'}`;
}
```

**Usage** (262–270):

```262:270:src/features/kts/lib/kts-csv-import-utils.ts
function pushUniquePreviewRow(
  bucket: KtsMatchPreviewRow[],
  seen: Set<string>,
  row: KtsMatchPreviewRow
): void {
  const key = previewDedupeKey(row.csvRowIndex, row.tripId);
  if (seen.has(key)) return;
  seen.add(key);
  bucket.push(row);
}
```

**Key = `csvRowIndex + ":" + tripId`** (not `rowKey` from `buildPreviewRow`, which uses `-` separator: `${csvRow.rowIndex}-${tripId}` at 223–225).

**Cross-CSV-row behavior:**

| Preview | Key | Deduped? |
| ------- | --- | -------- |
| CSV row 0 → trip A | `0:tripA` | — |
| CSV row 1 → trip A | `1:tripA` | **No** — different `csvRowIndex` |
| CSV row 0 → trip A (duplicate push) | `0:tripA` | **Yes** — same key |

**Answer:** Key is **`csvRowIndex:tripId`**. CSV row 0 → trip A and CSV row 1 → trip A are **intentionally not deduped** — they produce **two separate preview rows**. This guard only prevents duplicate `(same CSV line, same trip)` pairs, not cross-row trip reuse.

---

## 7. Senior diagnosis

### Why 4 rows instead of 2

Plain terms:

1. The accountant file has **2 identical CSV lines** (outbound + return) for Jordan on 08.04.2026.
2. The database has **2 trips** for Jordan on that date (07:30 and 09:00).
3. Step 1 (patient ID) fails because `kts_patient_id` is still null on both trips — Schein-ID `54863` from CSV is not on the trip rows yet.
4. Step 2 finds **both trips** as exact name matches **for each CSV row** (lines 352–359, 383–384).
5. There is **no “one CSV row → one trip”** rule and **no “trip already claimed”** pool — matching is a full **cross product**: 2 CSV rows × 2 trips = **4 preview rows**.

The guard layer (`dedupeTripsById`, `exactIds`, `pushUniquePreviewRow`) prevents:

- The same trip appearing twice **within one CSV row’s match pass** (duplicate IDs in `dateCandidates`).
- The same `(csvRowIndex, tripId)` pair being pushed twice.

It does **not** prevent:

- One CSV row from matching **multiple** trips when names match.
- Multiple CSV rows from matching the **same** trip.

### Minimum change for exactly 2 rows (Jordan case)

Product intent for outbound + return: **2 CSV lines, 2 trips, 1:1 assignment**.

**A consumed-trips `Set` alone is not sufficient** with the current “add all `exactMatches`” behavior (383–384). CSV row 0 would still add **both** trips before row 1 runs → 2 rows from row 0 alone.

**Minimum fix (two parts):**

1. **One trip per CSV row** when Step 2 yields multiple exact matches on the same date — pick a single best candidate (e.g. first unclaimed by `scheduled_at` ascending) instead of calling `partitionByImportStatus` with the full `exactMatches` array.
2. **`consumedTripIds: Set<string>`** passed through the outer CSV loop (469–476) — after a trip is assigned to a CSV row, remove it from the pool for subsequent rows (`trips.filter(t => !consumed.has(t.id))` or skip in `dateCandidates`).

With both:

- CSV row 0 → claims trip `44bdc1b3` (07:30) → 1 preview row.
- CSV row 1 → only `9e40c502` remains → 1 preview row.
- **Total: 2.**

**Alternative (different product rule):** If a **single** CSV row with one Belegnummer should stamp **all** same-day same-name trips (true outbound+return on one line), then **1 CSV row → 2 trips** is correct and the bug would be **duplicate CSV lines** in the source file — dedupe CSV rows by `(transportdatum, patient, belegnummer)` before matching. That is **not** the stated scenario (2 distinct CSV lines for 2 legs).

### Recommended approach

| Approach | Sufficient for Jordan? |
| -------- | --------------------- |
| `pushUniquePreviewRow` / `exactIds` only | **No** — keys include `csvRowIndex` |
| `dedupeTripsById` on candidates only | **No** — does not cross CSV rows |
| **Consumed-trips Set only** | **No** — must also stop assigning **all** exact matches per row |
| **Consumed Set + one trip per CSV row** | **Yes** — minimum correct fix for 2×2 → 2 |
| CSV row dedupe before match | **No** — would collapse 2 intentional lines to 1 |

---

## Summary table

| Question | Finding |
| -------- | ------- |
| Loop structure | Outer: CSV rows (469). Inner: `dateCandidates` trips (352). |
| Step 2 date filter | **Yes** — `tripsOnDate` before name compare (316, 192–194). |
| Step 2 Jordan result | **2 trips per CSV row** → 4 total for 2 CSV rows. |
| Trip consumption | **None** — full `trips` every iteration (475). |
| Assignment | **N:N** — all exact matches per row (383–384, 295–304). |
| `dedupeTripsById` | Input arrays only (281, 316, 319) — not cross-row pool. |
| `pushUniquePreviewRow` key | `csvRowIndex:tripId` — cross-row same trip **not** deduped. |
| Root cause | 2 CSV × 2 trips exact match cross product; no 1:1 claim. |

---

*Audit complete — findings only, no code changes.*
