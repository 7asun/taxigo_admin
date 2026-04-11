# Phase 10 — Abrechnung Navigation Restructure & Dashboard

## Role & mindset

You are implementing a professional, production-grade restructure of the billing
navigation section. Think like the team behind Stripe Billing or Lexoffice: every
interaction must feel intentional, every screen must have a clear mental model.
**Do not invent new patterns.** This codebase has established components, hooks,
and design tokens — your job is to compose them correctly, not to create
alternatives.

Before writing a single line of code, read the following files in full:

- `src/config/nav-config.ts` — full nav tree
- `src/components/layout/app-sidebar.tsx` — current sidebar render logic
- `src/app/dashboard/overview/layout.tsx` — KPI card pattern (StatsCard)
- `src/features/invoices/components/pdf-vorlagen/pdf-vorlagen-settings-page.tsx` — PanelList pattern
- `src/features/invoices/components/pdf-vorlagen/vorlage-editor-panel.tsx` — editor panel sub-components
- `src/features/invoices/components/invoice-templates-settings-page.tsx` — text block CRUD pattern
- `src/features/invoices/api/invoices.api.ts` — updateInvoiceStatus, listInvoices
- `src/features/invoices/api/pdf-vorlagen.api.ts` — all Vorlage CRUD functions
- `src/features/invoices/api/invoice-text-blocks.api.ts` — all text block functions
- `src/features/invoices/hooks/use-invoices.ts` — useInvoices hook + InvoiceSummary
- `src/features/invoices/components/invoice-detail/invoice-actions.tsx` — existing "Als bezahlt markieren" pattern
- `src/features/invoices/components/invoice-list-table/columns.tsx` — InvoiceStatusBadge
- `src/features/invoices/types/invoice.types.ts` — InvoiceRow, InvoiceStatus, InvoiceStatusTransition
- `src/features/invoices/types/pdf-vorlage.types.ts` — PdfVorlageRow, payloads
- `src/features/angebote/types/angebot.types.ts` — AngebotRow, AngebotStatus
- `src/query/keys/invoices.ts` — all invoice query key factories
- `src/components/ui/badge.tsx` — Badge variants
- `src/components/icons.tsx` — available icons
- `src/app/dashboard/rechnungsempfaenger/page.tsx` — page shell pattern to copy

---

## Design system — NON-NEGOTIABLE

**Use exclusively what already exists in the project.**

### Colors
- All colors via CSS variables: `--color-primary`, `--color-error`,
  `--color-text-muted`, `--color-surface`, etc.
- No hardcoded hex values, no Tailwind color classes like `text-red-500`.
- Use `text-destructive` / `bg-destructive` only if that already maps to
  `--color-error` in this project's Tailwind config — otherwise use
  `style={{ color: 'var(--color-error)' }}`.
- The "Überfällig" KPI card gets the error color accent. Use exactly the same
  pattern the existing `StatsCard` uses for its accent variant.

### Components — always reuse, never recreate
| Need | Use |
|---|---|
| KPI cards | `StatsCard` from `src/features/dashboard/components/stats-card` |
| Left-list + right-editor layout | `PanelList` (already used in `pdf-vorlagen-settings-page.tsx`) |
| Panel shell, header, body, footer | `Panel`, `PanelHeader`, `PanelBody`, `PanelFooter` (used in `vorlage-editor-panel.tsx`) |
| Invoice status badge | `InvoiceStatusBadge` from `invoice-list-table/columns.tsx` |
| Status badge primitive | `Badge` from `src/components/ui/badge` |
| Select dropdowns | shadcn `Select` — same as used in `payer-details-sheet.tsx` lines 728–803 |
| Collapsible sections | shadcn `Collapsible` — same as used in `vorlage-editor-panel.tsx` |
| Sidebar items | `SidebarMenuButton`, `SidebarMenuAction`, `SidebarMenuSub`,
  `SidebarMenuSubButton` — all already imported in `app-sidebar.tsx` |
