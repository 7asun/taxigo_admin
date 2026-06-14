# Pending Tours Widget — Urgency Styling Audit

**Scope:** Assess whether and how the dashboard **Offene Touren** widget (`PendingToursWidget` / `UnplannedTripRow`) can safely adopt the existing trip urgency system (border/background styling).

**Date:** 2026-06-12  
**Status:** Implemented — `UnplannedTripRow` uses `useUrgencyLevel` + `URGENCY_STYLES.rowClass` (see `docs/urgency-indicator.md`).

---

## Files read (seed set)

| File | Role |
|------|------|
| `src/features/dashboard/components/pending-tours-widget.tsx` | Widget UI + `UnplannedTripRow` |
| `src/features/dashboard/hooks/use-unplanned-trips.ts` | Data fetch, filter, sort |
| `src/features/trips/lib/urgency-logic.ts` | Urgency level calculation |
| `src/features/trips/lib/urgency-translations.ts` | German labels / descriptions |
| `src/features/trips/lib/trip-time.ts` | Berlin-safe `scheduled_at` read/write |
| `src/features/trips/lib/trip-business-date.ts` | Business TZ helpers |
| `src/features/trips/lib/trip-status.ts` | Driver-change status derivation |
| `src/features/trips/lib/trip-direction.ts` | Rückfahrt / cancelled-partner labels |
| `src/features/trips/api/trips.service.ts` | `Trip` type + `updateTrip` |
| `src/query/keys/trips.ts` | `tripKeys.unplanned*` (note: no `src/query/keys.ts`; barrel is `src/query/keys/index.ts`) |

## Files read (urgency consumers & styling)

| File | Urgency role |
|------|----------------|
| `src/features/trips/constants/urgency-config.ts` | `URGENCY_STYLES.rowClass`, `KANBAN_TIME_CHIP_CLASS` |
| `src/features/trips/components/urgency-indicator.tsx` | Dot/badge CVA + 10s live updates |
| `src/features/trips/hooks/use-urgency-level.ts` | Live level hook (10s) |
| `src/features/trips/components/trips-tables/index.tsx` | Row `border-l` via `URGENCY_STYLES` |
| `src/features/trips/components/trips-tables/columns.tsx` | `UrgencyIndicator` dot in Zeit column |
| `src/features/trips/components/trips-tables/trips-mobile-card-list.tsx` | Card row classes + dot |
| `src/features/trips/components/kanban/kanban-trip-card.tsx` | Time-chip tint + tooltip |
| `src/features/overview/components/trip-row.tsx` | Dot only (UpcomingTrips / client panel) |
| `src/features/driver-portal/components/shared/driver-trip-card.tsx` | Badge variant |
| `src/components/documentation/markdown-renderer.tsx` | Docs `urgency:*` inline demo |
| `docs/urgency-indicator.md` | Canonical module documentation |

**Not urgency-styled (visual peers):** `timeless-rule-trips-widget.tsx` uses the same row shell (`rounded-lg border p-3`) but has no urgency today.

---

## 1. Where is the urgency system used?

### Core modules (not UI)

| Module | Purpose |
|--------|---------|
| `urgency-logic.ts` | Pure `getUrgencyLevel(scheduledAt, status)` |
| `urgency-translations.ts` | `getUrgencyTranslation(level)` → German label + description |
| `urgency-config.ts` | Tailwind class maps: `URGENCY_STYLES`, `KANBAN_TIME_CHIP_CLASS` |
| `use-urgency-level.ts` | Client hook; re-runs logic every 10s |

### UI consumers

