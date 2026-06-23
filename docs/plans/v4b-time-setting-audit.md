# v4b: Time-Setting Entry Points — Read-Only Audit

**Date:** 2026-06-23  
**Scope:** UI/cache only — every `src/` path that can **write** `scheduled_at` on an existing trip row, plus widget query filters and invalidation contract.  
**Out of scope:** `src/lib/recurring-trip-generator.ts` (cron), trip **INSERT** paths unless noted.

**Note on repo state:** This audit reads files **as they exist on disk** (working tree). Several invalidation fixes (`invalidate-after-trip-save.ts`, detail-sheet `refreshAfterTripSave` options, `useUpdateTripMutation.onSettled` migration) are **present in the working tree but not committed to `HEAD`**. Where relevant, §1 calls out the **committed baseline bug** vs **working-tree state**.

---

## 1. All scheduled_at write entry points

### Summary table (UPDATE paths — primary v4b scope)

| # | File | Function / component | Save mechanism | Invalidates after save | `unplannedRoot`? | `timelessRuleTripsRoot`? | Missing either? |
|---|------|---------------------|----------------|------------------------|------------------|--------------------------|-----------------|
| 1 | `src/features/dashboard/components/pending-tours-widget.tsx` | `UnplannedTripRow.handleSetTime` | `tripsService.updateTrip` | `invalidateAfterTripSave` (`includePlanningWidgets: true`) | Yes | Yes | No |
| 2 | `src/features/dashboard/components/timeless-rule-trips-widget.tsx` | `TimelessRulePairRow.handleSave` | `tripsService.updateTrip` (per leg) | `invalidateAfterTripSave` (`includePlanningWidgets: true`) | Yes | Yes | No |
| 3 | `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` | `handleSaveTripDetails` → `buildTripDetailsPatch` → `applyDetailsPatch` | `useUpdateTripMutation` → `tripsService.updateTrip` | `useUpdateTripMutation.onSettled` + `refreshAfterTripSave({ includePlanningWidgets: 'auto', patch })` | Yes (when patch touches `scheduled_at`) | Yes (same) | **HEAD: Yes** — committed code calls `refreshAfterTripSave()` with no options and mutation `onSettled` only busts `detail` + `all`. **WT: fixed** for this path |
| 4 | Same | `handleDriverChange` | Direct `tripsService.updateTrip` | `refreshAfterTripSave({ includePlanningWidgets: 'auto', patch })` | Only if patch has planning keys (driver yes; time no) | Same | No for driver-only; N/A for time |
| 5 | Same | `TripRescheduleDialog` (embedded) | `rescheduleTripWithOptionalPair` → Supabase `.update` | Dialog `handleSubmit` → `invalidateAfterTripSave` (`includePlanningWidgets: true`) | Yes | Yes | No |
| 6 | `src/features/trips/trip-reschedule/api/reschedule.actions.ts` | `rescheduleTripWithOptionalPair` | Supabase `.from('trips').update(primaryPatch\|partnerPatch)` | Caller-owned (dialog above) | Via caller | Via caller | N/A (library) |
| 7 | `src/features/trips/trip-reschedule/components/trip-reschedule-dialog.tsx` | `handleSubmit` | Calls #6 | `invalidateAfterTripSave` (`includePlanningWidgets: true`, `includeTripList: false`) | Yes | Yes | No |
| 8 | `src/features/trips/components/kanban/kanban-trip-card.tsx` | `commitTimeToStore` → `onTimeChange` | **Staged only** — persisted in board `handleSave` | N/A until save | N/A | N/A | N/A |
| 9 | `src/features/trips/components/kanban/kanban-board.tsx` | `handleSave` | `tripsService.updateTrip` (batch) | `invalidateAfterTripSave` (`includePlanningWidgets: 'auto'`, `includeTripList: false`) + `refreshTripsPage()` | Yes when payload includes `scheduled_at` | Yes (same) | No |
| 10 | `src/features/trips/components/pending-assignments/use-pending-assignments.ts` | `handleAssign` | `tripsService.updateTrip` | `invalidateAfterTripSave` (`includePlanningWidgets: 'auto'`) | Yes when `timeString` sets `scheduled_at` | Yes (same) | No |
| 11 | `src/features/trips/hooks/use-update-trip-mutation.ts` | `onSettled` (all mutation consumers) | `tripsService.updateTrip` | `invalidateAfterTripSave` (`includePlanningWidgets: 'auto'`, `includeTripList: true`) | Yes when patch has planning keys | Yes (same) | **HEAD: Yes** — only `detail` + `all`. **WT: fixed** via helper |
| 12 | `src/features/trips/trip-detail-sheet/hooks/use-trip-detail-save-refresh.ts` | `refreshAfterTripSave` | Invalidation only (after write elsewhere) | Forwards to `invalidateAfterTripSave` with `includeTripList: false` | Caller-supplied | Caller-supplied | **Yes when callers omit options** — see §7 |
| 13 | `src/features/trips/api/recurring-rules.actions.ts` | `resyncFutureRecurringTrips` | Supabase batch `.update({ scheduled_at: newAt })` | Client callers only | Via caller | Via caller | N/A (server action) |
| 14 | `src/features/clients/components/recurring-rule-panel.tsx` | Rule update success when `resynced > 0` | Calls #13 | `invalidateAfterTripSave({ includePlanningWidgets: true })` | Yes | Yes | No |
| 15 | `src/features/clients/components/recurring-rule-sheet.tsx` | Same as #14 | Same | Same | Yes | Yes | No |

