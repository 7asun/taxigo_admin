# Dashboard Mobile Widget Audit - Driver vs Dashboard Row Comparison

**Date:** April 20, 2026
**Purpose:** Compare driver trip card anatomy with dashboard widget rows to assess mobile reuse potential

---

## Section A — Driver Trip Row Anatomy

### Component: `DriverTripCard`
**Location:** `src/features/driver-portal/components/shared/driver-trip-card.tsx`

#### 1. Outer Container Class String
```tsx
className={cn(
  'bg-card relative flex overflow-hidden rounded-xl border-l-4 shadow-sm transition-shadow hover:shadow-md',
  tripStatusRow({ status: tripStatusTyped })
)}
```
- Base: `bg-card relative flex overflow-hidden rounded-xl border-l-4 shadow-sm transition-shadow hover:shadow-md`
- Dynamic: `tripStatusRow({ status: tripStatusTyped })` adds status-specific border-left color

#### 2. Visual Elements Per Row
- **Time:** Large monospace time display (font-mono text-lg font-bold tabular-nums)
- **UrgencyIndicator:** Badge variant showing urgency (early, on-time, late)
- **Wheelchair icon:** IconAccessible (h-4 w-4) if `is_wheelchair` is true
- **Client name:** With greeting_style prefix, clamp() for responsive font size
- **Status badge:** Top-right, uses `tripStatusBadge()` for status-specific styling
- **Route:** 
  - Pickup address with IconMapPin
  - Pickup station badge (if present)
  - Arrow down indicator
  - Dropoff address with IconMapPin (primary color)
  - Dropoff station badge (if present)
- **Notes:** Border-top section, shown if cancelled or `showNotes` prop
- **Action buttons:** Status-dependent:
  - `assigned/scheduled`: "Tour starten" + "Stornieren"
  - `in_progress`: "Tour beenden" + "Stornieren"
  - `completed/cancelled`: read-only (no actions)

#### 3. Touch Target Size of Primary Action
- **Button size:** `size='sm'` on Button component
- **Height:** `h-8` (32px) - below 44px recommended minimum
- **Width:** `w-full` for primary action (Tour starten/Tour beenden)
- **Note:** Secondary action (Stornieren) uses same `size='sm'`

#### 4. Status Colours / Border-Left Accent Pattern
```tsx
// Line 213
tripStatusRow({ status: tripStatusTyped })
```
- Uses `tripStatusRow()` function from `@/lib/trip-status`
- Returns status-specific Tailwind classes for border-left color
- Colors defined in `docs/color-system.md`:
  - `assigned/scheduled`: Blue
  - `in_progress`: Amber
  - `completed`: Green
  - `cancelled`: Red

#### 5. cn() / clsx() Status-Based Class Switching
```tsx
// Lines 211-214
className={cn(
  'bg-card relative flex overflow-hidden rounded-xl border-l-4 shadow-sm transition-shadow hover:shadow-md',
  tripStatusRow({ status: tripStatusTyped })
)}
```
- Yes, uses `cn()` from `@/lib/utils`
- `tripStatusRow()` returns status-specific border-left color classes
- Status is typed as `TripStatus` and passed to utility function

---

## Section B — Dashboard Widget Row Anatomy

### Widget 1: UpcomingTrips
**Row Component:** `TripRow` in `src/features/overview/components/trip-row.tsx`

#### 1. Individual Trip Row Container Class
```tsx
// Lines 79-90
className={cn(
  'group mb-0 flex cursor-pointer items-start rounded-lg p-2 transition-all select-none',
  rowColor === 'transparent' ? 'hover:bg-muted/50' : 'hover:brightness-95'
)}
style={{
  backgroundColor:
    rowColor !== 'transparent'
      ? `color-mix(in srgb, ${rowColor}, var(--background) 85%)`
      : undefined,
  borderLeft: `4px solid ${rowColor === 'transparent' ? 'transparent' : rowColor}`
}}
```
- Base: `group mb-0 flex cursor-pointer items-start rounded-lg p-2 transition-all select-none`
- Dynamic: Background color and border-left based on billing family color
- Conditional hover: `hover:bg-muted/50` vs `hover:brightness-95`

