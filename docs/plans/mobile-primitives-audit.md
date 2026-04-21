# Mobile Primitives Audit

**Date:** April 21, 2026
**Purpose:** Document function signatures, state management, and component structure for mobile row implementation

---

## 1. tripStatusRow() and tripStatusBadge() Export Signatures

**Location:** `src/lib/trip-status.ts`

### Function Signatures

```typescript
// Line 51-71
export const tripStatusBadge = cva('border font-medium', {
  variants: {
    status: {
      completed: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800',
      assigned: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800',
      scheduled: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800',
      in_progress: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
      driving: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
      cancelled: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800',
      pending: 'bg-muted text-muted-foreground border-border',
      open: 'bg-muted text-muted-foreground border-border'
    }
  },
  defaultVariants: { status: 'pending' }
});

// Line 77-91
export const tripStatusRow = cva('', {
  variants: {
    status: {
      completed: 'border-l-green-500 bg-green-50/30 dark:bg-green-950/10',
      assigned: 'border-l-blue-500 bg-blue-50/30 dark:bg-blue-950/10',
      scheduled: 'border-l-blue-500 bg-blue-50/30 dark:bg-blue-950/10',
      in_progress: 'border-l-amber-500 bg-amber-50/30 dark:bg-amber-950/10',
      driving: 'border-l-amber-500 bg-amber-50/30 dark:bg-amber-950/10',
      cancelled: 'border-l-red-500 bg-red-50/20 dark:bg-red-950/10',
      pending: '',
      open: ''
    }
  },
  defaultVariants: { status: 'pending' }
});
```

### Status Values Accepted

```typescript
// Line 31-39
export type TripStatus =
  | 'completed'
  | 'assigned'
  | 'scheduled'
  | 'in_progress'
  | 'driving'
  | 'cancelled'
  | 'pending'
  | 'open';
```

**Usage pattern:**
```typescript
tripStatusBadge({ status: tripStatusTyped })
tripStatusRow({ status: tripStatusTyped })
```

---

## 2. TripRow / UpcomingTrips Detail Sheet Triggering

### How TripDetailSheet is Triggered

**Internal state in UpcomingTrips widget** (lines 48-49):
```typescript
const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
const [isSheetOpen, setIsSheetOpen] = useState(false);
```

**Handler function** (lines 86-89):
```typescript
const handleTripClick = (id: string) => {
  setSelectedTripId(id);
  setIsSheetOpen(true);
};
```

**Passed to TripRow as callback prop** (lines 248-251):
```typescript
<TripRow
  trip={trip}
  onClick={() => handleTripClick(trip.id)}
/>
```

**TripRow receives onClick prop** (lines 21-26):
```typescript
interface TripRowProps {
  trip: any;
  onClick: () => void;
  compact?: boolean;
  showDate?: boolean;
}
```

**TripRow uses onClick on the row div** (lines 77-78):
```typescript
<div
  onClick={onClick}
  className={cn(
    'group mb-0 flex cursor-pointer items-start rounded-lg p-2 transition-all select-none',
    ...
  )}
>
```

### Prop/Handler for New Mobile Card

**To replicate "tap to open detail" behavior:**
- Pass an `onClick: () => void` callback prop to the mobile card component
- Attach it to the outermost clickable element (div or article)
- The callback should set state in the parent widget to open TripDetailSheet

**Exact onClick handler:**
```typescript
onClick={() => handleTripClick(trip.id)}
```

**Where `handleTripClick` is:**
```typescript
const handleTripClick = (id: string) => {
  setSelectedTripId(id);
  setIsSheetOpen(true);
};
```

---

## 3. PendingToursWidget (UnplannedTripRow) Mutation and State

### Exact Mutation Call on Submit

**Lines 182-224:**
```typescript
const handleSetTime = async () => {
  if (!time) {
    toast.error('Bitte geben Sie eine Abholzeit ein.');
    return;
  }

  try {
    setIsSubmitting(true);
    const [hours, minutes] = time.split(':');
    const scheduledDate = set(new Date(dateStr), {
      hours: parseInt(hours, 10),
      minutes: parseInt(minutes, 10),
      seconds: 0,
      milliseconds: 0
    });

    const updatePayload: Parameters<typeof tripsService.updateTrip>[1] = {
      scheduled_at: scheduledDate.toISOString(),
      driver_id: driverId
    };
    const derivedStatus = getStatusWhenDriverChanges(trip.status, driverId, {
      fremdfirmaId: trip.fremdfirma_id
    });
    if (derivedStatus) updatePayload.status = derivedStatus;

    await tripsService.updateTrip(trip.id, updatePayload);

    void queryClient.invalidateQueries({ queryKey: tripKeys.unplannedRoot });
    void queryClient.invalidateQueries({
      queryKey: tripKeys.detail(trip.id)
    });

    toast.success(
      `Abholzeit ${driverId ? 'und Fahrer ' : ''}für ${trip.client_name || 'Fahrt'} gesetzt.`
    );
    setTime('');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(`Fehler: ${message}`);
  } finally {
    setIsSubmitting(false);
  }
};
```