| Location | What receives urgency styling | Elements styled |
|----------|------------------------------|-----------------|
| **Fahrten table** (`trips-tables/index.tsx`) | Table row / mobile card container | **Border** (`border-l-4`), **background** tint, `font-medium` / `font-bold` / `animate-pulse` on `due`/`overdue` via `URGENCY_STYLES.rowClass` |
| **Fahrten table Zeit column** (`columns.tsx`) | Inline dot next to time text | **Dot** (color + shadow), **tooltip** (label) via `UrgencyIndicator` `variant="dot"` |
| **Fahrten mobile cards** (`trips-mobile-card-list.tsx`) | Inherits row classes from parent + dot beside time | **Border/background** (row) + **dot** + tooltip |
| **Kanban card** (`kanban-trip-card.tsx`) | Wrapper around `<input type="time">` | **Border**, **background**, **hover**, `animate-pulse` on overdue via `KANBAN_TIME_CHIP_CLASS`; **tooltip** on chip |
| **Overview TripRow** (`trip-row.tsx`) | Dot column only | **Dot** + tooltip; row uses billing-family **left border** (unrelated to urgency) |
| **Driver portal card** (`driver-trip-card.tsx`) | Beside time | **Badge** pill (background, text, border) + tooltip via `UrgencyIndicator` `variant="badge"`; row uses `tripStatusRow` (status, not urgency) |
| **In-app docs** (`markdown-renderer.tsx`) | Inline `urgency:level` tokens | **Dot** color from `URGENCY_STYLES` |

### Styling split (important)

Urgency colors exist in **two** places that must stay aligned:

1. **`urgency-config.ts`** — `rowClass` (table rows) and `KANBAN_TIME_CHIP_CLASS` (Kanban time chip).
2. **`urgency-indicator.tsx`** — CVA `urgencyIndicatorVariants` for dot/badge (duplicated palette semantics).

Labels for UI text come from **`urgency-translations.ts`** (German). `URGENCY_STYLES.*.label` in config is English and is only used as fallback inside `UrgencyIndicator` levelLabels (badge path uses `getUrgencyTranslation` for display).

---

## 2. Canonical urgency presentation pattern

| Concern | Canonical source | Notes |
|---------|------------------|-------|
| **Level calculation** | `src/features/trips/lib/urgency-logic.ts` → `getUrgencyLevel` | Single pure function |
| **User-facing label** | `src/features/trips/lib/urgency-translations.ts` → `getUrgencyTranslation` | German default |
| **Row border / background** | `src/features/trips/constants/urgency-config.ts` → `URGENCY_STYLES[level].rowClass` | Used by Fahrten table + mobile cards |
| **Time-control chip tint** | `urgency-config.ts` → `KANBAN_TIME_CHIP_CLASS` | Kanban only today |
| **Dot / badge element** | `urgency-indicator.tsx` CVA | Not exported as a shared class map |
| **Live refresh** | `use-urgency-level.ts` or `UrgencyIndicator` | 10s interval |

### Duplicates

| Duplicate | Recommendation |
|-----------|----------------|
| Dot/badge colors in `urgency-indicator.tsx` vs `urgency-config.ts` | Already documented as “must stay aligned.” Do **not** add a third copy in the widget. |
| Fahrten table `getRowClassName` calls `getUrgencyLevel` **once per render** (no hook) | Row borders **do not** auto-tick every 10s; only the Zeit-column dot does. Kanban uses the hook on the chip. **Pending tours should use `useUrgencyLevel`** if borders must stay live. |
| `URGENCY_STYLES.*.label` (English) vs `urgency-translations` (German) | Use translations for any tooltip/badge text. |

**Canonical row-border pattern** (Fahrten table):

```ts
const urgency = getUrgencyLevel(scheduledAt, status);
const style = URGENCY_STYLES[urgency];
if (style?.rowClass) classes.push(style.rowClass);
```

---

## 3. Does the pending tours widget have the data needed?

### Query shape (`fetchUnplannedTrips`)

```sql
.or('scheduled_at.is.null,driver_id.is.null')
.not('status', 'in', '("cancelled","completed")')
```

A trip appears when **either** `scheduled_at` **or** `driver_id` is null (not necessarily both).

### Field availability on `UnplannedTrip`

| Field | Always present? | Used for urgency? |
|-------|-----------------|-------------------|
| `status` | Yes (DB row) | Yes — `getUrgencyLevel` excludes `cancelled`/`completed` (query already filters these out) |
| `scheduled_at` | **No** — often `null` | Yes — `null` → level `'none'` |
| `driver_id` | Often `null` | **Not** an input to urgency logic |
| `linked_trip.scheduled_at` | Optional embed | **Not** used by urgency today; only for display / date prefill |