| Icon | `Icon` component with `name` prop — same pattern as existing nav items |
| Page shell / auth wrapper | Copy the exact pattern from
  `src/app/dashboard/rechnungsempfaenger/page.tsx` |
| Optimistic mutation | React Query `onMutate` / `onError` / `onSettled` —
  same pattern as `useUpdateInvoiceStatus` in `invoice-actions.tsx` |

### Typography & spacing
- Font sizes via `--text-*` tokens only. No `text-sm`, `text-lg` Tailwind
  classes unless those map to the project's token system.
- Spacing via `--space-*` tokens or the equivalent Tailwind spacing scale
  already in use in the project.
- Match the density of existing list tables — do not introduce new padding
  values.

---

## What to build — 10 tasks in order

Work through these sequentially. Do not start the next task until the current
one compiles and is logically complete.

---

### Task 1 — DB migration

**Create:** `supabase/migrations/[NEXT_TIMESTAMP]_pdf_vorlagen_text_blocks.sql`

Use a timestamp strictly after the latest existing migration file in
`supabase/migrations/`. Do not guess — run `ls supabase/migrations/` and
use the highest timestamp + 1 minute.

```sql
-- Phase 10: add optional text-block FKs to pdf_vorlagen.
-- A single Vorlage now owns both the PDF column layout (existing) and
-- the intro/outro letter text (new). These FKs are nullable so all
-- existing Vorlagen continue to work unchanged — the payer-level
-- fallback chain still applies when these are null.
ALTER TABLE pdf_vorlagen
  ADD COLUMN intro_block_id uuid
    REFERENCES invoice_text_blocks(id) ON DELETE SET NULL,
  ADD COLUMN outro_block_id uuid
    REFERENCES invoice_text_blocks(id) ON DELETE SET NULL;

COMMENT ON COLUMN pdf_vorlagen.intro_block_id IS
  'Optional FK to invoice_text_blocks (type=intro). When set, used as the
   default intro text for invoices resolved to this Vorlage in the builder.
   Does NOT retroactively affect already-issued invoices (those freeze their
   own intro_block_id snapshot at creation time per §14 UStG).';
COMMENT ON COLUMN pdf_vorlagen.outro_block_id IS
  'Optional FK to invoice_text_blocks (type=outro). Same semantics as
   intro_block_id — builder default only, never retroactive.';
```

No new RLS policies needed (existing `pdf_vorlagen` policies scope by
`company_id` column list — confirm this does not need updating).

---

### Task 2 — Types & API update

**File:** `src/features/invoices/types/pdf-vorlage.types.ts`

Add to `PdfVorlageRow`:
```ts
/** FK to invoice_text_blocks (intro). Null = fall back to payer/company default. */
intro_block_id: string | null;
/** FK to invoice_text_blocks (outro). Same fallback semantics as intro_block_id. */
outro_block_id: string | null;
```

Add to `PdfVorlageUpdatePayload`:
```ts
intro_block_id?: string | null;
outro_block_id?: string | null;
```

**File:** `src/features/invoices/api/pdf-vorlagen.api.ts`

- In `updatePdfVorlage`: include `intro_block_id` and `outro_block_id` in the
  upsert patch object (only when present in the payload — use `...(payload.intro_block_id !== undefined && { intro_block_id: payload.intro_block_id })` pattern).
- In `createPdfVorlage`: explicitly set both to `null` in the insert object.

Add inline JSDoc above both functions explaining the new fields.

---

### Task 3 — Text-block resolution helper (builder defaults only)

**Create:** `src/features/invoices/lib/resolve-default-text-blocks.ts`

