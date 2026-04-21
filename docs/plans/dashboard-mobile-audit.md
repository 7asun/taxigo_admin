# Dashboard Mobile Responsiveness Audit

**Date:** April 20, 2026
**Scope:** `/dashboard/overview` page and related layout components
**Purpose:** Identify mobile responsiveness issues and recommend improvements

---

## 1. Sidebar / Navigation

### Current Implementation

**Desktop Width:** `16rem` (256px) - defined in `components/ui/sidebar.tsx` as `SIDEBAR_WIDTH`
**Mobile Width:** `18rem` (288px) - defined as `SIDEBAR_WIDTH_MOBILE` for Sheet overlay
**Icon Mode:** `3rem` (48px) - collapsed state width

**Collapse/Hide Behavior:**
- Sidebar uses `collapsible='icon'` in `app-sidebar.tsx`
- Mobile detection via `useIsMobile()` hook with 768px breakpoint
- On mobile (`< 768px`): Sidebar renders as a Sheet (drawer) overlay that slides in from left
- On desktop (`≥ 768px`): Sidebar is `hidden md:block` - visible only on md and up
- SidebarRail (hover trigger) has `hidden sm:flex` - only visible on small screens and up

**Hamburger Logic:**
- `SidebarTrigger` button in header with `size-7` (28px)
- Located in `components/layout/header.tsx` with `-ml-1` positioning
- Always visible to toggle sidebar on mobile
- Keyboard shortcut: `Cmd/Ctrl + B`

**Issues:**
- SidebarTrigger touch target is 28px - below 44px recommended minimum for mobile
- Sheet overlay on mobile is wider (288px) than desktop sidebar (256px) - inconsistent experience
- No safe-area-inset handling in sidebar for notched devices (iPhone X+)

---

## 2. KPI / Stats Row

### Current Implementation

**Number of Stat Cards:**
- Desktop: 4 cards (Fahrten heute, Umsatz heute, Rechnungsumsatz, Wachstumsrate placeholder)
- Mobile: 2 cards (Fahrten heute, Umsatz heute) - others hidden

**Layout:**
- Desktop: `grid-cols-4` with `lg:grid-cols-4` (from `dashboard/overview/layout.tsx` line 99)
- Mobile: Stacked `StatsRowCard` components in flex column (line 80-98)
- Responsive classes: `md:hidden` for mobile version, `hidden md:grid md:grid-cols-2 md:gap-4 lg:grid-cols-4` for desktop

**Responsive Override:**
- Below `md` (768px): Uses `StatsRowCard` - compact row layout with horizontal flex
- At `md` (768px): Switches to 2-column grid
- At `lg` (1024px): Switches to 4-column grid
- Growth rate placeholder card has `hidden md:block` - only shows on desktop

**Issues:**
- Mobile version loses 2 important metrics (invoice revenue, growth rate)
- No horizontal scroll or swipe to see additional stats on mobile
- StatsRowCard has compact layout but may be too dense for quick scanning on small screens

---

## 3. Data Tables / Trip Rows

### Current Implementation

**Table Components on Dashboard:**
- No traditional HTML `<table>` elements on overview page
- Uses card-based widgets instead:
  - `TimelessRuleTripsWidget` - displays recurring trips needing time assignment
  - `PendingToursWidget` - displays unplanned trips needing driver/time
  - `UpcomingTrips` - displays scheduled trips in a list

**Card vs Table:**
- All widgets use card-based layout (Card component from shadcn/ui)
- No data table component rendered on overview page
- Trip rows use flex layouts: `flex-col sm:flex-row` for responsive stacking

**Horizontal Scrolling:**
- No horizontal scrolling implemented on overview
- Widget rows wrap naturally with flex layouts
- `min-w-0` and `flex-wrap` classes prevent overflow

**Mobile-Specific Rendering:**
- No separate mobile card view vs desktop table view on overview
- All widgets use same card layout with responsive flex classes
- Widget header controls stack on mobile: `flex-col gap-3 sm:flex-row sm:items-start sm:justify-between`

**Issues:**
- Dense information in widgets may be hard to read on small screens
- Date/time inputs and select dropdowns in widgets are small (`h-8`, text-xs)
- No horizontal swipe gestures for navigation between widgets

---

## 4. Page Wrapper & Container

### Current Implementation

**Outermost Layout Container:**
- From `dashboard/layout.tsx`:
  - `SidebarProvider` with `h-svh max-h-svh overflow-hidden` (line 57-59)
  - Prevents full-page scroll, uses internal scroll regions
  - `SidebarInset` with `min-h-0 flex-1 flex-col overflow-hidden` (line 63)

**Content Container:**
- From `dashboard/layout.tsx` line 65:
  - `<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>`
