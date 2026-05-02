# Post–Phase 3B strategic review (trips time system)

**Scope:** Reflection after Phases 1–3B on `scheduled_at` writes, `trip-time.ts`, and adjacent date behaviour. **No code** in this document — recommendations only.

---

## 1. Remaining fragility — bypassing `buildScheduledAt`

**High risk**

- **Raw `new Date(y, m, d, h, mi)` + `toISOString()`** anywhere under `src/features/trips/**` (or trip APIs). This pattern is easy to copy from Stack Overflow and looks “correct” locally; it silently encodes the **runtime** timezone, not operations time.
- **`toISOString().slice(0, 10)` as a calendar day** for `scheduled_at`, pairing, or filters. That is **UTC midnight–based** YMD, not Berlin business YMD. Still present in places like dispatch display helpers and filters (e.g. pairing / inbox classification paths that were partially out of 3B scope).
- **Bulk CSV (`bulk-upload-dialog.tsx`)** — last obvious **write** path that still builds a `Date` with `setHours` and persists `toISOString()`.
- **New features** added without importing `trip-time`: any new “pick date + time” UI will drift unless reviewers know the rule.

**Medium risk**

- **`duplicate-trip-schedule.ts` and similar** — already Berlin-zoned, but **parallel** APIs to `buildScheduledAt` mean a maintainer might “fix” one path and not the other, or duplicate logic when adding a third flow.
- **Server routes** that construct instants with `new Date()` or string concatenation without going through `trip-time` / `trip-business-date`.

**How to harden**

1. **Lint / CI guard (highest leverage):** an ESLint rule or `eslint-plugin-local-rules` that **flags** in `src/features/trips/**` (and `src/app/api/**` touching trips):  
   - `new Date(` with numeric month arguments **and** later `.toISOString()` used for persistence; or  
   - `setHours` / `setMinutes` on a `Date` that is then written to `scheduled_at`.  
   Allow-list tests and `trip-time.ts` / `duplicate-trip-schedule.ts` internals after review.
2. **Single sentence in `AGENTS.md` / PR template:** “Persisting `trips.scheduled_at` must use `buildScheduledAt` (or `buildScheduledAtOrNull`); never `new Date(y,m,d,h,m).toISOString()` for dispatcher intent.”
3. **Thin wrapper type at DB boundary (optional):** e.g. branded `ScheduledAtIso` / helper `asScheduledAtIso(iso: string)` only produced by `buildScheduledAt`, so call sites that take `string` for PATCH are obviously audited — heavier lift, but makes wrong construction visible in types.

---

## 2. `trip-time.ts` API — changes after seeing real call sites

**What works well**

- **`buildScheduledAt` + `parseScheduledAt`** as the core pair is the right shape; **`TripTimeError`** is consistently useful at UI boundaries.
- **`buildScheduledAtOrNull`** matches “time optional” flows without try/catch noise.

**Possible improvements (not mandatory)**

1. **Re-export or doc-link `getTripsBusinessTimeZone`** from one place: many files import from both `trip-business-date` and `trip-time`; a short module doc at the top of `trip-time.ts` stating “reads/bounds → `trip-business-date`; wall clock ↔ UTC ISO → here” reduces cognitive load.
2. **`parseScheduledAtOrFallback(iso): { ymd, hm } | null`** (or catch helper) for **display-only** paths that today use `toISOString().slice(0,10)` — would centralize “invalid ISO” behaviour without throwing in render.
3. **`buildScheduledAtFromParts(year, month1Based, day, hm)`** — would let CSV parsers avoid constructing a browser `Date` for the calendar triplet; smallest bulk-upload fix can stay as string `YYYY-MM-DD` from parts + `buildScheduledAt` without this, so **low priority**.
4. **Seconds / rounding policy** is already documented in `normalizeHm`; consider a one-line “contract” in the file header: *minute resolution; ms truncated on write* — helps future cron/UI parity reviews.

**What not to change lightly**

- Throwing **`TripTimeError`** on bad input: programmatic paths (cron) rely on failures being loud; keep **`buildScheduledAtOrNull`** for optional clocks only.

---

## 3. Smallest correct fix for `bulk-upload-dialog.tsx`

**Current behaviour (problem):** `parseGermanDateOnly` builds a **local** `Date`; `toLocalISODate` uses **local** `getFullYear` / `getMonth` / `getDate`; time is applied with **`setHours`** and persisted via **`scheduled_at.toISOString()`**. That ties CSV semantics to the **operator’s browser TZ**, not `getTripsBusinessTimeZone()`, and diverges from Fahrten / cron / 3B paths.