```ts
/**
 * resolveDefaultTextBlockIds
 *
 * Resolves the default intro/outro text block IDs for a new invoice being
 * drafted in the builder. This is for UI DEFAULT PRE-SELECTION ONLY.
 *
 * Priority order (highest → lowest):
 *   1. resolvedVorlage.intro_block_id / outro_block_id  (Vorlage-level — Phase 10)
 *   2. payer.default_intro_block_id / default_outro_block_id  (payer-level)
 *   3. companyDefaultBlocks (invoice_text_blocks WHERE is_default = true)
 *   4. null (no pre-selection; hardcoded fallback text used at PDF render time)
 *
 * IMPORTANT: This function is used only for pre-populating builder Step 4/5
 * defaults. It does NOT affect already-issued invoices. Issued invoices freeze
 * their own intro_block_id / outro_block_id snapshot at creation time per
 * §14 UStG — those are immutable and must never be derived from this function.
 */
export function resolveDefaultTextBlockIds(
  resolvedVorlage: PdfVorlageRow | null,
  payer: { default_intro_block_id: string | null; default_outro_block_id: string | null } | null,
  companyDefaultBlocks: GroupedTextBlocks,
): { introBlockId: string | null; outroBlockId: string | null }
```

Wire this helper into the invoice builder's Step 4/5 confirm defaults. Locate
where `invoices.intro_block_id` default is currently set in
`step-4-confirm.tsx` (or equivalent) and replace/extend with this helper.

---

### Task 4 — `nav-config.ts` restructure

**File:** `src/config/nav-config.ts`

Add this block comment at the very top of the file (before imports):

```ts
/**
 * nav-config.ts — App navigation tree
 *
 * Three item variants (Phase 10):
 *
 *  1. LEAF — url is a real page, no children. Entire row is a Link.
 *     Example: Dashboard, Fahrten, Dokumentation.
 *
 *  2. COLLAPSE-ONLY GROUP — url === '#', has children. Parent row is a
 *     CollapsibleTrigger only — clicking navigates nowhere.
 *     Example: Account, Einstellungen.
 *
 *  3. EXPAND-AND-NAVIGATE — url is a real page AND has children.
 *     Clicking the label navigates to the parent page.
 *     A separate chevron-only button toggles the submenu.
 *     Example: Abrechnung → /dashboard/abrechnung.
 *
 * Rules for adding new items:
 *  - Billing-related items belong under Abrechnung (type 3), not Einstellungen.
 *  - App-wide settings belong under Einstellungen (type 2).
 *  - Shortcuts must not duplicate existing combinations.
 */
```

Restructure `navItems` exactly as follows — keep all existing shortcuts
unchanged unless listed as changed here:

```ts
[
  // Dashboard — leaf
  { title: 'Dashboard', url: '/dashboard/overview', icon: 'dashboard', shortcut: ['d','d'] },

  // Fahrten — leaf
  { title: 'Fahrten', url: '/dashboard/trips', icon: 'trips', shortcut: ['t','t'] },

  // Abrechnung — EXPAND-AND-NAVIGATE (url is real page, has children)
  {
    title: 'Abrechnung',
    url: '/dashboard/abrechnung',   // new dashboard page
    icon: 'billing',
    shortcut: ['a','a'],
    items: [
      { title: 'Rechnungen',          url: '/dashboard/invoices',                          shortcut: ['r','r'] },
      { title: 'Angebote',            url: '/dashboard/angebote',                          shortcut: ['g','g'] },
      { title: 'Rechnungsempfänger',  url: '/dashboard/abrechnung/rechnungsempfaenger',    shortcut: ['r','e'] },
      { title: 'Vorlagen',            url: '/dashboard/abrechnung/vorlagen',               shortcut: ['v','v'] },
    ],
  },

  // Account — collapse-only group (url stays '#')
  {
    title: 'Account',
    url: '#',
    icon: 'user', // use existing icon — confirm name in icons.tsx
    items: [
      { title: 'Fahrgäste',    url: '/dashboard/clients',     shortcut: ['f','f'] },
      { title: 'Fahrer',       url: '/dashboard/drivers',     shortcut: ['f','a'] },
      { title: 'Kostenträger', url: '/dashboard/payers',      shortcut: ['k','k'] },
      { title: 'Fremdfirmen',  url: '/dashboard/fremdfirmen', shortcut: ['f','r'] },
      // Rechnungsempfänger removed — moved to Abrechnung section above
    ],
  },

  // Einstellungen — collapse-only group (url stays '#')
  {
    title: 'Einstellungen',
    url: '#',
    icon: 'settings', // confirm icon name in icons.tsx
    items: [
      { title: 'Unternehmen',            url: '/dashboard/settings/company',                 shortcut: ['e','u'] },
      { title: 'Unzugeordnete Fahrten',  url: '/dashboard/settings/unzugeordnete-fahrten',   shortcut: ['u','f'] },
      // Rechnungsvorlagen and PDF-Vorlagen removed — unified under Abrechnung > Vorlagen
    ],
  },

  // Dokumentation — leaf
  { title: 'Dokumentation', url: '/dashboard/documentation', icon: 'help', shortcut: ['h','h'] },
]
```

