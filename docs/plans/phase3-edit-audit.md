# Phase 3 — Trip Edit Price Recalculation Audit

> Date: 2026-04-19  
> Scope: Every `trips` table UPDATE path in the codebase.  
> Purpose: Determine which paths write pricing-relevant fields and must be wired for price recalculation.

---

## Q1 — How many distinct update paths exist?

### Paths that write pricing-relevant fields (need wiring)

| File | Function | Layer | Pricing-relevant fields written |
|------|----------|-------|---------------------------------|
| `src/features/trips/api/trips.service.ts` | `updateTrip(id, trip)` | Service (central) | Any — accepts arbitrary `UpdateTrip` patch; covers all `tripsService.updateTrip` callers |
| `src/features/trips/trip-reschedule/api/reschedule.actions.ts` | `rescheduleTripWithOptionalPair` | Direct Supabase (`createClient`) | `scheduled_at` |
| `src/features/trips/components/bulk-upload/resolve-clients-step.tsx` | `handleCreateAndLinkClient` | Direct Supabase (`createClient`) | `client_id`, `pickup_lat`, `pickup_lng`, `dropoff_lat`, `dropoff_lng` |
| `src/features/unassigned-trips/api/unassigned-trips.service.ts` | `assignBillingVariant` | Direct Supabase (`createClient`) | `billing_variant_id` (batch) |
| `scripts/backfill-driving-distance.ts` | `main` loop | Direct Supabase (service-role) | `driving_distance_km` |

### Paths that write only non-pricing fields (no wiring needed)

| File | Function | Fields written |
|------|----------|----------------|
| `src/features/trips/api/recurring-exceptions.actions.ts` | `cancelNonRecurringTrip`, `skipRecurringOccurrence`, `skipRecurringOccurrenceAndPaired`, `cancelRecurringSeries` | `status`, `canceled_reason_notes` |
| `src/features/trips/components/trips-tables/driver-select-cell.tsx` | `handleChange` | `driver_id`, `status` |
| `src/features/trips/api/trip-hard-delete.ts` | `hardDeleteTripsByIds` | `linked_trip_id` (link clearing) |
| `src/features/trips/lib/duplicate-trips.ts` | `executeDuplicateTrips` | `linked_trip_id`, `link_type` (post-insert backfill) |
| `src/app/api/cron/generate-recurring-trips/route.ts` | `GET` handler | `linked_trip_id`, `link_type` (post-insert backfill) |
| `src/features/trips/components/bulk-upload-dialog.tsx` | `processCsv` complete callback | `linked_trip_id`, `link_type` (post-insert backfill) |
| `src/features/driver-portal/api/driver-trips.service.ts` | `startTrip`, `cancelTrip`, `completeTrip` | `status`, `actual_pickup_at`, `actual_dropoff_at`, `shift_id`, `notes` |

---

## Q2 — Full updated trip object or partial patch?

All update paths use partial patches. No path passes a full trip object to the update call. The central service `updateTrip` receives `trip: UpdateTrip` which is `Database['public']['Tables']['trips']['Update']` — a fully optional type.

---

## Q3 — Current stored trip row in scope?

| Path | Row in scope? | Detail |
|------|---------------|--------|
| `tripsService.updateTrip` | No | Only `id` and the patch are available |
| `rescheduleTripWithOptionalPair` | Yes | `primary: Trip` and `paired: Trip` are full row objects fetched earlier in the function |
| `handleCreateAndLinkClient` | No | Only `current.tripId` is available; full row is not fetched |
| `assignBillingVariant` | No | Only `tripIds: string[]` is available |
| `backfill-driving-distance.ts` | Partial | The `trip` object from the batch select includes `id`, `company_id`, and coordinate fields — but not `payer_id`, `billing_type_id`, `billing_variant_id`, `client_id`, `scheduled_at`, `kts_document_applies` |

Note: Per the spec's hard rule, `resolveTripForPricing` always fetches from the DB even when the row is in scope, to guarantee the merge uses the latest committed state.

---

## Q4 — Single central updateTrip function?

Yes. `tripsService.updateTrip` in `src/features/trips/api/trips.service.ts` is the central function. All React Query hooks and component-level callers go through it:

- `src/features/trips/hooks/use-update-trip-mutation.ts` → `tripsService.updateTrip`
- `src/features/trips/lib/create-linked-return.ts` → `tripsService.updateTrip`
- `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` → `tripsService.updateTrip` (driver, notes, details, linked-partner patches)
- `src/features/trips/components/kanban/kanban-board.tsx` → `tripsService.updateTrip`
- `src/features/trips/components/pending-assignments/use-pending-assignments.ts` → `tripsService.updateTrip`
- `src/features/dashboard/components/pending-tours-widget.tsx` → `tripsService.updateTrip`
- `src/features/dashboard/components/timeless-rule-trips-widget.tsx` → `tripsService.updateTrip`
- `src/features/fremdfirmen/components/trip-fremdfirma-section.tsx` → `tripsService.updateTrip`

Wiring `updateTrip` once covers all of the above. Four additional paths write directly to Supabase and must be wired independently.

---

## Q5 — Existing guards for completed or invoiced trips?

`rescheduleTripWithOptionalPair` (`reschedule.actions.ts` lines 52–60) has two guards:

```typescript
if (isRecurringTrip(primary)) {
  return { ok: false, error: 'Recurring trips cannot be rescheduled in this version.' };
}
if (!canRescheduleTrip(primary)) {
  return { ok: false, error: 'This trip cannot be rescheduled.' };
}
```

Price recalculation must sit after both guards and before each `supabase.from('trips').update(...)` call. If the trip cannot be rescheduled the function returns early before any DB write — no recalculation should occur in that case.

No guard exists in `tripsService.updateTrip`. The service is a thin wrapper and delegates guard logic to callers.

No guards were found in the other three direct paths.

---

## Q6 — Is company_id available in each update path?

| Path | company_id source |
|------|------------------|
| `tripsService.updateTrip` | Not passed to the service; fetched by `resolveTripForPricing` from the current row |
| `rescheduleTripWithOptionalPair` | `primary.company_id` (full row in scope); also fetched by `resolveTripForPricing` |
| `handleCreateAndLinkClient` | `companyIdStr` is fetched earlier in the function (from `accounts` table via the authed user); also fetched by `resolveTripForPricing` |
| `assignBillingVariant` | Not in scope; fetched by `resolveTripForPricing` per trip |
| `backfill-driving-distance.ts` | `company_id` is in the batch select result (`trip.company_id`); also fetched by `resolveTripForPricing` |

In all cases `resolveTripForPricing` provides `company_id` from the current DB row, so callers do not need to pass it explicitly.