- From `page-container.tsx`:
  - ScrollArea wrapper with `min-h-0 min-w-0 flex-1` (line 57)
  - Padding: `p-4 md:px-6` (line 58, 79)
  - Header section: `mb-4 flex min-w-0 shrink-0 flex-row items-start justify-between gap-2 sm:gap-4` (line 59)

**Max-Width:**
- No max-width constraint on dashboard content
- Content fills available space after sidebar
- Driver portal uses `max-w-lg` (512px) but dashboard does not

**Overflow:**
- `overflow-hidden` on multiple containers
- ScrollArea handles internal scrolling
- Single scroll region managed by ScrollArea component

**Issues:**
- No max-width constraint - content can become very wide on large screens
- No safe-area-inset handling for notched devices (unlike driver portal)
- Multiple nested `overflow-hidden` may cause scroll issues on some browsers

---

## 5. Charts / Data Visualizations

### Current Implementation

**Charts on Dashboard:**
- `BarGraph` component (`features/overview/components/bar-graph.tsx`)
- Uses Recharts library
- Other charts (area_stats, pie_stats) rendered in parallel slots but hidden on mobile

**Library:**
- Recharts with `ResponsiveContainer`, `BarChart`, `XAxis`, `Tooltip`
- ChartContainer from shadcn/ui for consistent styling

**Width:**
- Fluid width: `w-full` on ChartContainer (line 111)
- ResponsiveContainer handles resizing
- Card has `@container/card` for container queries

**Height:**
- Fixed height: `h-[300px]` on ChartContainer (line 111)
- Skeleton loader uses `h-[250px]` (line 78)

**Mobile Behavior:**
- Charts are hidden below `lg` breakpoint (line 152-155 in overview layout)
- Wrapped in `div className='hidden gap-4 lg:flex lg:flex-col'`
- Only visible on screens ≥ 1024px

**Issues:**
- Charts completely hidden on mobile - no alternative visualization
- Fixed 300px height may be too tall for small screens
- No responsive chart height adjustment
- No simplified mobile chart view (e.g., sparklines or summary stats)

---

## 6. Touch & Interaction

### Current Implementation

**Hover-Only Interactions:**
- Tooltips in `BarGraph` - hover-only, no tap support
- Tooltip in `PendingAssignmentsPopover` - hover-only
- SidebarRail - hover-triggered edge (line 291 in sidebar.tsx: `hover:after:bg-sidebar-border`)
- Various `group-hover` patterns in sidebar menu items

**Button Touch Targets:**
- SidebarTrigger: `size-7` (28px) - below 44px recommended
- CreateTripDialogButton: size not specified, likely default
- Widget action buttons: `size='sm'` with `h-8` (32px) - below 44px
- Icon buttons in header: `size-9` (36px) - below 44px
- Tabs triggers: `h-12` (48px) - meets 44px minimum
- Select triggers: `h-8` (32px) - below 44px

**Input Touch Targets:**
- Date/time inputs in widgets: `h-8` (32px) - below 44px
- Text inputs: default height likely below 44px

**Issues:**
- Many touch targets below 44px recommended minimum
- Hover-only interactions don't work on touch devices
- No tap feedback or active states for mobile
- Tooltips should be replaced with tappable elements on mobile

---

## 7. Breakpoints in Use

### Breakpoint Definitions

**Tailwind Default Breakpoints:**
- `sm:` - 640px (small tablets, large phones landscape)
- `md:` - 768px (tablets, small laptops) - PRIMARY mobile/desktop split
- `lg:` - 1024px (laptops, desktops)
- `xl:` - 1280px (large desktops)
- `2xl:` - 1536px (extra large screens)

**Custom Hook:**
- `useIsMobile()` in `src/hooks/use-mobile.tsx` uses 768px breakpoint
- `useMediaQuery()` hook also uses 768px (from sidebar.tsx line 68)

### Breakpoint Usage in Dashboard Files

**sidebar.tsx:**
- `md:block` (line 207) - sidebar visible on desktop
- `hidden sm:flex` (line 291) - SidebarRail visible on sm+
- `md:after:hidden` (line 571) - touch target expansion on mobile only

**header.tsx:**
- `hidden md:flex` (line 22) - SearchInput hidden on mobile

**overview/layout.tsx:**
- `sm:text-2xl` (line 76) - larger title on sm+
- `md:hidden` (line 80) - mobile stats visible only below md
- `hidden md:grid` (line 99) - desktop stats visible only on md+
- `md:grid-cols-2` (line 99) - 2-column grid at md
- `lg:grid-cols-4` (line 99) - 4-column grid at lg
- `md:block` (line 127) - growth card visible on md+
- `lg:grid lg:grid-cols-7` (line 148) - main content grid at lg
- `lg:col-span-4` (line 149) - left column width at lg
- `lg:col-span-3` (line 157) - right column width at lg
- `hidden lg:block` (line 152, 159) - charts visible only on lg+