### Paths that build `scheduled_at` but do not UPDATE existing rows (secondary)

| File | Notes |
|------|--------|
| `src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts` | Pure patch builder; can set/clear `scheduled_at` — persisted only via #3 |
| `src/features/trips/components/create-trip/create-trip-form.tsx` | **INSERT** via `tripsService.createTrip` — new rows, not v4b update contract |
| `src/features/trips/components/bulk-upload-dialog.tsx` | **INSERT** bulk trips |
| `src/features/trips/lib/create-linked-return.ts` + `create-return-trip-dialog.tsx` | **INSERT** return leg; outbound patch is `linked_trip_id` / `link_type` only |
| `src/lib/recurring-trip-generator.ts` | Cron INSERT/UPDATE — **explicitly out of scope** |

### Paths that do **not** write `scheduled_at`

| File | Why listed in search |
|------|---------------------|
| `src/features/fremdfirmen/components/trip-fremdfirma-section.tsx` | `fremdfirma_id` / payment fields only |
| `src/features/trips/hooks/use-widget-trip-assignment.ts` | `driver_id` via `buildAssignmentPatch` only |
| Kanban `handleDragEnd` (driver/status/payer/group) | Stages non-time fields |
| `src/features/trips/components/trips-filters-bar.tsx` | URL filter param `scheduled_at`, not DB column |

---

### Verbatim: widget saves (correct reference behaviour)

**Pending tours — `handleSetTime`:**

```226:265:src/features/dashboard/components/pending-tours-widget.tsx
  const handleSetTime = async () => {
    if (!time) {
      toast.error('Bitte geben Sie eine Abholzeit ein.');
      return;
    }

    try {
      setIsSubmitting(true);
      // WHY trip-time.ts (not `new Date(dateStr)` + `set`): server/client TZ mixes mis-store `scheduled_at`.
      let scheduledAtIso: string;
      try {
        const iso = buildScheduledAtOrNull(dateStr, time);
        if (!iso) {
          toast.error('Bitte Datum und Uhrzeit vollständig angeben.');
          return;
        }
        scheduledAtIso = iso;
      } catch (err) {
        if (err instanceof TripTimeError) {
          toast.error(err.message || 'Ungültige Datum/Uhrzeit.');
          return;
        }
        throw err;
      }

      const updatePayload: Parameters<typeof tripsService.updateTrip>[1] = {
        scheduled_at: scheduledAtIso
      };
      Object.assign(
        updatePayload,
        buildAssignmentPatch(trip, { driver_id: driverId })
      );

      await tripsService.updateTrip(trip.id, updatePayload);

      await invalidateAfterTripSave(queryClient, {
        tripIds: [trip.id],
        patch: updatePayload,
        includePlanningWidgets: true
      });
```

**Timeless rule widget — `handleSave`:**

```114:130:src/features/dashboard/components/timeless-rule-trips-widget.tsx
        await tripsService.updateTrip(e.trip.id, {
          scheduled_at: scheduledAtIso
        });

        savedLegs.push({
          tripId: e.trip.id,
          patch: { scheduled_at: scheduledAtIso }
        });
      }

      if (savedLegs.length > 0) {
        await invalidateAfterTripSave(queryClient, {
          tripIds: savedLegs.map((leg) => leg.tripId),
          patch: savedLegs.map((leg) => leg.patch),
          includePlanningWidgets: true
        });
      }
```

