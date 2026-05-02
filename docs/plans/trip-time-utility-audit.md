# Trip time utility migration — strategic audit (`trip-time.ts`)

**Status:** Phase 2 complete; **Phase 3A complete**; **Phase 3B complete**; **Phase 4 complete — all write paths migrated, ESLint guard active** (bulk CSV `buildScheduledAt`; `no-restricted-syntax` guard on `src/features/trips/**` + `src/app/api/**`; `AGENTS.md` invariant). Phase 1 reference preserved below.  
**Note:** Remaining calendar/TZ gaps (non–`scheduled_at` write paths) — see **Post–Phase 4 / Phase 5 candidates** at the end of this file.

---

## Section 1 — Confirm the write map + gaps

### 1.1 The nine paths from your context — verified against the repo

| # | Path | File + lines | TZ assumption | Phase (your plan) | Verdict |
|---|------|---------------|----------------|-------------------|---------|
| 1 | Driver Touren date filter | `src/features/driver-portal/api/driver-trips.service.ts` **88–92** | **UTC literal** (`…Z`) day window | *(not in Phase 2/3 list)* | **Confirmed.** This path does **not** *write* `scheduled_at`; it **filters reads**. It still belongs in **the same release family** as time fixes — use **`getZonedDayBoundsIso(ymd)`** (existing) for bounds, **not** `buildScheduledAt`. |
| 2 | Recurring cron `toScheduledIso` | `src/app/api/cron/generate-recurring-trips/route.ts` **51–53** (+ `dateStr` at **478**) | **UTC server** naive string + **`startOfDay(new Date())`** at **90–91** | Phase 2 | **Confirmed.** |
| 3a | Timeless widget | `src/features/dashboard/components/timeless-rule-trips-widget.tsx` **86–96** | **Mixed** UTC date-only parse + `date-fns` `set` in local | Phase 2 | **Confirmed.** |
| 3b | Pending tours widget | `src/features/dashboard/components/pending-tours-widget.tsx` **191–199** | **Mixed** (`new Date(dateStr)` for `YYYY-MM-DD`) | Phase 2 | **Confirmed.** |
| 4 | `combineDepartureForTripInsert` | `src/features/trips/lib/departure-schedule.ts` | ~~Browser-local `Date`~~ → **`buildScheduledAt`** | Phase **3A shipped** | **Fixed.** |
| 5 | Detail sheet helpers | `apply-time-to-scheduled.ts` | ~~Browser-local~~ → **`buildScheduledAt` / `parseScheduledAt`** + render-safe `TripTimeError` catch | Phase **3B shipped** | **Fixed.** |
| 6 | `buildTripDetailsPatch` | `build-trip-details-patch.ts` | ~~local `Date`~~ → **`buildScheduledAt`** ISO for `scheduled_at` | Phase **3B shipped** | **Fixed.** |
| 7 | Create form return leg | `create-trip/create-trip-form.tsx` (+ outbound via `combineDepartureForTripInsert`) | ~~Browser-local~~ → **`buildScheduledAt`** | Phase **3A shipped** | **Fixed.** |
| 8 | Reschedule parsing | `trip-reschedule-dialog.tsx` | ~~`parseLocalYmdHm`~~ → **`buildScheduledAt`** + `parseScheduledAt` for init/sync | Phase **3B shipped** | **Fixed.** |
| 9 | Persist reschedule | `reschedule.actions.ts` (`leg.scheduledAt.toISOString()`) | Encodes dialog **`Date`** from Berlin-wall builder | Phase **3B shipped** | **Upstream fixed.** |
| 10 | Return trip insert | `build-return-trip-insert.ts` | ~~Caller `Date` → ISO~~ → **`scheduledAtIso`** from `buildScheduledAt` | Phase **3A shipped** | **Fixed.** |
| 11 | Bulk upload insert | `bulk-upload-dialog.tsx` `parseDateAndTime` + insert | ~~`new Date` + `setHours` + `toISOString()`~~ → **`buildScheduledAt`** + padded **`ymd`** | Phase **4 shipped** | **Fixed.** |