**page-container.tsx:**
- `md:px-6` (line 58, 79) - larger padding on md+
- `sm:gap-4` (line 59, 80) - larger gap on sm+

**pending-tours-widget.tsx:**
- `sm:flex-row` (line 233) - row layout on sm+
- `sm:items-start` (line 233) - alignment on sm+
- `sm:justify-between` (line 233) - spacing on sm+
- `sm:w-auto` (line 235, 275) - auto width on sm+
- `sm:w-28` (line 164, 186) - fixed width on sm+
- `sm:flex-none` (line 281, 288, 297) - prevent flex on sm+

**timeless-rule-trips-widget.tsx:**
- `sm:flex-row` (line 119) - row layout on sm+
- `sm:w-auto` (line 120) - auto width on sm+
- `sm:w-[240px]` (line 263) - fixed width on sm+
- `sm:w-28` (line 164, 186) - fixed width on sm+
- `sm:flex-none` (line 164, 186) - prevent flex on sm+

**bar-graph.tsx:**
- `sm:flex-row` (line 86) - header row on sm+
- `sm:border-b-0` (line 87) - remove border on sm+
- `sm:border-l` (line 95) - add left border on sm+
- `sm:px-6` (line 108) - larger padding on sm+
- `sm:pt-6` (line 108) - larger padding on sm+

**upcoming-trips.tsx:**
- `sm:flex-row` (line 109) - header row on sm+
- `sm:items-center` (line 109) - center align on sm+
- `sm:justify-between` (line 109) - space between on sm+
- `sm:w-auto` (line 122) - auto width on sm+
- `sm:w-[120px]` (line 149) - fixed width on sm+
- `sm:flex-none` (line 149) - prevent flex on sm+

### Consistency Assessment

**Mobile-First Approach:**
- Generally consistent - base styles are for mobile, overrides for larger screens
- Most components use `sm:` and `md:` prefixes correctly
- No desktop-first patterns detected

**Inconsistencies:**
- Some components use `sm:` for layout changes, others use `md:`
- Charts hidden at `lg:` while other content changes at `md:` - creates a "gap" where screen is too wide for mobile layout but too narrow for charts
- No `xl:` or `2xl:` usage - may not optimize for very large screens

---

## 8. Current /driver Mobile Patterns

### Driver Portal Mobile Design

**Layout:**
- From `driver/layout.tsx`:
  - Mobile-first, no sidebar
  - Constrained to `max-w-lg` (512px) for comfortable one-handed reading
  - Uses safe-area-inset for notched devices: `pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]`
  - Single column layout with DriverHeader at top

**Navigation:**
- Burger menu (Sheet) with 3 links: Startseite, Touren, Schichtenzettel
- Header title is tappable to return to startseite
- No persistent sidebar

**Card Layout:**
- `rounded-xl border-l-4 shadow-sm` with left accent color from status
- Cards use `border-l-4` for visual status indication
- Shadow-sm for subtle depth

**Touch Targets:**
- Minimum 48px on all interactive elements (per docs/driver-portal.md line 213)
- Large buttons and controls
- Shift status card with pulsing dot for live feedback

**Typography:**
- Larger text sizes for readability
- Clear hierarchy with headings and descriptions

**Patterns to Apply to /dashboard:**
1. **Max-width constraint:** Use `max-w-lg` or similar on mobile to prevent overly wide content
2. **Safe-area-inset:** Add safe-area-inset handling for notched devices
3. **Touch targets:** Increase all buttons and interactive elements to 48px minimum
4. **Card-based layout:** Enhance card visual design with accent borders and shadows
5. **Mobile-first navigation:** Consider bottom navigation or drawer for mobile
6. **Typography:** Increase font sizes on mobile for better readability
7. **Single-column layout:** Stack all content vertically on mobile
8. **Remove hover interactions:** Replace with tappable alternatives

---

## Senior Recommendation

### Top 3 Mobile Issues and Suggested Approach

#### 1. Touch Targets Below Recommended Minimum

**Issue:** Many interactive elements have touch targets below 44px:
- SidebarTrigger: 28px
- Widget action buttons: 32px
- Select triggers: 32px
- Date/time inputs: 32px

**Impact:** Difficult to tap accurately on mobile, leads to frustration and accidental taps.

**Suggested Approach:**
- Create a mobile-aware button size system: use `h-10` (40px) or `h-12` (48px) on mobile, smaller sizes on desktop
- Add utility class `touch-target-mobile` that applies `min-h-[44px] min-w-[44px]` on screens below 768px
- Update all icon buttons, form inputs, and action buttons to use this system
- For sidebar trigger, increase to `size-10` (40px) or add padding to expand touch area
- Consider using `after:absolute after:-inset-2 md:after:hidden` pattern (already used in sidebar.tsx line 428) to expand touch targets on mobile without affecting visual size