---

### Verbatim: trip detail sheet — time patch builder

```214:275:src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts
  if (input.dateYmdDraft !== input.currentDateYmd) {
    if (trip.scheduled_at && input.dateYmdDraft && input.timeDraft) {
      // WHY `buildScheduledAt`: same Berlin-wall contract as Neue Fahrt / cron — not browser-local Date.
      patch.scheduled_at = buildScheduledAt(
        input.dateYmdDraft,
        input.timeDraft
      );
    } else if (
      !trip.scheduled_at &&
      input.dateYmdDraft &&
      input.timeDraft?.trim()
    ) {
      patch.scheduled_at = buildScheduledAt(
        input.dateYmdDraft,
        input.timeDraft
      );
      patch.requested_date = null;
    } else if (input.dateYmdDraft && !trip.scheduled_at) {
      patch.requested_date = input.dateYmdDraft;
    }
  }

  if (
    !trip.scheduled_at &&
    trip.requested_date &&
    input.dateYmdDraft &&
    input.timeDraft?.trim() &&
    input.dateYmdDraft === input.currentDateYmd &&
    !('scheduled_at' in patch)
  ) {
    patch.scheduled_at = buildScheduledAt(input.dateYmdDraft, input.timeDraft);
    patch.requested_date = null;
  }

  if (
    trip.scheduled_at &&
    input.dateYmdDraft &&
    input.dateYmdDraft === input.currentDateYmd &&
    input.timeDraft?.trim() &&
    !('scheduled_at' in patch)
  ) {
    const { ymd } = parseScheduledAt(trip.scheduled_at);
    const nextIso = buildScheduledAt(ymd, input.timeDraft);
    if (nextIso !== new Date(trip.scheduled_at).toISOString()) {
      patch.scheduled_at = nextIso;
    }
  }

  // WHY: Clearing the time field is a valid user intent — it moves the trip from a timed
  // state to date-only / "offen" state ...
  if (
    trip.scheduled_at &&
    !input.timeDraft.trim() &&
    !('scheduled_at' in patch)
  ) {
    patch.scheduled_at = null;
    patch.requested_date =
```

**Detail sheet save + refresh (working tree):**

```782:876:src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx
        await updateTripMutation.mutateAsync({
          id: trip.id,
          patch: currentPatch as UpdateTrip
        });
        let savedPartnerPatch: UpdateTrip | undefined;
        if (syncPartner && linkedPartner) {
          // ... partner patch build ...
          await updateTripMutation.mutateAsync({
            id: linkedPartner.id,
            patch: partnerPatch as UpdateTrip
          });
          savedPartnerPatch = partnerPatch as UpdateTrip;
        }
        toast.success(
          syncPartner && linkedPartner
            ? 'Beide Fahrten aktualisiert'
            : 'Fahrt aktualisiert'
        );
        if (syncPartner && linkedPartner && savedPartnerPatch) {
          await refreshAfterTripSave({
            tripIds: [trip.id, linkedPartner.id],
            patch: [currentPatch as UpdateTrip, savedPartnerPatch],
            includePlanningWidgets: 'auto'
          });
        } else {
          await refreshAfterTripSave({
            tripIds: [trip.id],
            patch: [currentPatch as UpdateTrip],
            includePlanningWidgets: 'auto'
          });
        }
```

**Committed baseline (`HEAD`) for the same path:**

```typescript
// HEAD: trip-detail-sheet.tsx ~868
await refreshAfterTripSave(); // no tripIds, no patch, no includePlanningWidgets

// HEAD: use-update-trip-mutation.ts onSettled
onSettled: (_data, _err, { id }) => {
  void queryClient.invalidateQueries({ queryKey: tripKeys.detail(id) });
  void queryClient.invalidateQueries({ queryKey: tripKeys.all });
}
```

This is the **root cause** of the reported bug: detail-sheet time saves persist correctly but **do not bust** `tripKeys.unplannedRoot` or `tripKeys.timelessRuleTripsRoot` on `HEAD`.

---

### Verbatim: central invalidation helper (working tree)