### Rows that should **never** get urgency styling

| Case | Behavior today | Correct? |
|------|----------------|----------|
| `scheduled_at` is `null` | `getUrgencyLevel` → `'none'` | Yes — nothing to be “due” |
| `status` cancelled/completed | Excluded from query | N/A |
| Invalid `scheduled_at` ISO | `getUrgencyLevel` → `'none'` | Yes |
| `scheduled_at` set, `driver_id` null | Urgency **does** apply | Yes — primary “needs dispatch” case |
| `scheduled_at` null, `driver_id` set | `'none'` | Yes — needs time, not time-urgency |
| Linked partner cancelled | Still active row; destructive badge shown | Urgency still applies if `scheduled_at` set — see collision note below |

**Conclusion:** No schema or hook changes required. `scheduled_at` + `status` on each row are sufficient for safe urgency styling.

---

## 4. What UI element should receive urgency styling?

### Row structure (`UnplannedTripRow`)

```257:257:src/features/dashboard/components/pending-tours-widget.tsx
    <div className='flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4'>
```

| Layer | Classes | Notes |
|-------|---------|-------|
| **Root container** | `flex flex-col … rounded-lg border p-3` | **Best attachment point** for `URGENCY_STYLES.rowClass` (`border-l-4` + tinted bg) |
| Left column | Trip info, badges, route | Rückfahrt / cancelled-partner / Termin badges |
| Right column | Date input, time input, driver `Select`, submit `Button` | Form controls `h-8` |

No `Card` wrapper on rows (outer widget uses `Card`). No `cn()` helper on the row today — plain string `className`.

### Styling options for implementation

| Option | Matches | Fits widget? |
|--------|---------|--------------|
| **A. Row `border-l` + bg** (`URGENCY_STYLES.rowClass`) | Fahrten table / mobile cards | Strong visual; works with existing `border` (left accent overrides weight) |
| **B. Time input chip** (`KANBAN_TIME_CHIP_CLASS`) | Kanban | Good if urgency should hug the editable time control; widget has separate date + time inputs |
| **C. Dot** (`UrgencyIndicator`) | Overview TripRow, Fahrten Zeit column | Minimal; no row border; aligns time column mentally |

User request targets **borders** → **Option A** is the closest canonical match.

---

## 5. Visual invariants and collision risks

### Existing semantics in `UnplannedTripRow`

| Element | Styling | Collision risk with urgency |
|---------|---------|----------------------------|
| **Rückfahrt** badge | `Badge variant='secondary'` | Low |
| **Cancelled partner** badge | `Badge variant='destructive'` + `AlertTriangle` | **Medium** — red urgency (`due`/`overdue`) + red destructive badge stack visually |
| **Termin** badge | `Badge variant='outline'` + calendar | Low |
| **Row shell** | Neutral `border` (all sides) | Low — `border-l-4 border-l-{color}` is the established pattern elsewhere |
| **Hover / selected** | None on row | None |
| **Dark mode** | Badges use theme tokens; row border default | `URGENCY_STYLES.rowClass` includes `dark:` variants |
| **Billing color** | Not used on this row (unlike overview `TripRow`) | None |
| **Responsive** | `flex-col` → `sm:flex-row` | Border-left works in both layouts |

### Peer widget invariant

`timeless-rule-trips-widget.tsx` uses the **identical** row shell (`rounded-lg border p-3 sm:flex-row …`). If pending tours gains urgency borders, consider whether timeless widget should follow later for dashboard consistency (out of scope for this audit).

### Fahrten table precedence rule

Grouped trips (`group_id` with count > 1) use **green** left border and **suppress** urgency row class. Pending tours has no grouping — no conflict.

---

## 6. Urgency behavior in this widget (scenario matrix)

Logic reference (`urgency-logic.ts`):

| Window | Level |
|--------|-------|
| > 30 min before | `none` |
| 10–30 min before | `upcoming` |
| 0–10 min before | `imminent` |
| 0–5 min after | `due` |
| 5–10 min after | `overdue` |
| > 10 min after | `none` |
| No / invalid `scheduled_at` | `none` |
| `cancelled` / `completed` | `none` |

