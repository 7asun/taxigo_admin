# v5a-1: TZ Display Consistency Fix

Date: 2026-06-25

## Gap 1 — Detail sheet date + time draft

**Root cause:** `format(new Date(scheduled_at), …)` uses UTC calendar components (or runtime-local hm). Near Berlin midnight, UTC civil day ≠ Berlin civil day — wrong date prefill in a write-back field (`dateYmdDraft` → `buildTripDetailsPatch`).

**Fix:** `parseScheduledAtOrFallback` for ymd (date init + `currentDateYmd`) and hm (time draft init). Parts B+C+D applied atomically so `detailsDirty` baseline matches draft on open.

**File:** [`src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx`](../src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx)

**Status:** DONE

## Gap 2 — Driver portal `formatTime`

**Root cause:** `toLocaleTimeString('de-DE', …)` without `timeZone` uses device OS TZ — wrong on non-Berlin devices.

**Fix:** `parseScheduledAtOrFallback(iso)?.hm ?? '--:--'`

**Files:**

- [`src/features/driver-portal/components/shared/driver-trip-card.tsx`](../src/features/driver-portal/components/shared/driver-trip-card.tsx)
- [`src/features/driver-portal/components/shift-history-row.tsx`](../src/features/driver-portal/components/shift-history-row.tsx)

**Status:** DONE

## Deferred to v5a-2

- `formatDate` in `shift-history-row.tsx` (L25–30)
- `linked-partner-callout.tsx`
- Kanban, mobile list, widgets, print, share-utils, overview trip-row, passenger-search-overlay

### Detail sheet date-init effect deps (L498–566) — by design, not a bug

The date draft useEffect (L498–566) is the master re-initialisation effect for the entire detail sheet. On each run it resets ~20 draft fields: payer, billing, addresses, client, KTS/reha, wheelchair, route state, and dateYmdDraft.

Its dependency array lists only `trip?.id` and the five KTS/reha fields (`trip?.kts_document_applies` etc.). `trip.scheduled_at` and `trip.requested_date` are absent.

This is intentional product behaviour: once a trip is open, live server updates to schedule, address, payer, and client fields do NOT reset what the dispatcher is currently editing. Only a trip identity change or a KTS correction triggers a full re-initialisation. Adding `trip.scheduled_at` to this array would cause all 20 draft fields to reset on every schedule update — including any unsaved address or payer edits.

The time draft has its own separate effect `[isOpen, trip?.id, trip?.scheduled_at]` which correctly re-syncs `timeDraft` on schedule change. The same pattern could be applied to `dateYmdDraft` in a dedicated two-line effect if the product ever requires live date re-sync without a full form reset. That is a separate design decision, not a v5a item.

Staleness risk: if `scheduled_at` changes on the server while the sheet is open, `dateYmdDraft` does not re-sync until the trip is reopened or `trip.id` changes. This same risk applies to all other fields in the effect (addresses, payer, client) and predates v5a-1.

Status: accepted constraint — no action.

See [v5-tz-audit.md](./v5-tz-audit.md).