```9:82:src/features/trips/lib/invalidate-after-trip-save.ts
export const PLANNING_WIDGET_PATCH_KEYS = [
  'scheduled_at',
  'requested_date',
  'status',
  'driver_id',
  'fremdfirma_id',
  'rule_id',
  'linked_trip_id',
  'link_type'
] as const satisfies readonly (keyof UpdateTrip)[];

export function doesPatchAffectPlanningWidgets(
  patch: Partial<UpdateTrip>
): boolean {
  return PLANNING_WIDGET_PATCH_KEYS.some((key) => key in patch);
}

export async function invalidateAfterTripSave(
  queryClient: QueryClient,
  options: InvalidateAfterTripSaveOptions = {}
): Promise<void> {
  // ...
  if (shouldInvalidatePlanningWidgets) {
    void queryClient.invalidateQueries({ queryKey: tripKeys.unplannedRoot });
    void queryClient.invalidateQueries({
      queryKey: tripKeys.timelessRuleTripsRoot
    });
  }
}
```

---

### Verbatim: reschedule (sets or clears `scheduled_at`)

```28:43:src/features/trips/trip-reschedule/api/reschedule.actions.ts
function rowFromLeg(leg: LegScheduleInput): {
  scheduled_at: string | null;
  requested_date: string | null;
} {
  if (leg.scheduledAt) {
    return {
      scheduled_at: leg.scheduledAt.toISOString(),
      requested_date: null
    };
  }
  return {
    scheduled_at: null,
    requested_date: leg.requestedDate?.trim() || null
  };
}
```

```297:305:src/features/trips/trip-reschedule/components/trip-reschedule-dialog.tsx
      await invalidateAfterTripSave(queryClient, {
        tripIds: paired ? [trip.id, paired.id] : [trip.id],
        patch: paired
          ? [legToPatch(primaryLeg), legToPatch(partnerLeg!)]
          : legToPatch(primaryLeg),
        includePlanningWidgets: true,
        includeTripList: false
      });
```

---

### Verbatim: kanban time staging + save

**Inline time input (staged, not immediate DB write):**

```199:220:src/features/trips/components/kanban/kanban-trip-card.tsx
        onTimeChange(trip.id, buildScheduledAt(ymd, value));
      } catch (e) {
        if (e instanceof TripTimeError) {
          toast.error(e.message);
          return;
        }
        throw e;
      }
    },
    [scheduledAt, trip.id, trip.requested_date, onTimeChange]
  );

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setTimeValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!next) return;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      commitTimeToStore(next);
    }, 900);
  };
```

**Persist on board Save:**

```500:545:src/features/trips/components/kanban/kanban-board.tsx
  const handleSave = useCallback(async () => {
    if (Object.keys(pendingChanges).length === 0) return;
    setIsSaving(true);
    try {
      const entries = Object.entries(pendingChanges).map(([id, change]) => {
        const trip = trips.find((t) => t.id === id);
        const payload: Parameters<typeof tripsService.updateTrip>[1] = {};
        // ...
        if (change.scheduled_at !== undefined)
          payload.scheduled_at = change.scheduled_at;
        // ...
        return { id, payload };
      });

      await Promise.all(
        entries.map(({ id, payload }) => tripsService.updateTrip(id, payload))
      );

      await invalidateAfterTripSave(queryClient, {
        tripIds: entries.map((e) => e.id),
        patch: entries.map((e) => e.payload),
        includePlanningWidgets: 'auto',
        includeTripList: false
      });
      await refreshTripsPage();
      clearPendingChanges();
```

---

### Verbatim: pending-assignments inbox

```283:302:src/features/trips/components/pending-assignments/use-pending-assignments.ts
      if (timeString) {
        try {
          updates.scheduled_at = buildScheduledAt(tripDate, timeString);
        } catch (e) {
          if (e instanceof TripTimeError) {
            toast.error(e.message);
            return;
          }
          throw e;
        }
      }

      await tripsService.updateTrip(tripId, updates);

      await invalidateAfterTripSave(queryClient, {
        tripIds: [tripId],
        patch: updates,
        includePlanningWidgets: 'auto'
      });
```

---

### Verbatim: recurring rule batch resync

```231:240:src/features/trips/api/recurring-rules.actions.ts
  // 4. Batch update: one UPDATE per unique scheduled_at value, chunked to 500 IDs per call
  for (const [newAt, ids] of updatesByScheduledAt) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { error: updateError } = await ctx.supabase
        .from('trips')
        .update({ scheduled_at: newAt })
        .in('id', chunk);
```