---

### Task 5 — Sidebar: expand-and-navigate pattern

**File:** `src/components/layout/app-sidebar.tsx`

Add this comment block directly above the item render logic (wherever the
current `item.items?.length > 0` branch starts):

```tsx
/**
 * Item render variants — three cases:
 *
 *  1. LEAF (no children): render as Link + SidebarMenuButton.
 *
 *  2. COLLAPSE-ONLY (url === '#', has children): entire row is a
 *     CollapsibleTrigger. Parent does not navigate. Current behaviour
 *     unchanged for Account and Einstellungen.
 *
 *  3. EXPAND-AND-NAVIGATE (url !== '#', has children): label is a Link
 *     (navigates to parent page); chevron is a SEPARATE SidebarMenuAction
 *     acting as CollapsibleTrigger. This prevents the label click from
 *     toggling the menu — it only navigates. Used for Abrechnung.
 *     defaultOpen when pathname starts with item.url.
 */
```

Add the expand-and-navigate branch. Detection:

```ts
const isExpandAndNavigate =
  !!item.url && item.url !== '#' && (item.items?.length ?? 0) > 0;
```

Render for expand-and-navigate:

```tsx
<SidebarMenuItem>
  <Collapsible
    defaultOpen={pathname.startsWith(item.url!)}
    className="group/collapsible w-full"
  >
    <div className="flex items-center w-full">
      {/* Label navigates — uses same SidebarMenuButton as leaf items */}
      <SidebarMenuButton
        asChild
        tooltip={item.title}
        isActive={pathname === item.url}
      >
        <Link href={item.url!}>
          {item.icon && <Icon name={item.icon} />}
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>

      {/* Chevron only — toggles submenu, does NOT navigate */}
      <CollapsibleTrigger asChild>
        <SidebarMenuAction
          aria-label={`${item.title} Abschnitt ein-/ausklappen`}
          className="ml-auto transition-transform duration-200
            group-data-[state=open]/collapsible:rotate-90"
        >
          <ChevronRight className="h-4 w-4" />
        </SidebarMenuAction>
      </CollapsibleTrigger>
    </div>

    <CollapsibleContent>
      <SidebarMenuSub>
        {item.items!.map((child) => (
          <SidebarMenuSubItem key={child.title}>
            <SidebarMenuSubButton
              asChild
              isActive={pathname === child.url}
            >
              <Link href={child.url}>{child.title}</Link>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ))}
      </SidebarMenuSub>
    </CollapsibleContent>
  </Collapsible>
</SidebarMenuItem>
```

**Important:** `ChevronRight` is likely already imported — check before adding.
Do not import anything that is already in the file.

---

### Task 6 — Abrechnung dashboard page

#### New files

**`src/app/dashboard/abrechnung/page.tsx`**

Copy the exact auth + metadata shell pattern from
`src/app/dashboard/rechnungsempfaenger/page.tsx`. Render `<AbrechnungOverviewPage />`.

**`src/features/invoices/components/abrechnung-overview/use-abrechnung-kpis.ts`**