**Phase assignment sanity:** Putting **cron + dashboard widgets** in Phase 2 and **everything else** in Phase 3 is **reasonable**. **Critique:** **`driver-trips.service.ts`** is **production-broken** but is **not** a `trip-time.ts` consumer — slot it explicitly into **Phase 2** (or Phase 2b) alongside widgets so “driver sees wrong day” is fixed together with cron, even though the edit is **`getZonedDayBoundsIso`**, not `buildScheduledAt`.

---

### 1.2 Paths you listed that are incomplete or overstated — corrections

- **`duplicate-trip-schedule.ts` `combineYmdAndHmToIsoString`** already matches Berlin for **duplicate** UX; no migration target until Phase 4 “dedupe internals” (Section 4).
- **`duplicate-trips.ts` line ~68:** `scheduledDate.toISOString().split('T')[0]` for finding same-day paired trips uses **UTC** calendar — **risk** adjacent to cron; **query logic**, not a user-facing write of `scheduled_at`. **Missed** in original lists; classify as **fix later** / **technical debt** with recurrence tooling.

---

### 1.3 Additional write / mutation hits (missed entirely)

These **also** persist or stage `scheduled_at` and must be in the **overall** rollout plan:

| Location | Lines (approx.) | Role | Phase suggestion |
|---------|-----------------|------|------------------|
| `use-pending-assignments.ts` | `handleAssign` → **`buildScheduledAt`** | Dispatch inbox time entry | Phase **3B shipped** |
| `kanban-trip-card.tsx` | `commitTimeToStore` → **`buildScheduledAt`** | Kanban pending save | Phase **3B shipped** |
| `duplicate-trips.ts` / duplicate API | Inserts **`schedule.scheduled_at`** from payloads + `combineYmd…` | Writes **already correct** when using combine; **preserve**/`delta` paths use Berlin zoned ops | Phase 4: switch internals to **`buildScheduledAt`** to delete duplication |

**Paired reschedule math:** `reschedule-trip.ts` **computePairedReschedule** (**88–95**) emits ISO from `Date`; if the dialog moves to **`buildScheduledAt`**, deltas remain consistent **provided** primary `Date` is built the same way.

---

### 1.4 `.toISOString()` grep — `src/features/trips/**` + `src/app/api/cron/**`

**Classification shorthand:** **S** = scheduled_at-related write/query; **N** = not scheduled_at semantics; **√** already Berlin-correct path.

| File | Approx. usage | Class |
|------|----------------|-------|
| `departure-schedule.ts` **58** | Create outbound time | **S — fix Phase 3** |
| `print-trips-button.tsx` **58–65** | Print range boundaries | **N** (browser local day range for **query**) — separate from `trip-time`; consider aligning with **`getZonedDayBoundsIso`** later |
| `use-upcoming-trips.ts` **27–34** | Dashboard upcoming window | **N** (browser-local bounds vs Fahrten Berlin — **orthogonal bug risk**) |
| `use-create-trip-draft.ts` **25**, **32** | Draft timestamps / `return_date` ISO | **N** draft metadata |
| `bulk-upload-dialog.tsx` | CSV trip insert | **S — Phase 4 shipped** (`buildScheduledAt`) |
| `duplicate-trip-schedule.ts` **74**, **107**, **138**, **175**, **245+** | Zoned combines + deltas + payload normalize | **√ / S-adjacent** — **preserve** semantics; refactor to **`buildScheduledAt`** where equivalent |
| `recurring-exceptions.actions.ts` **33**, **82**, **291** | Exception matching / future-trip query | Mixed **S-ish** (**82** UTC date slice risk) — **cron-adjacent** |
| `recurring-rules.service.ts` **97** | `today` YMD | **N** |
| `use-pending-assignments.ts` **73+, 247** | Date slice + PATCH | **S — Phase 3** |
| `client-trips-panel.tsx` **44** | `since` filter | **N** (`startOfToday` browser) |
| `trip-business-date.ts` **50–51** | Fahrten bounds | **√** authoritative read |
| `build-trip-details-patch.ts` | PATCH `scheduled_at` | **S — Phase 3** |
| `kanban-trip-card.tsx` **191** | Staged ISO | **S — Phase 3** |
| `reschedule.actions.ts` **34** | Update patch | **S — Phase 3** |
| `reschedule-trip.ts` **88–95** | Paired reschedule ISO | **S — Phase 3** |
| `trip-detail-sheet.tsx` **857** | Compare existing ISO | **N** equality check |
| `pending-assignment-item.tsx` **57–61** | Display date derivation | **N** read |
| `trips.service.ts` **191–194** | Analytics query range | **N** caller-supplied bounds |
| `use-bulk-upload-resume-store.ts` **42** | Resume blob timestamp | **N** |
| `build-return-trip-insert.ts` **107** | Return insert | **S — Phase 3** |
| `create-trip-form.tsx` **1251** | Return leg | **S — Phase 3** |
| `duplicate-trips.ts` **68** | UTC YMD slice for pairing | **S-adjacent** — fix with Berlin YMD extractor |
| `cron/generate-recurring-trips` **53**, **478**, timestamps | Insert + occurrence date | **S — Phase 2** |

