---
title: "Urgency Indicator"
category: "Dispatch"
icon: "warning"
description: "Explanation of timing rules and urgency levels."
order: 2
---

# Urgency Indicator System

The Urgency Indicator System is a unified, time-aware visual feedback mechanism that alerts dispatchers and drivers to trips that are about to start or are running behind.

It replaces the concept of a static "traffic light" with a reactive system driven by the trip's `scheduled_at` time and its current `status`.

## Logic & Timing Windows

The indicator calculates an `UrgencyLevel` based on the difference (in minutes) between `scheduled_at` and `now`.

| Window | Level | Visual | Context / Action |
|---|---|---|---|
| > 30m before | `none` | `urgency:none` | Normal planned state |
| 10m - 30m before | `upcoming` | `urgency:upcoming` | Preparing & Queueing |
| 0m - 10m before | `imminent` | `urgency:imminent` | **Critical**: Dispatching window |
| 0m - 5m late | `due` | `urgency:due` | Should be starting now (Pulse) |
| 5m - 10m late | `overdue` | `urgency:overdue` | **Immediate attention required** |

> [!IMPORTANT]
> Urgency is automatically hidden for trips with status `completed` or `cancelled`, or if the trip is more than **10 minutes overdue**.

> [!NOTE]
> **Localization Architecture**: The visual styling is defined in English in `urgency-config.ts`. User-facing labels (used in both badges and tooltips) are managed in `src/features/trips/lib/urgency-translations.ts`.

## Project Structure

- **Logic**: `src/features/trips/lib/urgency-logic.ts`
  - High-performance, pure logic for calculating urgency levels.
- **Component**: `src/features/trips/components/urgency-indicator.tsx`
  - A framer-motion powered UI component with `dot` and `badge` variants.
- **Kanban time chip**: `src/features/trips/hooks/use-urgency-level.ts` + `KANBAN_TIME_CHIP_CLASS` in `urgency-config.ts` — the **entire** time container is tinted by urgency (no dot).
- **Auto-Sync**: The indicator (and hook) refresh every 10 seconds so the visual state stays accurate even if the page isn't reloaded.

## Design Rules

1. **No Hardcoded Colors**: All colors are semantic and use Tailwind palette tiers (e.g., `blue-500`, `amber-500`).
2. **Theme Awareness**: Every color includes `dark:` variants for consistent visibility across all 6 project themes.
3. **Animations**: 
   - `due`: Subtle breathing effect.
   - `overdue`: Faster pulse with opacity shifts to draw the eye.

## Variants

| Variant | When `level === 'none'` | Typical use |
|---|---|---|
| **`dot`** | Renders an invisible **spacer** (same size as the dot) so time columns stay aligned across rows in tables and lists. | Zeit column in the trips data table, overview rows, mobile list. |
| **`badge`** | Renders nothing. | Driver portal / larger cards where the label is shown as a pill. |

## How to Use

### In Tables (Dot variant — alignment spacer)

```tsx
<UrgencyIndicator
  scheduledAt={trip.scheduled_at}
  status={trip.status}
  variant="dot"
/>
```

### Kanban time chip (full container tint, no dot)

Use the live hook and class map on the wrapper around `<input type="time">` (see `kanban-trip-card.tsx`):

```tsx
import { KANBAN_TIME_CHIP_CLASS } from '@/features/trips/constants/urgency-config';
import { useUrgencyLevel } from '@/features/trips/hooks/use-urgency-level';

const urgencyLevel = useUrgencyLevel(trip.scheduled_at, trip.status);

<div className={cn('… flex h-6 min-w-14 items-center rounded px-1.5', KANBAN_TIME_CHIP_CLASS[urgencyLevel])}>
  <input type="time" … />
</div>
```

When `urgencyLevel !== 'none'`, wrap the chip in a `Tooltip` with `getUrgencyTranslation(urgencyLevel).label`.

### In Cards (Badge variant)

```tsx
<UrgencyIndicator
  scheduledAt={trip.scheduled_at}
  status={trip.status}
  variant="badge"
/>
```

---

*Note: For overall trip status (logical states), refer to [color-system.md](../docs/color-system.md) and `src/lib/trip-status.ts`.*