```ts
/**
 * useAbrechnungKpis
 *
 * Derives four billing KPIs from the full invoice + Angebote lists.
 * All computation is client-side over the fetched lists (no server aggregate
 * endpoint exists). If invoice volume grows beyond ~500 rows, replace with
 * a dedicated Supabase RPC that returns pre-aggregated values.
 *
 * KPI definitions:
 *
 *  openCount / openTotal:
 *    Invoices where status === 'sent' AND NOT overdue.
 *
 *  overdueCount / overdueTotal:
 *    Invoices where status === 'sent' AND
 *    addDays(parseISO(inv.created_at), inv.payment_due_days ?? 14) < startOfToday().
 *    (No due_date column exists — derive from created_at + payment_due_days.)
 *
 *  thisMonthCount / thisMonthTotal:
 *    Invoices where sent_at is within the current calendar month
 *    (isSameMonth(parseISO(inv.sent_at), new Date())).
 *    Falls back to created_at if sent_at is null.
 *
 *  pendingAngeboteCount:
 *    Angebote where status === 'sent'.
 *
 * Uses existing hooks:
 *   useInvoices() — from src/features/invoices/hooks/use-invoices.ts
 *   useAngebote() — from src/features/angebote/hooks/use-angebote.ts (or equivalent)
 *
 * Returns totals as number (cents or euros — match the existing InvoiceSummary
 * pattern in use-invoices.ts to stay consistent).
 */
```

Implement using `date-fns` functions (`addDays`, `parseISO`, `startOfToday`,
`isSameMonth`) — confirm these are already used in the project before importing.

**`src/features/invoices/components/abrechnung-overview/abrechnung-kpi-cards.tsx`**

```tsx
/**
 * AbrechnungKpiCards
 *
 * Four KPI cards for the Abrechnung overview.
 * Uses StatsCard from src/features/dashboard/components/stats-card — the exact
 * same component used on /dashboard/overview. Do not create a new card component.
 *
 * Cards:
 *   1. "Offene Rechnungen"  — openCount + formatted openTotal    — neutral accent
 *   2. "Überfällig"         — overdueCount + overdueTotal        — error accent
 *   3. "Diesen Monat"       — thisMonthCount + thisMonthTotal    — primary accent
 *   4. "Angebote ausstehend"— pendingAngeboteCount              — neutral accent
 *
 * Each card navigates to /dashboard/invoices?status=[relevant_status] on click
 * (see Task 6 note on deep-link filter — implement only if InvoiceListTable
 * already supports URL search params; otherwise omit and add as follow-up).
 *
 * Currency formatting: use the same formatter already used in StatsCard /
 * InvoiceSummary — do not introduce a new Intl.NumberFormat instance if one
 * already exists in the project.
 */
```

**`src/features/invoices/components/abrechnung-overview/abrechnung-recent-invoices.tsx`**

```tsx
/**
 * AbrechnungRecentInvoices
 *
 * Shows the 10 most recently created invoices (sorted by created_at DESC,
 * limit 10 — filter via the existing listInvoices with appropriate params).
 *
 * Columns: Nummer | Empfänger | Betrag | Fällig | Status | Aktionen
 *
 * "Fällig" column: derived as addDays(parseISO(inv.created_at), inv.payment_due_days ?? 14).
 * Format as locale date string. If overdue and status === 'sent', render in
 * var(--color-error) — same pattern as any error text in the project.
 *
 * Quick-pay action (Aktionen column):
 *   - Shown only when status === 'sent'.
 *   - Render as an icon Button (size="icon", variant="ghost") with a checkmark
 *     icon and tooltip "Als bezahlt markieren".
 *   - Use the EXACT same mutation pattern as invoice-actions.tsx:
 *       useUpdateInvoiceStatus → mutate('paid')
 *     with React Query optimistic update (onMutate sets status to 'paid' in
 *     cache, onError rolls back, onSettled invalidates invoiceKeys.list()).
 *   - On success: the row's status badge updates immediately (optimistic).
 *   - Do NOT duplicate the mutation hook — import useUpdateInvoiceStatus
 *     from wherever it is defined, or extract it to a shared location if
 *     it is currently inline in invoice-actions.tsx.
 *
 * Row click: navigate to /dashboard/invoices/[id].
 *
 * InvoiceStatusBadge: import from invoice-list-table/columns.tsx — the exact
 * same badge used in the invoices list table. Do not create a new one.
 */
```

