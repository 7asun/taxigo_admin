# Date vs datetime pickers (`DatePicker` vs `DateTimePicker`)

## Single module

Both components are implemented and exported from **`src/components/ui/date-time-picker.tsx`**. They intentionally live in one file so:

- Calendar **styling** stays in sync (`dateTimePickerCalendarClassNames`).
- **Popover** behaviour matches (`modal={false}`, high `z-index` for use inside **Dialogs**).
- **Mobile** behaviour matches (`useIsNarrowScreen(768)` + `MobileDateTimeSheet`).

There is **no** separate `date-picker.tsx` file.

### Imports

```ts
import {
  DateTimePicker,
  DatePicker,
  type DateTimePickerProps,
  type DatePickerProps
} from '@/components/ui/date-time-picker';
```

## When to use which

| Need | Component |
|------|-----------|
| One `Date` for a full pickup instant (other flows; not create-trip Abfahrt) | `DateTimePicker` |
| Create-trip **Abfahrt**: calendar day + optional clock time → `requested_date` + optional `scheduled_at` | `DatePicker` + `<input type="time">` in [`schedule-section.tsx`](../src/features/trips/components/create-trip/sections/schedule-section.tsx) (same idea as bulk CSV / Verschieben) |
| Split **Datum** + **Uhrzeit**; optional empty time (Zeitabsprache) + optional `requested_date` | `DatePicker` + separate `<input type="time">` — see **Verschieben** in [`trip-reschedule/`](../src/features/trips/trip-reschedule/) |
| React Hook Form, date field only without trip time | Often [`FormDatePicker`](../src/components/forms/form-date-picker.tsx) (same Popover + Calendar idea, form-wired) |

## Behaviour notes

- **`DateTimePicker`** — Parent holds one `Date \| undefined`. Time is merged with the selected calendar day; clearing the time input does **not** by itself clear the date (see inline comments in the component).
- **`DatePicker`** — Parent holds `yyyy-MM-dd` or `''`. The calendar uses **`required={false}`** (react-day-picker v8) so the user can clear the day by tapping the selected date again. Emitted strings are normalized to local calendar dates to avoid `yyyy-MM-dd` timezone drift.
- **Reschedule / Zeitabsprache** is documented in [`trip-reschedule-v1.md`](trip-reschedule-v1.md).

## Related

- Trip reschedule (“Verschieben”) behaviour: [`trip-reschedule-v1.md`](trip-reschedule-v1.md)
- Implementation folder: [`src/features/trips/trip-reschedule/`](../src/features/trips/trip-reschedule/)
- Mobile wheel UI: [`src/features/trips/components/create-trip/mobile-datetime-sheet.tsx`](../src/features/trips/components/create-trip/mobile-datetime-sheet.tsx)