**Smallest correct fix**

1. From the parsed German date triplet **`(day, month, year)`**, build a canonical **`ymd` string** `YYYY-MM-DD` with **string padding only** (no `new Date` for the date part, or use `Date` only for validation of “real calendar day” then discard — but the robust approach is: validate day/month/year ranges, then format). This **`ymd` is the business-calendar label** for the CSV row (same as `requested_date` intent).
2. Set **`requested_date`** to that **`ymd`** (not `toLocalISODate` from a local `Date`).
3. When a time string is present and valid, set  
   **`scheduled_at = buildScheduledAt(ymd, normalizedHm)`**  
   (reuse the same HM parsing rules as elsewhere, or trim and pass into `buildScheduledAt` which already normalizes). When time is absent, keep **`scheduled_at: null`** as today.
4. Wrap **`buildScheduledAt`** in **`try/catch TripTimeError`** → user-visible error for that row (toast or row error state), consistent with create form / widgets.

**Optional next step (still small):** align comments that say “local timezone” with “business timezone / `NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE`” so future edits do not revert to browser-local wording.

---

## 4. Other date/time bug patterns (not `scheduled_at` writes)

These are **symptoms of the same class of mistake**: using **runtime local** or **UTC slice** where the product means **Berlin business calendar** or **stored instant interpreted in Berlin**.

| Area | Pattern | Risk |
|------|---------|------|
| **Dispatch / pending UI** | `new Date(scheduled_at).toISOString().slice(0, 10)` for display or grouping | Wrong **day label** near midnight or for bad legacy rows; inconsistent with `parseScheduledAt`. |
| **Dispatch inbox filter** | `todayStr = now.toISOString().slice(0, 10)` | “Today” bucket is **UTC date**, not Berlin operations today. |
| **Driver portal** | `getTodaysTrips` / shift forms using device-local or UTC “today” | Wrong tour list day vs dispatcher (already flagged as gap). |
| **Recurring / exceptions** | `new Date().toISOString()` as `gte` bound on `scheduled_at` | “Now” is correct as instant; pairing logic that uses **date slices** from ISO strings is riskier. |
| **`recurring-rules.service`** | `today` from `toISOString().split('T')[0]` | UTC **calendar** for rules that likely mean Berlin. |
| **Print / export / metrics** | Local `startOfDay` / `endOfDay` or ad-hoc ranges | Reports may disagree with Fahrten filters. |
| **Invoices** | `new Date().toISOString()` for `created_at` / `updated_at` | Usually fine (true UTC timestamps); **invoice PDF due dates** or period labels that mix `Date` construction with display TZ need care — not the same bug as `scheduled_at`, but worth separate review if periods are “German business month”. |

**`requested_date`:** After bulk-upload fix, most **`requested_date`** writes should be explicit **`YYYY-MM-DD`** strings from business intent, not derived from `Date` in local TZ. Reads that compare `requested_date` to URL filter params are already moving toward Berlin; **displays** that format a date-only column should not use `new Date(requested_date + 'T00:00:00')` in local mode without documenting intent.

---

## 5. One architectural improvement with highest long-term impact

**Introduce a documented “trips time layer” and enforce it mechanically.**

Concretely:

1. **Written architecture note** (short, in-repo): one page that states the **invariants** — (a) persisted `scheduled_at` is always UTC ISO from **`buildScheduledAt`** for human-entered wall times; (b) calendar **`requested_date`** is `YYYY-MM-DD` in **business TZ**; (c) day **filters** use **`getZonedDayBoundsIso`** / `instantToYmdInBusinessTz`; (d) **never** use UTC YMD slices of instants for business-day equality.

2. **Pair that with one automated gate** (ESLint or a small `knip`-style script): any new file under `features/trips` that references `.toISOString()` and `scheduled_at` (or trip insert types) without importing from `trip-time` or an approved wrapper — **warn or error in CI**.

Together, documentation alone drifts; lint alone annoys without rationale. **Doc + one guard** gives the highest maintainability ROI for a small team and prevents the browser-local regression class from returning via innocent refactors.

---

## Summary

Phase 3B closed the main **interactive** `scheduled_at` write surfaces; the **largest remaining write hole** is **bulk CSV**. The **largest systemic risk** is not one file but **convention drift**: new code paths reintroducing local `Date` math. Hardening should focus on **mechanical detection** plus a **single canonical doc** for the trips time model, not on expanding `trip-time.ts` with rarely used helpers unless a second consumer appears.