#### 2. Information Shown Per Row
- **Time:** Large tabular-nums (text-lg) with urgency dot
- **Line below time:** Billing label or payer name (max-width constrained)
- **Date:** If `showDate` prop, shows dd.MM.yy
- **Client name:** With group-hover:text-primary transition
- **Wheelchair badge:** Accessibility icon in rose-colored badge (size-4 or size-5)
- **Group badge:** Users icon with "Gruppe" label (sky-colored)
- **Dropoff address:** Formatted (removes Zip+City for Oldenburg), line-clamp-1
- **Status badges:** 
  - Both legs cancelled badge (AlertTriangle icon)
  - Partner cancelled badge (if applicable)
  - Primary status badge
- **QuickShare button:** h-6 w-6 icon button (Share2)
- **Driver name:** "Fahrer: {name}" in uppercase tracking-wider

#### 3. Height/Padding of Action Buttons
- **QuickShare button:** `h-6 w-6` (24px) - significantly below 44px minimum
- **No primary action button** - row is clickable (cursor-pointer) to open detail sheet

#### 4. Mobile Hiding Logic Inside Row
- **No `md:hidden` / `sm:hidden` logic** inside the TripRow component itself
- Responsive behavior is in the parent widget (UpcomingTrips) and via CSS clamp()
- Font size uses `clamp(0.7rem, 2.5vw, 0.875rem)` for client name
- Max-width constraints use `min(52vw, 11rem)` on mobile, `min(56vw, 14rem)` on sm+

#### 5. Inputs Inside Row
- **No inputs** inside TripRow
- Row is display-only, click opens TripDetailSheet

---

### Widget 2: PendingToursWidget
**Row Component:** `UnplannedTripRow` (inline component in `src/features/dashboard/components/pending-tours-widget.tsx`)

#### 1. Individual Tour Row Container Class
```tsx
// Line 233
className='flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4'
```
- Mobile: `flex flex-col gap-3 rounded-lg border p-3`
- Desktop (sm+): `sm:flex-row sm:items-start sm:justify-between sm:gap-4`

#### 2. Information Shown Per Row
- **Client name:** Text-sm font-semibold
- **Rückfahrt badge:** ArrowLeftRight icon with "Rückfahrt" label
- **Cancelled partner badge:** AlertTriangle icon with label
- **Termin badge:** Calendar icon with dd.MM. date
- **Route:** Pickup → dropoff (first line only, split by comma)
- **Linked outbound time:** For return trips, shows "Hinfahrt: {time}"

#### 3. Height/Padding of Action Buttons
- **Submit button:** `size='sm'` with `h-8 px-2` (32px height) - below 44px minimum
- **Icon:** PlusCircle (h-4 w-4) or Loader2 (h-4 w-4 animate-spin)

#### 4. Mobile Hiding Logic Inside Row
- **Yes:** `sm:flex-row` switches from column to row layout at sm breakpoint (640px)
- **No field hiding:** All fields shown on both mobile and desktop
- Layout change: Stacks vertically on mobile, horizontal row on desktop

#### 5. Inputs Inside Row
- **Date input:** `h-8 min-w-0 flex-1 text-xs sm:w-28 sm:flex-none`
- **Time input:** `h-8 min-w-0 flex-1 text-xs sm:w-24 sm:flex-none`
- **Select dropdown:** `h-8 min-w-[7.5rem] flex-1 text-xs sm:w-[120px] sm:flex-none`
- **All inputs:** `h-8` (32px) - below 44px minimum

---

### Widget 3: TimelessRuleTripsWidget
**Row Component:** `TimelessRulePairRow` (inline component in `src/features/dashboard/components/timeless-rule-trips-widget.tsx`)