---

## 2. tripKeys structure (verbatim)

From `src/query/keys/trips.ts`:

```9:55:src/query/keys/trips.ts
export const tripKeys = {
  all: ['trips'] as const,

  /** Single trip row (matches `getTripById` joins). */
  detail: (tripId: string) => ['trips', 'detail', tripId] as const,

  /**
   * Prefix for all unplanned-trip list queries — use with `invalidateQueries` after a
   * trip write from the widget (or Supabase realtime) so every tab’s cache refetches.
   */
  unplannedRoot: ['trips', 'unplanned'] as const,

  /** One cache entry per dashboard filter tab (`useUnplannedTrips`). */
  unplanned: (filter: UnplannedTripsFilter) =>
    ['trips', 'unplanned', filter] as const,

  /**
   * Prefix for all timeless recurring-rule trips queries — used to refresh the widget
   * after any trip write that could assign a time to a rule-generated leg.
   */
  timelessRuleTripsRoot: ['trips', 'timeless-rules'] as const,

  /** Berlin `requested_date` window: today + tomorrow (`useTimelessRuleTrips`). */
  timelessRuleTrips: (todayYmd: string, tomorrowYmd: string) =>
    ['trips', 'timeless-rules', todayYmd, tomorrowYmd] as const,

  /**
   * Deferred invoice badge data for the Fahrten list (sorted IDs → stable React Query key).
   * Invalidated with `tripKeys.all` when RSC/list refreshes.
   */
  invoiceStatuses: (tripIds: string[]) =>
    [...tripKeys.all, 'invoiceStatuses', tripIds.slice().sort()] as const,

  /** Per-trip KTS correction rounds (detail timeline — PR2.1). */
  ktsCorrections: (tripId: string) =>
    [...tripKeys.all, 'kts_corrections', tripId] as const,

  /** Per-trip KTS document status (PR3.2 page — reserved). */
  ktsStatus: (tripId: string) =>
    [...tripKeys.detail(tripId), 'kts-status'] as const,

  /**
   * Company-scoped Fahrten “Ansichten” presets (RLS). No company id in key —
   * tenant is implicit from the session.
   */
  presets: () => [...tripKeys.all, 'presets'] as const
};
```

### Which keys each entry point invalidates (working tree)

| Entry point | `detail` | `all` | `unplannedRoot` | `timelessRuleTripsRoot` | Other |
|-------------|----------|-------|-----------------|-------------------------|-------|
| Pending tours widget | ✓ (via helper) | ✓ (default) | ✓ (`true`) | ✓ | — |
| Timeless widget | ✓ | ✓ | ✓ | ✓ | — |
| Detail sheet `applyDetailsPatch` | ✓ (mutation + refresh) | ✓ (mutation `onSettled`; refresh skips `all`) | ✓ (`auto` + patch) | ✓ | RSC `router.refresh` / `refreshTripsPage` |
| Detail sheet `handleDriverChange` | ✓ | ✓ (overview) or RSC | ✓ if patch has `driver_id` | ✓ (same) | — |
| Detail sheet `applyNotesSave` | ✓ (mutation) | ✓ | ✗ (no options) | ✗ | Notes-only — OK |
| `TripFremdfirmaSection` → `onAfterSave()` | partial (section invalidates `detail` only) | ✗ / RSC only | ✗ unless caller passes patch | ✗ | Fremdfirma affects widgets via `fremdfirma_id` — gap |
| `useUpdateTripMutation` consumers | ✓ | ✓ | ✓ (`auto`) | ✓ | — |
| Kanban `handleSave` | ✓ | ✗ (`includeTripList: false`) | ✓ (`auto`) | ✓ | RSC refresh |
| Pending assignments | ✓ | ✓ | ✓ (`auto`) | ✓ | Local state / `load()` |
| Reschedule dialog | ✓ | ✗ | ✓ (`true`) | ✓ | RSC refresh |
| Recurring rule resync | ✗ (no trip ids) | ✗ | ✓ (`true`) | ✓ | — |
| `use-widget-trip-assignment` | ✗ | ✓ only | ✗ | ✗ | Driver-only — widget gap for assignment |

---