**Core mutation:**
```typescript
await tripsService.updateTrip(trip.id, updatePayload);
```

**Query invalidation:**
```typescript
void queryClient.invalidateQueries({ queryKey: tripKeys.unplannedRoot });
void queryClient.invalidateQueries({ queryKey: tripKeys.detail(trip.id) });
```

### State Variables Controlling Inputs

**Lines 175-180:**
```typescript
const [dateStr, setDateStr] = useState(initialDate);
const [time, setTime] = useState(initialTime);
const [driverId, setDriverId] = useState<string | null>(
  trip.driver_id ?? null
);
const [isSubmitting, setIsSubmitting] = useState(false);
```

**Initial values** (lines 162-173):
```typescript
const initialDate = (() => {
  if (trip.scheduled_at)
    return new Date(trip.scheduled_at).toISOString().slice(0, 10);
  if (trip.requested_date) return trip.requested_date;
  const linkedAt = trip.linked_trip?.scheduled_at;
  if (linkedAt) return new Date(linkedAt).toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
})();

const initialTime = trip.scheduled_at
  ? format(new Date(trip.scheduled_at), 'HH:mm')
  : '';
```

### State Location

**All state variables are LOCAL to the UnplannedTripRow component** (lines 145-180):
- `dateStr` - local useState
- `time` - local useState
- `driverId` - local useState
- `isSubmitting` - local useState

**Not lifted to parent widget.** Each row manages its own form state independently.

---

## 4. TimelessRuleTripsWidget (TimelessRulePairRow) Mutation and State

### Exact Mutation Call on Submit

**Lines 71-116:**
```typescript
const handleSave = async () => {
  const edits: EditableLeg[] = [];
  if (outboundEditable?.time.trim()) edits.push(outboundEditable);
  if (returnEditable?.time.trim()) edits.push(returnEditable);

  if (edits.length === 0) {
    toast.error('Bitte geben Sie mindestens eine Abholzeit ein.');
    return;
  }

  try {
    setIsSubmitting(true);

    for (const e of edits) {
      const [hours, minutes] = e.time.split(':');
      const scheduledDate = set(new Date(pair.requested_date), {
        hours: parseInt(hours, 10),
        minutes: parseInt(minutes, 10),
        seconds: 0,
        milliseconds: 0
      });

      // No driver assignment and no status mutation here: the widget only confirms a time.
      await tripsService.updateTrip(e.trip.id, {
        scheduled_at: scheduledDate.toISOString()
      });

      void queryClient.invalidateQueries({
        queryKey: tripKeys.detail(e.trip.id)
      });
    }

    void queryClient.invalidateQueries({
      queryKey: tripKeys.timelessRuleTripsRoot
    });

    toast.success(`Zeit für ${pair.client_name || 'Fahrt'} gesetzt.`);
    setOutboundTime('');
    setReturnTime('');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(`Fehler: ${message}`);
  } finally {
    setIsSubmitting(false);
  }
};
```

**Core mutation (inside for loop):**
```typescript
await tripsService.updateTrip(e.trip.id, {
  scheduled_at: scheduledDate.toISOString()
});
```

**Query invalidation:**
```typescript
void queryClient.invalidateQueries({
  queryKey: tripKeys.detail(e.trip.id)
});
void queryClient.invalidateQueries({
  queryKey: tripKeys.timelessRuleTripsRoot
});
```

### State Variables Controlling Time Inputs

**Lines 54-57:**
```typescript
const [isSubmitting, setIsSubmitting] = useState(false);

const [outboundTime, setOutboundTime] = useState('');
const [returnTime, setReturnTime] = useState('');
```

**Editable leg objects** (lines 59-65):
```typescript
const outboundEditable: EditableLeg | null = isTimeless(pair.outbound)
  ? { trip: pair.outbound, time: outboundTime, setTime: setOutboundTime }
  : null;

const returnEditable: EditableLeg | null = isTimeless(pair.return)
  ? { trip: pair.return, time: returnTime, setTime: setReturnTime }
  : null;
```