**Summary:** Phase 3 is **busier than the original nine** — Kanban card, dispatch inbox, paired reschedule helpers, duplicate pairing query, recurring exceptions (**82**) all touch the same coherence surface.

---

## Section 2 — Evaluate the planned API

### 2a. `buildScheduledAt(ymd, hm)`

- **Signature shape:** `ymd` + **`hm`** is right for dispatcher UI (DATE + `<input type="time">`).
- **`hm` format:** Accept **`HH:mm` and optional `:ss`** (`18:00` and `18:00:00`) — rule/cron clocks may be **seconds-padded** (`clockToHhMmSs` in cron). Match **`combineYmdAndHmToIsoString`** laxity (`\d{1,2}:\d{2}`) or **strict normalize** internally.
- **Invalid input:** For a **canonical** builder, **`throw`** a small typed error (or return `Result` type) beats **silent null** — silent null hides bugs in cron. Align with **`duplicate-trip-schedule`** (`Ungültige Uhrzeit.`) vs **`departure-schedule`** which returns **`scheduled_at: null`** — ** unify policy**: throws for programmatic paths, or return `null` only for **`buildScheduledAtOrNull`** wrapper.
- **TZ override:** Default **`getTripsBusinessTimeZone()`** only; optional `timeZone?: string` param for **future org-level** configs **without** breaking existing callers (`default = getTripsBusinessTimeZone()`). Avoid env reads in helpers except **central** accessor.

---

### 2b. `buildScheduledAtOrNull`

- **Separate** `buildScheduledAtOrNull` is **good ergonomics**: call sites mirror today’s **`combineDepartureForTripInsert`** (time empty ⇒ null `scheduled_at`, keep **`requested_date`**).
- **`buildScheduledAt` accepting null** blurs semantics (overload vs unions). Prefer **explicit** `_OrNull` for **CSV / create-trip “no clock”**.

---

### 2c. `parseScheduledAt(iso) → { ymd, hm }`

- **Yes**, this is the right **dual** inverse for **`buildScheduledAt`**, provided **timezone** for extraction is **`getTripsBusinessTimeZone()`** (same axis as listing).
- **Current UI drift:** **`format(new Date(iso), 'HH:mm')`**, **`toISOString().slice(0,10)`** (e.g. pending-tours **162–173**) use **viewer-local** formatting for **DATE** slicing — risky for travelers; **incorrect** vs Fahrten for **non-local** interpreters. **`parseScheduledAt`** centralizes Berlin display **inputs** but you must **migration-replace** these slice/format calls in Phase 3.
- **`applyTimeToScheduledDate` replacement:** Editing “time only” needs **preserve Berlin date of trip** → `parseScheduledAt` gives **ydm**, then **`buildScheduledAt(ymd, newHm)`**. That is **cleaner** than mutating **`Date#setHours`** in local.

---

### 2d. Missing functions?

Worth adding (either in **`trip-time.ts`** or **`trip-business-date.ts`** to avoid cyclic imports):

