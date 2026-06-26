# Business-Day Look-Ahead Audit

## Scope Read

Files read completely:

- `src/features/dashboard/hooks/use-timeless-rule-trips.ts`
- `src/features/trips/lib/trip-time.ts`
- `src/lib/date-ymd.ts`
- `src/features/trips/lib/trip-business-date.ts`
- `src/features/dashboard/components/timeless-rule-trips-widget.tsx`

The requested widget path `src/features/dashboard/widgets/timeless-rule-trips-widget.tsx` does not exist in this repo; the existing widget is under `src/features/dashboard/components/timeless-rule-trips-widget.tsx`.

## 1. Where The Date Window Is Calculated

The "show trips for today and tomorrow" window is calculated in `useTimelessRuleTrips()` inside `src/features/dashboard/hooks/use-timeless-rule-trips.ts`:

```ts
const todayYmd = todayYmdInBusinessTz();
const tomorrowYmd = instantToYmdInBusinessTz(
  addDays(ymdToPickerDate(todayYmd), 1).getTime()
);
```

Those variables are passed into the query key and fetcher:

```ts
queryKey: tripKeys.timelessRuleTrips(todayYmd, tomorrowYmd),
queryFn: () => fetchTimelessRulePairs(todayYmd, tomorrowYmd),
```

`requested_date` is compared in the Supabase query in `fetchTimelessRulePairs()`:

```ts
const { data: rowsRaw, error } = await supabase
  .from('trips')
  .select(`*, requested_date, ${TIMELESS_TRIP_EMBEDS}`)
  .not('rule_id', 'is', null)
  .is('scheduled_at', null)
  .in('requested_date', [todayYmd, tomorrowYmd])
  .not('status', 'in', '("cancelled","completed")');
```

So the current window is exactly two `requested_date` values: `todayYmd` and `tomorrowYmd`.

## 2. Calendar +1 Day Or Named Constant

The current look-ahead is expressed directly as `+1` calendar day:

```ts
addDays(ymdToPickerDate(todayYmd), 1)
```

There is no named look-ahead constant in the hook. The only named values are local variables:

- `todayYmd`
- `tomorrowYmd`

No existing weekend/business-day constant is used for this widget.

## 3. Existing Date Utility Files

`src/lib/date-ymd.ts` exists and exports:

- `parseYmdToLocalDate(ymd: string): Date | undefined`
- `formatLocalDateToYmd(d: Date): string`

There is no `src/utils/date*` or `src/helpers/date*` file.

The trips feature also has a domain-specific date utility file, `src/features/trips/lib/trip-business-date.ts`, which exports:

- `getTripsBusinessTimeZone(): string`
- `isYmdString(value: string): boolean`
- `instantToYmdInBusinessTz(ms: number): string`
- `todayYmdInBusinessTz(): string`
- `getZonedDayBoundsIso(ymd: string): { startISO: string; endExclusiveISO: string }`
- `ymdToPickerDate(ymd: string): Date`

## 4. date-fns Usage In The Hook

Yes, `date-fns` is imported in `src/features/dashboard/hooks/use-timeless-rule-trips.ts`.

The hook imports:

```ts
import { addDays } from 'date-fns';
```

Only `addDays` is used in the hook.

## 5. Shape Of `requested_date`

The generated database type says:

```ts
requested_date: string | null;
```

The code treats it as a plain civil ISO date string in `YYYY-MM-DD` form, not a full timestamp.

Supporting evidence:

- `src/features/trips/components/create-trip/schema.ts` validates the date with `/^\d{4}-\d{2}-\d{2}$/`.
- `src/features/trips/components/bulk-upload-dialog.tsx` comments describe `requested_date` as canonical `YYYY-MM-DD`.
- `src/features/trips/lib/departure-schedule.ts` sets `requested_date = ymd`.
- `src/features/trips/api/recurring-rules.service.ts` comments call it `ISO format YYYY-MM-DD`.
- `src/features/trips/api/recurring-rules.actions.ts` comments call it a Berlin civil calendar day.

There are some display paths using `new Date(pair.requested_date)`, but storage intent is still date-only `YYYY-MM-DD`.

## 6. Current Day-Of-Week Behavior

There is no special weekend handling today.

The hook always returns today's Berlin business-timezone YMD plus exactly one calendar day:

- Monday shows Monday + Tuesday.
- Tuesday shows Tuesday + Wednesday.
- Wednesday shows Wednesday + Thursday.
- Thursday shows Thursday + Friday.
- Friday shows Friday + Saturday.
- Saturday shows Saturday + Sunday.
- Sunday shows Sunday + Monday.

So Friday currently includes Saturday, not Monday. Saturday currently includes Sunday, not Monday.

## Recommendation

Add the new business-day helper to `src/features/trips/lib/trip-business-date.ts`, not to the widget and not to the hook itself.

Reasoning:

- The logic is about trips' business calendar semantics, not generic local date formatting. `src/lib/date-ymd.ts` is local DatePicker/invoice-style YMD conversion, while `trip-business-date.ts` already owns `Europe/Berlin` / `NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE` behavior.
- The hook owns the query window and query key, so it should call the helper there. The widget should stay presentational and should not decide which dates are fetched.
- A helper in `trip-business-date.ts` keeps the timezone invariant near `todayYmdInBusinessTz()`, `instantToYmdInBusinessTz()`, and `ymdToPickerDate()`.

Recommended shape:

```ts
export function getNextBusinessDayYmd(ymd: string): string
```

Then `useTimelessRuleTrips()` can derive:

```ts
const todayYmd = todayYmdInBusinessTz();
const nextBusinessDayYmd = getNextBusinessDayYmd(todayYmd);
```

and query:

```ts
.in('requested_date', [todayYmd, nextBusinessDayYmd])
```

If the product requirement is "show today and the next business day", this keeps Friday -> Monday behavior centralized and testable without pushing business rules into UI rendering.