### Scenarios specific to pending tours

| Scenario | In widget? | Urgency result | Business fit |
|----------|------------|----------------|--------------|
| **No scheduled time** | Yes (common) | `none` | Correct — urgency is time-based |
| **Scheduled time, no driver** | Yes (core case) | `upcoming` → `overdue` as time passes | **Good** — highlights dispatch gap |
| **Scheduled time + driver** | Only if other field still null (e.g. has driver but no time) | If only `scheduled_at` missing: `none`. If only `driver_id` missing: full urgency | Correct per field semantics |
| **Invalid `scheduled_at`** | Unlikely | `none` | Safe |
| **> 10 min past, still no driver** | Yes — row stays until planned | **`none`** after 10 min overdue | **Questionable for this widget** — trip remains “offen” but urgency **stops** alerting. May need widget-specific rule or urgency-logic extension |

### Widget-specific exception?

The global rule “hide urgency after 10 minutes overdue” suits **active dispatch** (Kanban / Fahrten list) where overdue trips are acted on or rescheduled elsewhere. **Offene Touren** is explicitly for trips **still missing planning**. A trip 30 minutes past with no driver is *more* operationally critical, not less.

**Recommendation:** Reuse standard logic for v1 consistency; if product feedback says overdue unassigned trips “go quiet,” add either:

- a `getUrgencyLevel` option (e.g. `overdueCap: 'none' | 'keep'`), or  
- a widget-only override that maps `overdue` → stays `overdue` (or new level) when `driver_id` is null.

Do **not** silently diverge without an explicit product decision.

---

## 7. Timezone and formatting pitfalls

### Urgency calculation

`getUrgencyLevel` uses `new Date(scheduledAt)` and `differenceInMinutes` against `new Date()` — compares **UTC instants**. Correct regardless of display TZ, as long as `scheduled_at` was stored via `buildScheduledAt*`.

### Display vs urgency in pending widget

| Code path | TZ behavior | Risk |
|-----------|-------------|------|
| `initialDate` | `parseScheduledAtOrFallback` → Berlin | OK |
| `initialTime` | `format(new Date(trip.scheduled_at), 'HH:mm')` | **Viewer-local**, not Berlin — can disagree with `parseScheduledAt` / Fahrten list |
| `linkedOutboundTime` | `format(new Date(...), …)` | Same local-display pattern |
| Tab filter `isToday` / `isThisWeek` in `use-unplanned-trips.ts` | Browser local calendar on parsed instant | **Berlin mismatch** near midnight (pre-existing; not introduced by urgency) |
| Urgency level | Instant-based | Consistent with stored ISO |

**Risk for urgency borders:** Low for level calculation; **medium** for dispatcher trust if the time input shows a different HH:mm than the instant urgency uses (non-Berlin browser). Fixing `initialTime` to `parseScheduledAtOrFallback(iso)?.hm` is orthogonal but recommended before or with urgency work.

**Do not** use `new Date(ymd)` or `toISOString().slice(0,10)` for urgency — widget write path already uses `buildScheduledAtOrNull` correctly.

---

## 8. Safest implementation path

### Recommended approach

**Reuse existing artifacts directly** — no new shared helper required for v1:

1. `useUrgencyLevel(trip.scheduled_at, trip.status)` inside `UnplannedTripRow` (live 10s updates).
2. `cn('…existing row classes…', URGENCY_STYLES[urgencyLevel].rowClass)` on the **root row `div`**.
3. Optional: wrap row or time input in `Tooltip` with `getUrgencyTranslation(urgencyLevel).label` when `urgencyLevel !== 'none'` (Kanban/table pattern).

### Do **not**

- Copy Tailwind color strings into the widget.
- Call bare `getUrgencyLevel` without the hook (borders would freeze until refetch).
- Use `UrgencyIndicator` dot **instead of** row border if the goal is parity with Fahrten **row** styling (dot is complementary, not equivalent).

### Optional follow-up (not blocking)

Extract `getUrgencyRowClassName(level: UrgencyLevel): string` in `urgency-config.ts` to DRY `trips-tables/index.tsx` and the widget — only if touching both in the same PR.