**`src/features/invoices/components/abrechnung-overview/abrechnung-overview-page.tsx`**

Compose the three components above into a page layout that matches the density
and spacing of `/dashboard/overview`. Use the same `<main>` / container pattern.
Heading: "Abrechnung" with a "Neue Rechnung" button (links to
`/dashboard/invoices/new`) in the top-right — same header pattern as other
list pages.

---

### Task 7 — Move Rechnungsempfänger route

**Create:** `src/app/dashboard/abrechnung/rechnungsempfaenger/page.tsx`

Copy the complete content of `src/app/dashboard/rechnungsempfaenger/page.tsx`.
No changes to the underlying `RechnungsempfaengerPage` component.

**Replace** `src/app/dashboard/rechnungsempfaenger/page.tsx` with:

```ts
// Route moved to /dashboard/abrechnung/rechnungsempfaenger in Phase 10.
// This redirect preserves existing bookmarks.
import { permanentRedirect } from 'next/navigation';
export default function Page() {
  permanentRedirect('/dashboard/abrechnung/rechnungsempfaenger');
}
```

---

### Task 8 — Unified Vorlagen page

**Create:** `src/app/dashboard/abrechnung/vorlagen/page.tsx`

Same auth shell pattern as all other dashboard pages.

**Create:** `src/features/invoices/components/vorlagen/vorlagen-page.tsx`

Layout: reuse the **exact same two-column PanelList layout** from
`pdf-vorlagen-settings-page.tsx`. Left panel = list of Vorlagen. Right panel =
unified editor.

The left `PanelList` is identical to `PdfVorlagenPanel` — you may refactor it
or re-compose it; do not rewrite the PanelList component itself.

**Create:** `src/features/invoices/components/vorlagen/vorlage-text-section.tsx`

```tsx
/**
 * VorlageTextSection
 *
 * New section for the unified Vorlage editor. Renders two Select dropdowns
 * (Einleitung, Schlussformel) for assigning invoice_text_blocks to this Vorlage.
 *
 * Use the EXACT same shadcn Select pattern as payer-details-sheet.tsx lines
 * 728–803 — same component, same label-above-select layout, same "Speichern"
 * button placement.
 *
 * Options in each select:
 *   - "Keine (Kostenträger-Standard)" → value null
 *     Explanation text below: "Verwendet den Standard-Text des Kostenträgers."
 *   - One option per text block of the relevant type (intro / outro).
 *     Show block name. On hover/focus: show first 80 chars of content as title
 *     attribute (tooltip).
 *
 * Props:
 *   introBlockId: string | null       — current pdf_vorlagen.intro_block_id
 *   outroBlockId: string | null       — current pdf_vorlagen.outro_block_id
 *   textBlocks: GroupedTextBlocks     — from listInvoiceTextBlocks()
 *   onChange: (field: 'intro_block_id' | 'outro_block_id', id: string | null) => void
 *
 * Below the selects: a small link "Texte verwalten →" that opens
 * /dashboard/settings/invoice-templates in a new tab
 * (target="_blank" rel="noopener noreferrer").
 * Note: that route will redirect to /dashboard/abrechnung/vorlagen after Task 9,
 * so update this link to point directly to a dedicated text-blocks admin section
 * if one exists, OR keep as-is if text-block authoring remains inline on this page.
 *
 * Design: match the section separator / collapsible style used in
 * vorlage-editor-panel.tsx. Use the same Collapsible + section header pattern.
 */
```

**Extend** `VorlageEditorPanel` (or its replacement in this unified editor) to
include `VorlageTextSection` as a new collapsible section below the existing
column layout section. The section header: "Brieftext (Einleitung & Schlussformel)".