### State Location

**All state variables are LOCAL to the TimelessRulePairRow component** (lines 52-57):
- `outboundTime` - local useState
- `returnTime` - local useState
- `isSubmitting` - local useState

**Not lifted to parent widget.** Each row manages its own form state independently.

---

## 5. Overview Layout JSX Block Rendering Three Widgets

**Location:** `src/app/dashboard/overview/layout.tsx`

**Lines 148-163:**
```tsx
<div className='flex flex-col gap-4 lg:grid lg:grid-cols-7 lg:items-start'>
  <div className='flex flex-col gap-4 lg:col-span-4'>
    <TimelessRuleTripsWidget />
    <PendingToursWidget />
    <div className='hidden gap-4 lg:flex lg:flex-col'>
      {React.Children.toArray(bar_stats)}
      {React.Children.toArray(area_stats)}
    </div>
  </div>
  <div className='flex flex-col gap-4 lg:col-span-3'>
    {React.Children.toArray(sales)}
    <div className='hidden lg:block'>
      {React.Children.toArray(pie_stats)}
    </div>
  </div>
</div>
```

**Structure:**
- Outer container: `flex flex-col gap-4` on mobile, `lg:grid lg:grid-cols-7` on desktop
- Left column (lg:col-span-4):
  - `TimelessRuleTripsWidget`
  - `PendingToursWidget`
  - Charts (bar_stats, area_stats) - hidden on mobile, shown on lg
- Right column (lg:col-span-3):
  - `sales` (UpcomingTrips from parallel slot)
  - Pie chart - hidden on mobile, shown on lg

**Import statements** (lines 15-16):
```typescript
import { PendingToursWidget } from '@/features/dashboard/components/pending-tours-widget';
import { TimelessRuleTripsWidget } from '@/features/dashboard/components/timeless-rule-trips-widget';
```

---

## 6. Output of ls src/components/

```
breadcrumbs.tsx (1626 bytes)
documentation/ (2 items)
file-uploader.tsx (9310 bytes)
form-card-skeleton.tsx (1762 bytes)
forms/ (11 items)
icons.tsx (1720 bytes)
kbar/ (5 items)
layout/ (7 items)
modal/ (1 items)
nav-main.tsx (2433 bytes)
nav-projects.tsx (2571 bytes)
nav-user.tsx (3587 bytes)
panels/ (7 items)
search-input.tsx (872 bytes)
themes/ (6 items)
ui/ (63 items)
user-avatar-profile.tsx (1055 bytes)
```

**Top-level files:**
- `breadcrumbs.tsx`
- `file-uploader.tsx`
- `form-card-skeleton.tsx`
- `icons.tsx`
- `nav-main.tsx`
- `nav-projects.tsx`
- `nav-user.tsx`
- `search-input.tsx`
- `user-avatar-profile.tsx`

**Top-level directories:**
- `documentation/` (2 items)
- `forms/` (11 items)
- `kbar/` (5 items)
- `layout/` (7 items)
- `modal/` (1 item)
- `panels/` (7 items)
- `themes/` (6 items)
- `ui/` (63 items)

---

## Summary for Mobile Implementation

### Key Primitives Available

1. **Status utilities:** `tripStatusBadge()` and `tripStatusRow()` from `@/lib/trip-status` - already mobile-ready, can be reused directly

2. **Detail sheet pattern:** Parent widget manages `selectedTripId` and `isSheetOpen` state, passes `onClick` callback to row component - same pattern can be used for mobile cards

3. **Form state pattern:** Both form-based widgets (PendingToursWidget, TimelessRuleTripsWidget) keep form state LOCAL to each row component - mobile variants should follow the same pattern

4. **Mutation pattern:** 
   - Use `tripsService.updateTrip()` for mutations
   - Invalidate relevant query keys after mutation
   - Show toast success/error messages
   - Use `isSubmitting` state to disable inputs during mutation

5. **Layout structure:** Widgets are rendered in a flex column on mobile, grid on desktop - mobile variants should maintain this responsive pattern

### Component Structure

- **UpcomingTrips:** Parent widget → TripRow (display-only, click-to-detail)
- **PendingToursWidget:** Parent widget → UnplannedTripRow (form with date/time/driver inputs)
- **TimelessRuleTripsWidget:** Parent widget → TimelessRulePairRow (form with dual time inputs)

All row components are defined inline within their parent widget files, not as separate exports.