- **`getTripDayBoundsForYmd(ymd)`** — thin alias to **`getZonedDayBoundsIso`** OR move bounds here — **avoid** scattering `trip-business-date` vs `trip-time` confusion (**document**: `trip-time` = **instant construction/parsing**, `trip-business-date` = URL + picker + bounds; or merge bounds into `trip-time` with-care).
- **`normalizeHmForStorage(hm)`** — seconds strip/pad for rules/cron parity.
- **Display:** keep **`format`** in UI or add **`formatScheduledAtForDisplay`** only if duplicated **>3** places (optional Phase 4).

Deliberately **not** **`isTripToday`:** “today” = **`todayYmdInBusinessTz()`** + compare **`parseScheduledAt(iso).ymd`** — one-liner; avoid API bloat unless repeated.

---

## Section 3 — Red flags and risks

### 3a. Single highest-risk step

**Phase 3 migration of `combineDepartureForTripInsert` + create-trip + bulk upload in one merge** without a **feature flag** or **staged PRs**: one wrong **`ymd`** interpretation (e.g. **DatePicker** values already “correct” YMD in Berlin but double-zoned) could **shift every new trip** by a day. **Exact file cluster:** `departure-schedule.ts` + **`create-trip-form.tsx`** — highest **volume** of production inserts.

### 3b. Is “all dispatchers = Europe/Berlin” safe?

**No as a formal assumption.** Evidence of **non-Berlin writes**:

1. **`generate-recurring-trips`** — **already server UTC** → **wrong regardless** of browser.
2. **Bulk CSV** — admin could run importer from another TZ machine; **`parseDateAndTime`** is **browser-local** from **`Date`** parts.
3. **Duplicate payload** **`unifiedScheduledAtIso`** from unknown clients (**`parseDuplicateTripsPayload`** normalizes **`new Date(string).toISOString()`**).

**Operational:** If **all humans** historically used Germany-based browsers, manual rows **may** be **ISO-equivalent** to Berlin intent — **unproven**.

---

### 3c. Historical cron rows — data risk + SQL for **future** bad rows

**Risk if unchanged:** Completed trips poison **analytics** and **confidence** less than **tomorrow’s** recurring legs — drivers and dispatch chase **wrong wall clock**.

**Finding future materially-affected recurring rows:**

```sql
SELECT
  t.id,
  t.company_id,
  t.scheduled_at,
  t.requested_date,
  t.status,
  t.link_type,
  t.ingestion_source
FROM public.trips t
WHERE t.ingestion_source = 'recurring_rule'
  AND t.scheduled_at IS NOT NULL
  AND t.scheduled_at > NOW()  -- strictly future pickups (timestamptz)
ORDER BY t.scheduled_at ASC;
```

Refine joins to **`recurring_rules`** if you must exclude **edited** tours (compare to rule-clock reconstruction).

---

### 3d. Phase 1 only — merge safety

**Safest possible PR:** adds **`trip-time.ts`** + **`trip-time.test.ts`**, zero imports elsewhere. **Risk:** negligible — no tree-shaking side effects unless something **mistakenly imports** unused path and triggers **SSR env** quirks (unlikely). **Coverage:** Repo **`bun test`** only **`src/features/invoices/...`** and **`src/features/trips/lib/__tests__`** — add tests under **`trips/lib/__tests__`**, extend script if CI must pick up new dirs (already included).

---

### 3e. Other red flags

- **Dedup cron keys** (`EQ` **`scheduled_at`**) → **fix cron encoding** breaks **deterministic equality** vs **existing** wrong rows ⇒ **potential duplicate inserts** unless key uses **canonical** rebuilt instant or **`requested_date`+leg** only (**review insertIfAbsent contract** — `generate-recurring-trips` **301–330**).

- **`use-upcoming-trips` + stats** (+ **`print-trips-button`**) use **different** “day” primitives — UX confusion **survives** even if **`trip-time`** is perfect for **writes**.

---

## Section 4 — `duplicate-trip-schedule.ts` boundary

### 4a. Is `combineYmdAndHmToIsoString` clean?

**Mostly.** It duplicates **timezone math** identical to **`buildScheduledAt`**; **imports** **`parseYmdToLocalDate` only for **`parseDuplicateTripsPayload` validation**, not **`combine`** itself **`combine`** has **zero** **`Trip`** side effects.

### 4b. After Phase 3, duplicate still needs helpers?