### Kanban chip pattern?

Valid if product wants urgency only on the **time input**, not the whole row. Less aligned with “border on pending tour row” ask and duplicates Kanban semantics on a two-field (date+time) form.

---

## 9. Likely file changes (implementation)

### Definitely required

| File | Change |
|------|--------|
| `src/features/dashboard/components/pending-tours-widget.tsx` | Import `useUrgencyLevel`, `URGENCY_STYLES`, optionally `getUrgencyTranslation` + `Tooltip`; apply `rowClass` on root div |

### Likely required

| File | Change |
|------|--------|
| `docs/urgency-indicator.md` | Add “Offene Touren widget” to consumers list |

### Optional / same PR if desired

| File | Change |
|------|--------|
| `src/features/trips/constants/urgency-config.ts` | Small `getUrgencyRowClassName` helper |
| `src/features/trips/components/trips-tables/index.tsx` | Switch to helper + `useUrgencyLevel` (fix static row issue) |
| `src/features/trips/lib/urgency-logic.ts` | Only if product changes >10 min overdue behavior for unassigned trips |

### Should remain untouched

| File | Reason |
|------|--------|
| `use-unplanned-trips.ts` | Data already sufficient |
| `urgency-indicator.tsx` | No change unless adding dot alongside border |
| `trip-time.ts` / `trip-business-date.ts` | Unless fixing `initialTime` display separately |
| `timeless-rule-trips-widget.tsx` | Different product surface (no `scheduled_at` on timeless legs) |
| `query/keys/*` | No new cache keys |

---

## 10. Tests and documentation

### Existing coverage

| Asset | Coverage |
|-------|----------|
| `docs/urgency-indicator.md` | Timing windows, variants, Kanban chip, dot usage |
| `docs/kanban-view.md` | Kanban urgency chip |
| `docs/plans/dashboard-mobile-widget-audit.md` | Row structure; notes `UrgencyIndicator` on TripRow, **not** on pending widget |
| `docs/plans/cancelled-trips-invoice-audit.md` | Mentions urgency excludes cancelled/completed |

### Gaps

| Gap | Priority |
|-----|----------|
| **No unit tests** for `getUrgencyLevel` (window boundaries, >10 min overdue, invalid dates) | High if logic ever changes |
| **No component test** for pending widget urgency classes | Medium |
| **No visual regression** for destructive badge + red urgency border | Low |
| **Fahrten table row** static urgency (no hook) | Pre-existing; document if fixing |

---

## Senior recommendation

### Should we reuse existing urgency UI exactly or extract a helper first?

**Reuse existing UI exactly** — `useUrgencyLevel` + `URGENCY_STYLES[rowClass]` on the row root — **without** a new shared helper in the first PR. The config map is already the row-border source of truth; a helper is a nice DRY follow-up, not a prerequisite.

If the product also wants a dot or tooltip, add `UrgencyIndicator` or `Tooltip` as a **second** element; do not fork colors.

### Main implementation risks

1. **> 10 min overdue → `none`** while the trip remains in Offene Touren — may feel like the UI “gives up” on the worst rows.  
2. **Red stacking** — `due`/`overdue` row accent + `variant='destructive'` cancelled-partner badge.  
3. **Frozen borders** if implementer uses `getUrgencyLevel` without `useUrgencyLevel`.  
4. **Time display drift** — `format(new Date(iso), 'HH:mm')` vs Berlin-based urgency (pre-existing).  
5. **Pulse animation** on `overdue` row class inside a dense dashboard card — verify `prefers-reduced-motion` / visual noise.

### Smallest safe next step

In `UnplannedTripRow` only:

1. Add `const urgencyLevel = useUrgencyLevel(trip.scheduled_at, trip.status)`.  
2. Merge `URGENCY_STYLES[urgencyLevel].rowClass` onto the existing root `div` via `cn()`.  
3. Manually verify one row per level in the browser (or story) with a trip that has `scheduled_at` set and `driver_id` null.  
4. Confirm with product whether >10 min overdue unassigned trips should stay hot; defer logic changes unless they say yes.

No hook, service, or migration changes required for step 1–3.