#### 1. Individual Tour Row Container Class
```tsx
// Line 119
className='flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4'
```
- Mobile: `flex flex-col gap-3 rounded-lg border p-3`
- Desktop (sm+): `sm:flex-row sm:items-start sm:justify-between sm:gap-4`

#### 2. Information Shown Per Row
- **Client name:** Text-sm font-semibold
- **Date badge:** dd.MM.yyyy format
- **Payer name badge:** Dashed border, title="Kostenträger"
- **Billing label badge:** With custom color (border, color, background from billing_color)
- **Route:** Pickup → dropoff (first line only via `firstAddressLine()`)

#### 3. Height/Padding of Action Buttons
- **Submit button:** `size='sm'` with `h-8 shrink-0 self-end px-2` (32px height) - below 44px minimum
- **Icon:** PlusCircle (h-4 w-4) or Loader2 (h-4 w-4 animate-spin)

#### 4. Mobile Hiding Logic Inside Row
- **Yes:** `sm:flex-row` switches from column to row layout at sm breakpoint (640px)
- **No field hiding:** All fields shown on both mobile and desktop
- Layout change: Stacks vertically on mobile, horizontal row on desktop

#### 5. Inputs Inside Row
- **Hinfahrt time input:** `h-8 text-xs` (if outbound trip needs time)
- **Rückfahrt time input:** `h-8 text-xs` (if return trip needs time)
- **Both inputs:** `h-8` (32px) - below 44px minimum
- **Labels:** "Hinfahrt" / "Rückfahrt" in uppercase tracking-wide text-[10px]

---

## Section C — Reuse Potential

### 1. Can DriverTripCard be imported directly into dashboard widgets on mobile?

**No.** Data shapes are fundamentally different:

**DriverTripCard expects:**
```typescript
interface DriverTrip {
  id: string;
  scheduled_at: string | null;
  status: string;
  client_name: string | null;
  greeting_style: string | null;
  is_wheelchair: boolean;
  pickup_address: string | null;
  pickup_station: string | null;
  dropoff_address: string | null;
  dropoff_station: string | null;
  note: string | null;
  notes: string | null;
  // ... driver-specific fields
}
```

**Dashboard widgets use:**
- **UpcomingTrips/TripRow:** Full trip object with billing_variant, payer, driver, linked_trip, group_id, etc.
- **PendingToursWidget:** UnplannedTrip type with linked_trip, fremdfirma_id, requested_date
- **TimelessRuleTripsWidget:** TimelessRulePair with outbound/return trip pairs, payer_name, billing_label, billing_color

**Additional blockers:**
- DriverTripCard has complex action logic (start/complete/cancel dialogs) that doesn't apply to admin dashboard
- DriverTripCard uses `shiftActive` prop for gating - not relevant for admin
- DriverTripCard shows different fields (stations, notes) that dashboard widgets don't need
- Dashboard widgets have admin-specific fields (billing labels, payer names) that driver card doesn't show

### 2. Fields in Driver Card NOT Shown in Dashboard Widgets

**DriverTripCard has:**
- `greeting_style` (e.g., "Herr", "Frau", "Dr.")
- `pickup_station` and `dropoff_station` badges
- `note` / `notes` field (shown when cancelled)
- UrgencyIndicator with badge variant
- Full route (both pickup and dropoff with full addresses)
- Action buttons (start/complete/cancel)
- Shift-aware gating logic
- Dialog confirmations for actions

**Dashboard widgets don't show:**
- Greeting style
- Station badges
- Notes field
- Full route (usually truncated to first line)
- Driver action buttons (different admin actions instead)

### 3. Fields Dashboard Widgets Show That Driver Card DOESN'T