**Yes** — **`computePreserveScheduleForLeg`**, **`computeReturnScheduleForDuplicate`**, **`outboundIsoFromUnifiedTimeChoice`** stay **beyond** simple **YMD+HM** (**delta** math, **`wallClockHmInBusinessTz`** extraction).

### 4c. Migrate duplicate internals?

**Recommendation:** **`combineYmdAndHmToIsoString`** body → **`return buildScheduledAt(...)`** in **Phase 3 or 4** — **eliminates divergence**. **Leave** **`computePreserve…`** unchanged until **`parseScheduledAt` + helpers** unify **preserve** (**optional** refactor).

Your decision **not** to make **`duplicate-trip-schedule`** the **public** facade for the rest of app — **validated**.

---

## Section 5 — Test strategy

### 5a. Exact `buildScheduledAt` cases (pin **`Europe/Berlin`** in env)

Assume **`NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE=Europe/Berlin`** fixed in tests.

| Case | Input | Expected `scheduled_at` (UTC ISO) |
|------|-------|-------------------------------------|
| CEST midsummer (**UTC+2**) 10:00 | `buildScheduledAt('2026-06-15', '10:00')` | **`2026-06-15T08:00:00.000Z`** |
| CEST **23:30** same Berlin calendar date | **`2026-06-15`** **`23:30`** | **`2026-06-15T21:30:00.000Z`** (still **2026-06-15** Berlin) |
| CET winter 10:00 (**UTC+1**) | **`2026-01-15`** **`10:00`** | **`2026-01-15T09:00:00.000Z`** |
| CET **23:30** | **`2026-01-15`** **`23:30`** | **`2026-01-15T22:30:00.000Z`** |
| **DST transition edge** (manual table) | e.g. last Sunday March / October × **02:xx** — | **explicit** Postgres or IANA oracle row (JS/DST quirks) |
| Invalid `hm` (**`abc`**) | — | **`throw`** (or match product: **`null`** in `_OrNull` only) |

**Regression vs cron bug:** assert **`≠`** **`2026-06-15T10:00:00.000Z`** for **`10:00` Berlin summer** (**that literal** catches UTC-mis-encoding).

---

### 5b. Where to put `trip-time.test.ts`

**Closest convention:** **`src/features/trips/lib/__tests__/trip-time.test.ts`** — matches **`duplicate-trips.test.ts`**, **`trip-price-engine.test.ts`**. **`package.json`** **`test`** already includes **`src/features/trips/lib/__tests__`** — **no script change**.

---

### 5c. Round-trip tests?

**Recommended:** **`buildScheduledAt(ymd, hm)` → `parseScheduledAt` → same **`ymd`/`hm`** for **several summer/winter noon** anchors.

**Breaks:**

- Seconds **≠ 0** in stored ISO (**parse** loses seconds if **`hm`** is **`HH:mm` only**) — Policy: **truncate** stored to minutes or **`hm`** **`HH:mm:ss`** (**choose** Phase 1).
- **Leap second:** ignore.
- **Non-normalized rounding** (**setMinutes**) vs **floating** DST — `@date-fns/tz` should match Postgres for same IANA (**spot-check vs SQL** quarterly).

---

## Section 6 — Senior recommendation (direct)

### 6a. Three-phase approval + tweaks

The **gates** (**Phase 1 no callsites**) are correct — they prevent coupling **broken** migrations to **experimental** helpers.

**I would tighten:**

1. **Phase 2 = cron + BOTH dashboard widgets + `driver-trips.service.ts` date filter** (even though driver uses **bounds**, not **`buildScheduledAt`**). One **“Berlin day correctness”** release slice.
2. **Split Phase 3** into **3A** (create + departure + bulk) vs **3B** (edit + reschedule + return + kanban + dispatch inbox) **across two PRs** if timeline allows — **rollback** is easier.

### 6b. Traps to avoid

- **“We fixed `trip-time.ts` so we’re done”** while **`use-upcoming-trips`**, **`print-trips-button`**, **`pending-tours` initialDate `toISOString().slice`**, **recurring-exceptions `split('T')[0]`** still show **UTC calendar** slices — **confusing triage** forever.
- **Big-bang backfill** in same deploy as **cron fix** **without** dedup review — **duplicate trip rows** risk.