## 3. useUnplannedTrips + useTimelessRuleTrips filters

### useUnplannedTrips

**Query key:** `tripKeys.unplanned(filter)` where `filter ∈ 'today' | 'week' | 'all'`.

**Server-side Supabase filter** (`fetchUnplannedTrips`):

```49:55:src/features/dashboard/hooks/use-unplanned-trips.ts
  const { data: unplannedRows, error: fetchError } = await supabase
    .from('trips')
    .select(`*, requested_date, ${ASSIGNEE_JOIN_FRAGMENT}`)
    // Fremdfirma rows have driver_id null — only count as unplanned when both assignee FKs are null.
    .or('scheduled_at.is.null,and(driver_id.is.null,fremdfirma_id.is.null)')
    .not('status', 'in', '("cancelled","completed")')
    .order('created_at', { ascending: false });
```

**Client-side filter:** Tab date window (`today` / `week` / `all`) applied after fetch using `scheduled_at`, linked partner `scheduled_at`, or `requested_date` as the calendar anchor:

```100:113:src/features/dashboard/hooks/use-unplanned-trips.ts
  const filtered =
    filter === 'all'
      ? withLinked
      : withLinked.filter((trip) => {
          const dateStr =
            trip.scheduled_at ??
            trip.linked_trip?.scheduled_at ??
            (trip.requested_date ? `${trip.requested_date}T12:00:00` : null);
          if (!dateStr) return false;
          const date = new Date(dateStr);
          if (filter === 'today') return isToday(date);
          if (filter === 'week') return isThisWeek(date);
          return true;
        });
```

**Hybrid:** Server narrows to “no time **OR** no internal assignee”; client narrows by tab date.

**Trip disappears on refetch when:**

- `scheduled_at` is set **and** (`driver_id` or `fremdfirma_id` is set) — row no longer matches server `.or(...)`.
- **Time-only save without driver:** row **stays** in Offene Touren (by design — “ohne Fahrer” bucket).
- Status → `cancelled` / `completed`.
- Tab filter excludes the trip’s effective date.

**Realtime:** Debounced invalidation of `tripKeys.unplannedRoot` on any `trips` postgres change.

---

### useTimelessRuleTrips

**Query key:** `tripKeys.timelessRuleTrips(todayYmd, tomorrowYmd)` — Berlin today + tomorrow.

**Server-side filter only** (no client tab filter beyond payer dropdown in widget UI):

```107:113:src/features/dashboard/hooks/use-timeless-rule-trips.ts
  const { data: rowsRaw, error } = await supabase
    .from('trips')
    .select(`*, requested_date, ${TIMELESS_TRIP_EMBEDS}`)
    .not('rule_id', 'is', null)
    .is('scheduled_at', null)
    .in('requested_date', [todayYmd, tomorrowYmd])
    .not('status', 'in', '("cancelled","completed")');
```

**Hybrid:** Fetch is server-side; pairing outbound/return and payer filter are client-side.

**Trip disappears on refetch when:**

- `scheduled_at` becomes non-null (primary v4b case).
- `requested_date` moves outside today/tomorrow window.
- `rule_id` cleared.
- Status → cancelled/completed.

**Realtime:** Debounced invalidation of `tripKeys.timelessRuleTripsRoot`.

---

## 4. Kanban confirmation

**Yes — kanban can write `scheduled_at`, but only via the inline time input + board Save, not via drag-and-drop.**

| Mechanism | Writes `scheduled_at`? | File / function |
|-----------|------------------------|-----------------|
| Inline `<input type="time">` on card | Stages → `pendingChanges[id].scheduled_at` | `kanban-trip-card.tsx` → `commitTimeToStore` → `onTimeChange` |
| Board **Speichern** | Persists staged `scheduled_at` via `tripsService.updateTrip` | `kanban-board.tsx` → `handleSave` |
| Drag trip to driver/status/payer column | **No** — stages `driver_id`, `status`, or `payer_id` | `kanban-board.tsx` → `handleDragEnd` §3 |
| Drag for grouping | **No** — `group_id` / `stop_order` | Same |
| Context menu | **None found** for time |

Invalidation on save: `invalidateAfterTripSave` with `includePlanningWidgets: 'auto'` (see §1 verbatim).

---

## 5. Shared hook feasibility per entry point