**UpcomingTrips/TripRow shows:**
- Billing label or payer name below time
- Group badge with "Gruppe" label
- QuickShare button (WhatsApp integration)
- Driver name ("Fahrer: {name}")
- Both legs cancelled badge
- Partner cancelled badge with specific label
- Dynamic background color based on billing family
- Formatted dropoff address (Oldenburg special case)

**PendingToursWidget shows:**
- Rückfahrt badge (return trip indicator)
- Cancelled partner badge
- Termin badge (requested date)
- Linked outbound trip time
- Date input for scheduling
- Time input for scheduling
- Driver select dropdown
- Admin action to set time + driver

**TimelessRuleTripsWidget shows:**
- Date badge (requested_date)
- Payer name badge
- Billing label badge with custom color
- Dual time inputs (Hinfahrt + Rückfahrt)
- Payer filter dropdown
- Admin action to set times for rule trips

**Driver card doesn't show:**
- Billing information (labels, payer names, colors)
- Group indicators
- QuickShare functionality
- Driver name (it's the driver's own trips)
- Admin scheduling controls
- Payer/billing filters

### 4. Shared `<TripRowMobile />` Feasibility Assessment

**Not feasible as a single shared component.** Reasons:

**1. Fundamentally different data shapes:**
- Driver: Single trip with driver-specific fields
- TripRow: Full trip with billing, groups, linked trips
- UnplannedTripRow: Trip with linked_partner, fremdfirma, requested_date
- TimelessRulePairRow: Pair of trips with billing metadata

**2. Fundamentally different actions:**
- Driver: start/complete/cancel with dialogs
- TripRow: Click to open detail sheet, quickshare
- UnplannedTripRow: Set date/time + driver assignment
- TimelessRulePairRow: Set times for outbound + return legs

**3. Different visual patterns:**
- Driver: Card with border-l-4 accent, full route, stations
- TripRow: Row with billing color background, compact layout
- UnplannedTripRow: Form row with inputs
- TimelessRulePairRow: Form row with dual time inputs

**4. Different responsive needs:**
- Driver: Already mobile-optimized (max-w-lg constraint, 48px targets)
- TripRow: Needs mobile optimization (24px quickshare too small)
- UnplannedTripRow: Needs mobile optimization (32px inputs too small)
- TimelessRulePairRow: Needs mobile optimization (32px inputs too small)

**Recommended approach:**
Each widget should have its own mobile-optimized row variant. However, they can share:
- Common utility functions (status colors, address formatting)
- Common UI patterns (responsive flex layouts, touch target sizing)
- Common mobile design system (max-width constraints, safe-area-inset)

**Specific recommendations:**
1. **Create mobile variants for each widget row:**
   - `TripRowMobile` for UpcomingTrips
   - `UnplannedTripRowMobile` for PendingToursWidget
   - `TimelessRulePairRowMobile` for TimelessRuleTripsWidget

2. **Share mobile design patterns:**
   - Use `h-10` or `h-12` (40-48px) for all touch targets
   - Stack inputs vertically on mobile, horizontal on desktop
   - Use `max-w-lg` constraint on mobile content
   - Add safe-area-inset handling

3. **Extract common utilities:**
   - Status color utilities already shared via `lib/trip-status`
   - Address formatting could be shared
   - Badge patterns could be standardized

4. **Do NOT attempt a single shared component** - the data shape and action differences are too significant. The shared component would require excessive props and conditional rendering, making it harder to maintain than separate components.

---

## Summary

**Key Findings:**
- Driver card is already mobile-optimized (48px targets, max-w-lg, safe-area-inset)
- Dashboard widget rows have inconsistent touch targets (24-32px, all below 44px)
- Data shapes are fundamentally different between driver and admin contexts
- Actions are completely different (driver operations vs admin operations)
- Visual patterns differ significantly (card vs row vs form row)

**Recommendation:**
Create separate mobile-optimized row variants for each dashboard widget, sharing only utility functions and design patterns. Do not attempt a single shared `<TripRowMobile />` component due to data shape and action differences.