Save: `updatePdfVorlage` call must include `intro_block_id` and `outro_block_id`
from the form state alongside the existing column/layout fields.

---

### Task 9 — Old route redirects

**Replace content of:**

`src/app/dashboard/settings/pdf-vorlagen/page.tsx`:
```ts
// Route moved to /dashboard/abrechnung/vorlagen in Phase 10 (unified Vorlagen editor).
import { permanentRedirect } from 'next/navigation';
export default function Page() {
  permanentRedirect('/dashboard/abrechnung/vorlagen');
}
```

`src/app/dashboard/settings/invoice-templates/page.tsx`:
```ts
// Route moved to /dashboard/abrechnung/vorlagen in Phase 10 (unified Vorlagen editor).
import { permanentRedirect } from 'next/navigation';
export default function Page() {
  permanentRedirect('/dashboard/abrechnung/vorlagen');
}
```

**Also grep** for any hardcoded links to these old routes inside:
- `src/features/payers/components/payer-details-sheet.tsx`
- Any `href` pointing to `/dashboard/settings/invoice-templates`
  or `/dashboard/settings/pdf-vorlagen`
- Any `href` pointing to `/dashboard/rechnungsempfaenger`

Update all found links to their new paths.

---

### Task 10 — Docs & inline comments

#### New doc: `docs/navigation.md`

```markdown
# Navigation structure

## Sidebar item variants

Three variants exist as of Phase 10:

### 1. Leaf
`url` is a real page, `items` is absent or empty.
The entire row renders as a `Link + SidebarMenuButton`.
Examples: Dashboard, Fahrten, Dokumentation.

### 2. Collapse-only group
`url === '#'`, `items` is non-empty.
The parent row is a `CollapsibleTrigger` only — clicking toggles the subtree,
does not navigate.
Examples: Account, Einstellungen.

### 3. Expand-and-navigate
`url` is a real page AND `items` is non-empty.
The label (`Link + SidebarMenuButton`) navigates to the parent page.
A separate chevron `SidebarMenuAction` acts as `CollapsibleTrigger`.
The submenu auto-opens when `pathname.startsWith(item.url)`.
Example: Abrechnung → /dashboard/abrechnung.

## Abrechnung section (Phase 10)

All billing-related features are consolidated here:
- /dashboard/abrechnung          — Billing overview dashboard (KPIs + recent invoices)
- /dashboard/invoices            — Full invoice list
- /dashboard/angebote            — Quotes list
- /dashboard/abrechnung/rechnungsempfaenger — Invoice recipient catalog
- /dashboard/abrechnung/vorlagen — Unified Vorlagen editor (PDF layout + letter text)

## Removed from nav

- Rechnungsempfänger was under Account — moved to Abrechnung (Phase 10)
- Rechnungsvorlagen was under Einstellungen — unified into Abrechnung > Vorlagen (Phase 10)
- PDF-Vorlagen was under Einstellungen — unified into Abrechnung > Vorlagen (Phase 10)

## Old routes

All old routes issue `permanentRedirect` to the new paths. No bookmarks break.

## Cmd+K (kbar)

`src/components/kbar/index.tsx` imports `navItems` and flattens children
automatically. The Abrechnung parent item (url !== '#') is included as a
navigable action. No structural changes needed to kbar.
```

#### New doc: `docs/abrechnung-overview.md`

Document:
- The four KPI definitions (open, overdue, this month, pending Angebote)
- Overdue derivation formula
- Quick-pay optimistic update pattern and which invoice statuses allow it
- Note about client-side KPI aggregation and future RPC migration path

#### Update existing docs

`docs/pdf-vorlagen.md` — add section:

```markdown
## Unified Vorlagen editor (Phase 10)

`pdf_vorlagen` now has optional `intro_block_id` / `outro_block_id` FK columns
(migration `[MIGRATION_TIMESTAMP]_pdf_vorlagen_text_blocks.sql`).

These are used exclusively for **builder defaults** — pre-selecting the intro/
outro text in the invoice builder's Step 4/5. They do NOT retroactively affect
already-issued invoices, which freeze their own `intro_block_id` / `outro_block_id`
at creation time per §14 UStG.

Updated resolution chain for builder defaults:
1. `pdf_vorlagen.intro_block_id / outro_block_id` (Vorlage-level — Phase 10)
2. `payers.default_intro_block_id / default_outro_block_id` (payer-level)
3. `invoice_text_blocks WHERE is_default = true` (company default)
4. Hardcoded fallback strings in `InvoicePdfCoverBody`

The settings route `/dashboard/settings/pdf-vorlagen` now permanently redirects
to `/dashboard/abrechnung/vorlagen`.
```

`docs/invoice-text-templates.md` — update the resolution chain section to match
the four-level chain above. Add note that the standalone settings page at
`/dashboard/settings/invoice-templates` redirects to
`/dashboard/abrechnung/vorlagen`.

`docs/rechnungsempfaenger.md` — update the "Admin UI" section to reflect
new route `/dashboard/abrechnung/rechnungsempfaenger`.

`docs/invoices-module.md` — update any route references from the old paths
to the new paths.

#### Mandatory inline comments

Every file touched by this plan must have:

| File | Required comment |
|---|---|
| `src/config/nav-config.ts` | Top-of-file block explaining three item variants (Task 4 template) |
| `src/components/layout/app-sidebar.tsx` | Comment above the item render branch (Task 5 template) |
| `src/features/invoices/lib/resolve-default-text-blocks.ts` | Full JSDoc (Task 3 template) |
| `src/features/invoices/components/abrechnung-overview/use-abrechnung-kpis.ts` | Full JSDoc with KPI definitions and volume caveat |
| `src/features/invoices/components/abrechnung-overview/abrechnung-recent-invoices.tsx` | JSDoc explaining quick-pay pattern and optimistic update |
| `src/features/invoices/components/vorlagen/vorlage-text-section.tsx` | JSDoc explaining props, null semantics, and "Keine" option |
| `src/features/invoices/types/pdf-vorlage.types.ts` | Inline comment on each new FK field |
| `supabase/migrations/[TIMESTAMP]_pdf_vorlagen_text_blocks.sql` | COMMENT ON COLUMN for both new fields |
| All `permanentRedirect` shells | One-line comment explaining why and when the route moved |

---

## Verification checklist

Run these after all tasks are complete. Do not mark the work done until every
item passes:

```
[ ] bun run build — zero TypeScript errors, zero missing imports
[ ] bun run test (if configured) — all existing tests pass
[ ] Manual: click "Abrechnung" label → navigates to /dashboard/abrechnung
[ ] Manual: click "Abrechnung" chevron → submenu toggles, no navigation
[ ] Manual: /dashboard/abrechnung auto-expands Abrechnung submenu in sidebar
[ ] Manual: /dashboard/rechnungsempfaenger → 308 redirect to new path
[ ] Manual: /dashboard/settings/invoice-templates → 308 redirect
[ ] Manual: /dashboard/settings/pdf-vorlagen → 308 redirect
[ ] Manual: Vorlage editor — save intro_block_id → reflected in builder defaults
[ ] Manual: Quick-pay button → optimistic badge flip → confirmed on page reload
[ ] Manual: Cmd+K → type "Abrechnung" → navigates to /dashboard/abrechnung
[ ] Manual: All four KPI cards render with correct counts and totals
[ ] Manual: "Überfällig" card uses error color accent
[ ] Design check: no hardcoded hex values introduced
[ ] Design check: no new UI components created that duplicate existing ones
[ ] Docs: docs/navigation.md exists and is accurate
[ ] Docs: docs/abrechnung-overview.md exists
[ ] Docs: all updated docs reflect new routes
[ ] Comments: all files in the mandatory comment table above have their comments
```