A hypothetical `useSetTripSchedule` / `useSaveTripSchedule(tripId, scheduledAt)` that performs **save + full invalidation** is **technically feasible** but **mostly redundant** with the working-tree stack:

- `useUpdateTripMutation` already wraps save + `invalidateAfterTripSave` on settle.
- `invalidateAfterTripSave` already centralises widget roots.

| Entry point | Could call shared hook? | Constraints / complications |
|-------------|-------------------------|----------------------------|
| Pending tours widget | Yes, but awkward | Also sets optional `driver_id` via `buildAssignmentPatch` in same payload — hook would need `{ patch: UpdateTrip }` not just `scheduled_at` |
| Timeless widget | Partial | Batch save (0–2 legs); hook should accept array or loop |
| Detail sheet `applyDetailsPatch` | **No as-is** | Patch mixes time with route, KTS, billing, partner sync — must stay on `buildTripDetailsPatch` + mutation |
| Detail sheet driver change | Partial | Direct `updateTrip` today; should migrate to mutation |
| Kanban | **No for inline edit** | Two-phase: stage in Zustand store, batch save — hook fits `handleSave` batch only |
| Pending assignments | Partial | Optional time + driver in one `updates` object |
| Reschedule dialog | **No** | Uses Supabase directly + price engine; paired legs; server-action shape differs |
| Recurring rule resync | **No** | Batch server action, no trip ids on client |
| `useUpdateTripMutation` consumers | Already covered | Hook would duplicate mutation |

**Recommendation:** Do **not** add a parallel save hook. **Extend adoption** of `useUpdateTripMutation` + `invalidateAfterTripSave` (or pass options into `refreshAfterTripSave`).

---

## 6. Recommended hook signature

If v4b still wants one exported surface for “write trip fields that affect planning widgets”, prefer **`useSaveTripPlanningPatch`** (broader than time-only) over `useSetTripSchedule`:

```typescript
'use client';

import type { UpdateTrip } from '@/features/trips/api/trips.service';

export interface UseSaveTripPlanningPatchOptions {
  /** Extra invalidation after the shared contract (e.g. close sheet). */
  onSuccess?: (result: { id: string; patch: UpdateTrip }) => void | Promise<void>;
  onError?: (error: unknown) => void;
  /**
   * When true, always bust widget roots (widget row saves).
   * When 'auto' (default), inspect patch — detail sheet / kanban.
   */
  includePlanningWidgets?: boolean | 'auto';
  /** Default false when caller runs RSC refresh (detail sheet). */
  includeTripList?: boolean;
}

export interface SaveTripPlanningPatchInput {
  id: string;
  patch: UpdateTrip;
}

export interface UseSaveTripPlanningPatchResult {
  /** Persist via tripsService.updateTrip + invalidateAfterTripSave */
  saveTripPatch: (input: SaveTripPlanningPatchInput) => Promise<void>;
  /** Same as saveTripPatch but typed for the common case */
  setScheduledAt: (
    id: string,
    scheduledAt: string | null,
    extraPatch?: Partial<UpdateTrip>
  ) => Promise<void>;
  isPending: boolean;
  error: Error | null;
}

export function useSaveTripPlanningPatch(
  options?: UseSaveTripPlanningPatchOptions
): UseSaveTripPlanningPatchResult;
```

**Must invalidate (via helper):**

- Always: `tripKeys.detail(id)` for each affected id.
- Default: `tripKeys.all` unless `includeTripList: false`.
- Planning widgets: `tripKeys.unplannedRoot`, `tripKeys.timelessRuleTripsRoot` when `includePlanningWidgets === true` or `'auto'` and patch touches `PLANNING_WIDGET_PATCH_KEYS`.

**Per-entry-point callbacks:** Keep `onSuccess` / `onError` optional — widgets toast locally; detail sheet needs sheet stay-open + draft reset; kanban clears pending store after batch.

**Implementation note:** Implement as a thin wrapper around **`useUpdateTripMutation`** (optimistic detail already exists) rather than a second mutation.

---

## 7. Risk surface