**Priority:** High - affects usability and accessibility

---

#### 2. Charts Completely Hidden on Mobile

**Issue:** All charts (BarGraph, area_stats, pie_stats) are hidden below `lg` (1024px). Mobile users lose all data visualization.

**Impact:** Mobile users cannot see occupancy analysis, revenue trends, or other visual insights. Dashboard becomes less useful on mobile.

**Suggested Approach:**
- **Option 1 (Recommended):** Create simplified mobile chart views
  - Replace complex charts with sparkline or summary cards on mobile
  - Show key metrics as simple numbers with trend indicators
  - Use `sm:hidden lg:block` pattern: show simplified version below 1024px, full version above
  - Example: Replace BarGraph with "Peak hours: 14:00-16:00 (12 trips)" card on mobile

- **Option 2:** Responsive chart redesign
  - Keep charts but make them mobile-friendly
  - Reduce chart height to 200px on mobile
  - Simplify axes (fewer labels, smaller font)
  - Make chart tappable to show detail in a sheet/drawer
  - Use horizontal scroll for wide charts

- **Option 3:** Progressive disclosure
  - Show chart thumbnails or mini-versions on mobile
  - Tap to expand to full chart in a modal
  - Maintain data access while conserving space

**Priority:** High - significant feature loss on mobile

---

#### 3. No Safe-Area-Inset Handling for Notched Devices

**Issue:** Dashboard layout does not use safe-area-inset CSS environment variables. Driver portal does use them correctly. Content may be obscured by device notches on iPhone X+, Pixel phones with cutouts, etc.

**Impact:** On devices with notches or rounded corners, header/sidebar content may be partially hidden or touch targets may be in unreachable areas.

**Current State (driver/layout.tsx - correct):**
```tsx
className='pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]'
```

**Current State (dashboard/layout.tsx - missing):**
```tsx
className='h-svh max-h-svh overflow-hidden'
// No safe-area-inset handling
```

**Suggested Approach:**
- Add safe-area-inset to dashboard layout wrapper
- Apply to outermost container in `dashboard/layout.tsx`:
  ```tsx
  <div className='h-svh max-h-svh overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]'>
  ```
- Also apply to header to ensure hamburger trigger is reachable
- Consider adding to sidebar Sheet overlay as well
- Test on iPhone X+, Pixel 4+, and other devices with notches

**Priority:** Medium - affects subset of users with newer devices, but important for modern device support

---

### Additional Recommendations (Lower Priority)

#### 4. Max-Width Constraint for Mobile Readability
- Add `max-w-lg` (512px) or similar constraint on mobile content
- Prevents overly wide content that's hard to read
- Matches driver portal pattern

#### 5. Replace Hover-Only Interactions
- Tooltips in charts should be tap-triggered on mobile
- SidebarRail hover edge should have tap trigger on mobile
- Consider using `pointer-events-none` on desktop, enable on mobile

#### 6. Improve Mobile Stats Display
- Instead of hiding 2 stats cards, implement horizontal scroll or swipe
- Or use a carousel/tabs to show all stats on mobile
- Ensure users have access to all metrics

#### 7. Widget Input Sizing
- Increase date/time inputs from `h-8` to `h-10` or `h-12` on mobile
- Make select dropdowns larger on mobile
- Consider using native date/time pickers on mobile for better UX

#### 8. Responsive Breakpoint Consistency
- Consider standardizing on `md:` (768px) as primary mobile/desktop split
- Charts hidden at `lg:` creates awkward gap - consider moving to `md:` or adding intermediate layout at `md:`
- Document breakpoint strategy in mobile-ui.md

---

## Implementation Order

1. **Phase 1 (Quick Wins):**
   - Add safe-area-inset handling (1 hour)
   - Increase touch targets to 44px minimum (2-3 hours)
   - Add max-w-lg constraint on mobile (30 minutes)

2. **Phase 2 (Feature Parity):**
   - Create mobile-friendly chart alternatives (4-6 hours)
   - Implement horizontal scroll or carousel for stats (2-3 hours)

3. **Phase 3 (UX Polish):**
   - Replace hover interactions with tap alternatives (3-4 hours)
   - Improve widget input sizing (1-2 hours)
   - Standardize breakpoints and document (1 hour)

**Total Estimated Effort:** 14-20 hours

---

## Testing Recommendations

- Test on iPhone X+, iPhone 14 Pro, Pixel 4+ (notched devices)
- Test on iPad (768px breakpoint boundary)
- Test on small phones (iPhone SE, 375px width)
- Test on large phones (iPhone 14 Pro Max, 430px width)
- Test with one-handed use scenarios
- Test with accessibility tools (VoiceOver, TalkBack)
- Test in landscape mode on phones
