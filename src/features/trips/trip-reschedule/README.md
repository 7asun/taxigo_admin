# Trip reschedule (`trip-reschedule/`)

Everything for **Verschieben** (change date/time / Zeitabsprache for a single, non-recurring trip).

| Path | Role |
|------|------|
| [`components/trip-reschedule-dialog.tsx`](components/trip-reschedule-dialog.tsx) | Dialog UI (split date + time, paired leg) |
| [`api/reschedule.actions.ts`](api/reschedule.actions.ts) | Supabase `scheduled_at` / `requested_date` updates |
| [`lib/reschedule-trip.ts`](lib/reschedule-trip.ts) | Eligibility, disabled reasons, paired delta helper |

**Import** from the feature barrel:

```ts
import {
  TripRescheduleDialog,
  canRescheduleTrip,
  getRescheduleDisabledReason
} from '@/features/trips/trip-reschedule';
```

Product behaviour and v2 checklist: [`docs/trip-reschedule-v1.md`](../../../../docs/trip-reschedule-v1.md).