### 6c. One thing Phase 1 must nail

**Contract lock:** **`buildScheduledAt` signature + normalization + error policy + seconds**.

Changing **`hm` accepted shapes** later **forks duplicates** (**CSV**, **cron `clockToHhMmSs`**) — **freeze** **`normalizeHm`** + **fixture tests** Phase 1.

### 6d. Safe now? Preconditions

**Safe to begin Phase 1 immediately.** Before Phase **2** (cron) reaches production: green tests; staging dry-run of `generate-recurring-trips` with fixture rules and golden ISO expectations; verify `insertIfAbsent` dedup vs `scheduled_at` equality after encoding changes.

Before Phase **3**: a short dispatcher QA script (create outbound + return + CSV smoke + reschedule + Kanban time).

**Feature freeze:** not mandatory for Phase 1; **recommended** overlapping **cron** + **bulk** merges.

### Post–Phase 4 / Phase 5 candidates (not shipped in Phase 4)

- **`getTodaysTrips` / driver day list:** device-local “today” vs Berlin business day (called out in `trips-date-filter.md`).
- **`use-upcoming-trips.ts`:** dashboard window uses local day bounds vs Fahrten Berlin semantics.
- **Print / export / analytics callers:** range boundaries may still use viewer-local or UTC slices where product wants Berlin (`print-trips-button`, `trips.service` analytics, etc.).
- **`duplicate-trips.ts` pairing / `recurring-exceptions.actions`:** UTC `split('T')[0]`-style risks called out in Section 1.4 — query/pairing, not write paths.
- **`use-pending-assignments` `todayStr` filter:** still `toISOString().slice(0,10)` for inbox “today” list scope — Berlin follow-up (Phase 5).
- **`recurring-rules.service.ts`:** `today` from UTC calendar slice — Phase 5.
- **Historical rows:** bad legacy UTC encodings are not backfilled by client migrations alone.

### 6e. One paragraph for a dispatcher (**plain English**)

We are aligning every place in software that decides **what “your pickup time” means in the database** with **Germany (Berlin) time**, matching what the big **Fahrten** planner already uses. Until now, phone apps for drivers used **UTC midnight** for “a day”, some dashboard widgets glued together **British time midnight** with **German clocks**, and the **automatic repeat-trip job** accidentally saved **British/Greenwich** values when it meant **German** times — so occasional trips drifted hours or slid to the neighboring date. Fixing this should make **printed times**, **drivers’ Tour lists**, and **your calendar** agree; trips **already planned** stay as-is until we decide if they need adjusting. **Rarely**, if something was corrected by hand recently, dates might jump once when we unify the clocks — operations will coordinate that separately.

---

## Appendix — `trip-time.ts` existence

**`src/features/trips/lib/trip-time.ts`** — **implemented** in Phase 1 with **`trip-time.test.ts`** (golden ISO / DST oracle / regressions). **Phase 2** migrated server cron + two dashboard widgets to `buildScheduledAt` / `buildScheduledAtOrNull`; driver **Touren** day filter uses **`getZonedDayBoundsIso`**. **Phase 3B** migrated edit sheet, reschedule dialog, Kanban inline time, dispatch inbox assign, plus the **timeless rule trips** hook (Berlin today+tomorrow `.in`) and widget copy. **Phase 4** migrated bulk CSV `scheduled_at` / `requested_date` construction and added an ESLint **`no-restricted-syntax`** guard (see `.eslintrc.trips-time-guard.json` + `bun run lint:trips-scheduled-at`).

**Dependencies (**`package.json`**): **`@date-fns/tz` ^1.4.1**, **`date-fns` ^4.1.0** — **Luxon**, **Moment**, **`Temporal`** **not** declared.

---

## Appendix — Re-export note

Prefer **`trip-time.ts`** to **import-from** **`getTripsBusinessTimeZone`** from **`trip-business-date.ts`** (**re-export** optional) rather than **`re-export`** everything indiscriminately — avoid **cyclical deps** (`trip-business-date` should **not** import **`trip-time`**).