| Scenario | Risk if widget roots invalidated | Severity |
|----------|-----------------------------------|----------|
| Detail sheet: time-only save on timeless rule leg | Row **should** vanish from Wiederkehrende Trips — **desired** | None |
| Detail sheet: time-only save, no driver | Row **remains** in Offene Touren (server filter) — user may expect disappearance | **Product confusion**, not invalidation regression — document expected behaviour |
| Detail sheet: clear time (`scheduled_at: null`) | Trip **reappears** in timeless widget if `rule_id` + today/tomorrow — **desired** | None |
| Detail sheet: notes-only save | Must **not** bust widgets — use `'auto'` or omit | Low if `'auto'` used |
| Fremdfirma assign (`fremdfirma_id`) | Trip should leave Offene Touren (assignee filled) — **missing invalidation today** is a bug, not regression | Fix is additive |
| Kanban: time staged but not saved | No invalidation until Save — **correct** | None |
| Kanban: reorder-only save | `'auto'` skips widgets — **correct** | None |
| Recurring rule batch resync | Many rows refetch; widget may empty/repopulate — acceptable admin action | Low |
| Reschedule to different `requested_date` | May move between widgets — **desired** | None |
| Overview + sheet open simultaneously | Refetch causes row count change — widgets already handle empty state | Low layout shift |

**Callers still missing widget invalidation (resolved in v4b):**

1. `applyNotesSave` → `refreshAfterTripSave()` — **intentional** (notes do not affect widgets).
2. ~~`TripFremdfirmaSection`~~ — **fixed v4b:** `persist()` passes `{ tripIds, patch, includePlanningWidgets: 'auto' }` to `onAfterSave`.
3. ~~`use-widget-trip-assignment`~~ — **fixed v4b:** `onSettled` calls `invalidateAfterTripSave` with `'auto'` + patch.

---

## Senior recommendation

**Is a shared save hook the right architecture for v4b?**

**No.** The working tree already introduces the correct layer: **`invalidateAfterTripSave`** as the single invalidation contract, plus **`useUpdateTripMutation.onSettled`** for mutation-based saves. v4b should **finish migrating** the remaining bare `tripsService.updateTrip` / no-options `refreshAfterTripSave` call sites to that contract — not add a second abstraction (`useSetTripSchedule`) that duplicates the mutation.

**Is a targeted invalidation fix per entry point sufficient and safer?**

**Yes.** The bug is not missing business logic; it is **inconsistent invalidation** on the detail sheet (and on `HEAD`, the mutation hook itself). The widgets already demonstrate the correct pattern (`includePlanningWidgets: true`). Detail sheet needs the same via `'auto'` + patch (already in working tree) and **`useUpdateTripMutation.onSettled`** must call the helper (working tree). Remaining work: commit the helper, migrate Fremdfirma/`use-widget-trip-assignment`, and optionally collapse duplicate invalidation (mutation + `refreshAfterTripSave`) once all paths are verified.

**Do not touch the cron generator for v4b.**

---

## Appendix: File path corrections vs audit brief

The brief listed widgets under `src/features/trips/components/`; actual locations:

- `src/features/dashboard/components/pending-tours-widget.tsx`
- `src/features/dashboard/components/timeless-rule-trips-widget.tsx`
- Hooks: `src/features/dashboard/hooks/use-unplanned-trips.ts`, `use-timeless-rule-trips.ts`
- Detail sheet: `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx`
- Query keys: `src/query/keys/trips.ts` (no `use-trip-queries.ts` in repo)

---

## v4b Resolution

Date: 2026-06-23

**Primary bug (detail sheet + mutation hook)**

Working-tree fix verified and committed. `refreshAfterTripSave` is called with options on detail sheet save paths (`applyDetailsPatch`, `handleDriverChange`). `useUpdateTripMutation.onSettled` uses `invalidateAfterTripSave` with `'auto'` + patch.

**Gap 1 — TripFremdfirmaSection**

Fixed: `persist()` in [`src/features/fremdfirmen/components/trip-fremdfirma-section.tsx`](../../src/features/fremdfirmen/components/trip-fremdfirma-section.tsx) passes `{ tripIds, patch, includePlanningWidgets: 'auto' }` to `onAfterSave` (sole caller: detail sheet’s `refreshAfterTripSave`).

**Gap 2 — use-widget-trip-assignment**

Fixed: [`src/features/trips/hooks/use-widget-trip-assignment.ts`](../../src/features/trips/hooks/use-widget-trip-assignment.ts) `onSettled` migrated to `invalidateAfterTripSave` with `'auto'` + patch.

**Overall status: CLOSED**

All scheduled_at and assignee write paths now use the `invalidateAfterTripSave` contract correctly.
