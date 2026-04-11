---
name: Abrechnung — Navigation Restructure & Dashboard
overview: >
  Restructure the sidebar so all billing-related features live under a single
  "Abrechnung" section with an expand-and-navigate parent item. Create a new
  Abrechnung dashboard page with KPI cards and a quick-pay invoice list. Merge
  Rechnungsvorlagen (text blocks) and PDF-Vorlagen into a single unified Vorlagen
  editor. Move Rechnungsempfänger under Abrechnung. Update all docs and add
  inline comments throughout.
todos:
  - id: db-migration-vorlage-text-blocks
    content: "Migration: add intro_block_id + outro_block_id FK columns to pdf_vorlagen"
    status: pending
  - id: nav-config-restructure
    content: "Restructure nav-config.ts: Abrechnung as expand-and-navigate parent with children"
    status: pending
  - id: sidebar-expand-and-navigate
    content: "Update app-sidebar.tsx to support expand-and-navigate pattern (navigate + chevron toggle)"
    status: pending
  - id: abrechnung-dashboard-page
    content: "Build /dashboard/abrechnung overview page with KPI cards + recent invoices + quick-pay"
    status: pending
  - id: route-rechnungsempfaenger
    content: "Move Rechnungsempfänger route under /dashboard/abrechnung/rechnungsempfaenger with redirect"
    status: pending
  - id: merged-vorlagen-editor
    content: "Merge PDF-Vorlagen + Rechnungsvorlagen into unified Vorlagen editor with text block pickers"
    status: pending
  - id: route-vorlagen
    content: "Move Vorlagen to /dashboard/abrechnung/vorlagen, add redirects from old routes"
    status: pending
  - id: update-docs-and-comments
    content: "Update all relevant docs and add inline comments across changed files"
    status: pending
isProject: true
---

# Abrechnung — Navigation Restructure & Dashboard

## Overview & Goals

The current sidebar scatters billing-related features across three unrelated
sections (top-level, Account, Einstellungen). This plan consolidates everything
under a single **Abrechnung** section that works like a professional billing
product (cf. Stripe, Lexoffice, Harvest):

- **One section** owns all billing concerns
- **Expand-and-navigate** parent item: clicking "Abrechnung" opens the dashboard,
  clicking the chevron toggles the submenu — same pattern as Linear
- **Abrechnung dashboard** with KPIs, recent invoices, and inline "mark as paid"
- **Unified Vorlagen editor** merging PDF column layout + text blocks into one
  coherent concept (same Vorlage owns both the layout and the letter text)
- **All docs updated**, all changed files have inline comments

---

## Task 1 — DB migration: add text-block FKs to `pdf_vorlagen`

**File to create:**
`supabase/migrations/20260412120000_pdf_vorlagen_text_blocks.sql`

```sql
-- Add optional text-block references to pdf_vorlagen so a single Vorlage
-- owns both the PDF column layout (existing) and the intro/outro letter text
-- (previously only on payers). This enables the unified Vorlagen editor.
--
-- Both columns are nullable: existing Vorlagen continue to resolve text blocks
-- via the payer fallback chain (payers.default_intro_block_id / outro_block_id).
-- When set, these fields take precedence over the payer assignment for invoices
-- whose resolved Vorlage is this row.

ALTER TABLE pdf_vorlagen
  ADD COLUMN intro_block_id uuid
    REFERENCES invoice_text_blocks(id) ON DELETE SET NULL,
  ADD COLUMN outro_block_id uuid
    REFERENCES invoice_text_blocks(id) ON DELETE SET NULL;

COMMENT ON COLUMN pdf_vorlagen.intro_block_id IS
  'Optional FK to invoice_text_blocks (type=intro). When set, overrides payers.default_intro_block_id for invoices using this Vorlage.';
COMMENT ON COLUMN pdf_vorlagen.outro_block_id IS
  'Optional FK to invoice_text_blocks (type=outro). When set, overrides payers.default_outro_block_id for invoices using this Vorlage.';
```

**TypeScript — update `PdfVorlageRow`** in
`src/features/invoices/types/pdf-vorlage.types.ts`:

```ts
// Add after existing fields:
/** FK to invoice_text_blocks (intro). Null = fall back to payer assignment. */
intro_block_id: string | null;
/** FK to invoice_text_blocks (outro). Null = fall back to payer assignment. */
outro_block_id: string | null;
```

**Update `PdfVorlageUpdatePayload`** to include both optional fields.

**Update `updatePdfVorlage`** in `pdf-vorlagen.api.ts` to include them in the
upsert payload.

**Update text-block resolution in `InvoicePdfDocument`**: the resolver currently
reads payer text blocks. After this migration, the priority chain becomes:

```
Priority 1: pdf_vorlagen.intro_block_id (Vorlage-level override)
Priority 2: payers.default_intro_block_id (payer-level assignment)
Priority 3: company default invoice_text_blocks WHERE is_default = true
Priority 4: hardcoded fallback text in InvoicePdfCoverBody
```

Document this updated chain in `docs/invoice-text-templates.md` (see Task 8).

---

## Task 2 — `nav-config.ts` restructure

**File:** `src/config/nav-config.ts`

Replace the current flat + Account + Einstellungen structure with:

```ts
// nav-config.ts
//
// Navigation tree for the app sidebar and Cmd+K command palette.
//
// Design principles (updated Phase 10):
//
//   1. "Abrechnung" is an expand-and-navigate item: the parent URL is a real
//      page (/dashboard/abrechnung), not '#'. The sidebar renders the parent
//      as a Link AND renders a chevron-only button for expand/collapse.
//
//   2. All billing-related features live under Abrechnung. Nothing billing-
//      related appears under Account or Einstellungen.
//
//   3. "Einstellungen" retains only truly app-wide settings (Unternehmen,
//      Unzugeordnete Fahrten). Billing-specific settings moved to Abrechnung.
//
//   4. Shortcuts: parent item shortcut navigates to the dashboard page.
//      Child shortcuts are unchanged.

export const navItems: NavItem[] = [
  {
    title: 'Dashboard',
    url: '/dashboard/overview',
    icon: 'dashboard',
    shortcut: ['d', 'd'],
  },
  {
    title: 'Fahrten',
    url: '/dashboard/trips',
    icon: 'trips',
    shortcut: ['t', 't'],
  },
  {
    // expand-and-navigate: url is a real page, not '#'
    // Clicking the label navigates; chevron button toggles children.
    title: 'Abrechnung',
    url: '/dashboard/abrechnung',        // ← NEW dashboard page
    icon: 'billing',
    shortcut: ['a', 'a'],
    items: [
      {
        title: 'Rechnungen',
        url: '/dashboard/invoices',
        shortcut: ['r', 'r'],
      },
      {
        title: 'Angebote',
        url: '/dashboard/angebote',
        shortcut: ['g', 'g'],
      },
      {
        title: 'Rechnungsempfänger',
        url: '/dashboard/abrechnung/rechnungsempfaenger', // moved (redirect from old)
        shortcut: ['r', 'e'],
      },
      {
        title: 'Vorlagen',
        url: '/dashboard/abrechnung/vorlagen',            // merged (redirect from old)
        shortcut: ['v', 'v'],
      },
    ],
  },
  {
    title: 'Account',
    url: '#',
    icon: 'user',
    items: [
      { title: 'Fahrgäste',   url: '/dashboard/clients',      shortcut: ['f', 'f'] },
      { title: 'Fahrer',      url: '/dashboard/drivers',      shortcut: ['f', 'a'] },
      { title: 'Kostenträger',url: '/dashboard/payers',       shortcut: ['k', 'k'] },
      { title: 'Fremdfirmen', url: '/dashboard/fremdfirmen',  shortcut: ['f', 'r'] },
    ],
    // NOTE: Rechnungsempfänger removed from here — moved to Abrechnung section.
  },
  {
    title: 'Einstellungen',
    url: '#',
    icon: 'settings',
    items: [
      { title: 'Unternehmen',           url: '/dashboard/settings/company',                    shortcut: ['e', 'u'] },
      { title: 'Unzugeordnete Fahrten', url: '/dashboard/settings/unzugeordnete-fahrten',      shortcut: ['u', 'f'] },
      // Rechnungsvorlagen and PDF-Vorlagen removed — now unified under Abrechnung > Vorlagen.
    ],
  },
  {
    title: 'Dokumentation',
    url: '/dashboard/documentation',
    icon: 'help',
    shortcut: ['h', 'h'],
  },
];
```

---

## Task 3 — `app-sidebar.tsx`: expand-and-navigate pattern

**File:** `src/components/layout/app-sidebar.tsx`

The current pattern treats any item with `items[]` as collapse-only (parent URL
is `#`, the entire row is a `CollapsibleTrigger`). We need a new branch for items
where `url` is a real page AND `items` is non-empty.

### Detection

```ts
// An item is "expand-and-navigate" when it has both a real URL (not '#')
// and child items. The label navigates; only the chevron toggles the subtree.
const isExpandAndNavigate = !!item.url && item.url !== '#' && !!item.items?.length;
```

### Render branch for expand-and-navigate items

```tsx
{isExpandAndNavigate ? (
  // Expand-and-navigate: label is a Link, chevron is a separate trigger button.
  // This allows users to click "Abrechnung" to reach the dashboard without
  // being forced to open the submenu first.
  <SidebarMenuItem>
    <Collapsible open={open} onOpenChange={setOpen} className="group/collapsible w-full">
      <div className="flex items-center w-full">
        {/* Navigating label — same visual as other SidebarMenuButtons */}
        <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
          <Link href={item.url!}>
            {item.icon && <Icon name={item.icon} />}
            <span>{item.title}</span>
          </Link>
        </SidebarMenuButton>

        {/* Chevron-only expand toggle — does NOT navigate */}
        <CollapsibleTrigger asChild>
          <SidebarMenuAction
            aria-label={open ? 'Abschnitt einklappen' : 'Abschnitt ausklappen'}
            // Rotate chevron when open — same convention as collapse-only items
            className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90"
          >
            <ChevronRight className="h-4 w-4" />
          </SidebarMenuAction>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        <SidebarMenuSub>
          {item.items!.map((child) => (
            <SidebarMenuSubItem key={child.title}>
              <SidebarMenuSubButton asChild isActive={pathname === child.url}>
                <Link href={child.url}>{child.title}</Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  </SidebarMenuItem>
) : /* existing collapse-only or leaf branch */ ...}
```

Add an inline comment block above the render function explaining the three item
variants:

```ts
/**
 * Sidebar item rendering — three variants:
 *
 * 1. Leaf item (no children):
 *    url is a real page. Entire row is a Link.
 *
 * 2. Collapse-only group (url === '#'):
 *    Parent row is a CollapsibleTrigger. Clicking navigates nowhere.
 *    Used for Account and Einstellungen.
 *
 * 3. Expand-and-navigate (url is real page AND has children):
 *    Label is a Link (navigates to parent dashboard).
 *    A separate chevron SidebarMenuAction toggles the subtree.
 *    Used for Abrechnung so users can reach the overview directly.
 */
```

---

## Task 4 — Abrechnung dashboard page

### New files

```
src/app/dashboard/abrechnung/
  page.tsx                         ← server shell (auth + metadata)
  layout.tsx                       ← optional, if needed

src/features/invoices/components/abrechnung-overview/
  abrechnung-overview-page.tsx     ← main client component
  abrechnung-kpi-cards.tsx         ← four KPI cards
  abrechnung-recent-invoices.tsx   ← recent invoices table with quick-pay
  use-abrechnung-kpis.ts           ← derived KPI hook
```

### KPI computation — `use-abrechnung-kpis.ts`

```ts
/**
 * Derives billing KPIs from the full unfiltered invoice list.
 *
 * We fetch all invoices once (no server-side aggregate endpoint exists yet)
 * and compute client-side. If the invoice list grows large (>500 rows),
 * replace with a dedicated Supabase RPC that returns pre-aggregated counts/sums.
 *
 * KPIs:
 *   - openCount / openTotal:    status === 'sent' and not overdue
 *   - overdueCount / overdueTotal: status === 'sent' AND
 *       created_at + payment_due_days < today
 *   - thisMonthCount / thisMonthTotal: sent_at in current calendar month
 *   - pendingAngeboteCount:     AngebotStatus === 'sent' (awaiting response)
 */
export function useAbrechnungKpis() { ... }
```

**Overdue logic** (no `due_date` column — derive it):
```ts
// Due date = created_at + payment_due_days days.
// "Overdue" = status is 'sent' AND due date < today (start of day, local TZ).
const dueDate = addDays(parseISO(inv.created_at), inv.payment_due_days ?? 14);
const isOverdue = isBefore(dueDate, startOfToday());
```

### KPI cards — `abrechnung-kpi-cards.tsx`

Four `StatsCard`-style cards matching the existing design system pattern from
`src/features/dashboard/components/stats-card`:

| Card | Value | Accent |
|---|---|---|
| Offene Rechnungen | count + formatted total | neutral |
| Überfällig | count + total | `--color-error` |
| Diesen Monat | count + total | `--color-primary` |
| Angebote ausstehend | count | neutral |

```tsx
/**
 * AbrechnungKpiCards
 *
 * Renders four KPI cards for the Abrechnung overview page.
 * Data sourced from useAbrechnungKpis() which derives values from the full
 * invoice + Angebote list. Cards match the StatsCard pattern used on
 * /dashboard/overview for visual consistency.
 *
 * "Überfällig" uses --color-error accent to draw immediate attention.
 * Clicking any card navigates to /dashboard/invoices pre-filtered by
 * the relevant status (uses InvoiceListParams.status filter).
 */
```

### Recent invoices table — `abrechnung-recent-invoices.tsx`

Show the 10 most recently created invoices. Columns:
`Nummer | Empfänger | Betrag | Status | Fällig | Aktionen`

**Quick-pay inline action:**
- For invoices with `status === 'sent'`: show a compact **"Als bezahlt markieren"**
  button directly in the Aktionen column (icon button with tooltip — a checkmark).
- On click: optimistic UI update (status badge flips to "Bezahlt" immediately),
  then `updateInvoiceStatus(id, 'paid')` mutation in the background.
- On error: revert optimistic update, show inline toast error.

```tsx
/**
 * AbrechnungRecentInvoices
 *
 * Displays the 10 most recent invoices with inline "mark as paid" action.
 *
 * Quick-pay interaction:
 *   - Uses updateInvoiceStatus(id, 'paid') from invoices.api.ts.
 *   - Optimistic update via React Query's onMutate / onError callbacks so the
 *     UI responds instantly without waiting for the DB round-trip.
 *   - Only shown for status === 'sent'. Draft, paid, and cancelled rows get
 *     a read-only status badge instead.
 *
 * Row click navigates to /dashboard/invoices/{id} for full detail.
 */
```

---

## Task 5 — Move Rechnungsempfänger route

### New route
`src/app/dashboard/abrechnung/rechnungsempfaenger/page.tsx`

Copy the existing page shell from
`src/app/dashboard/rechnungsempfaenger/page.tsx` — same component, new path.

### Redirect from old route
`src/app/dashboard/rechnungsempfaenger/page.tsx`:

```ts
// This route has moved to /dashboard/abrechnung/rechnungsempfaenger.
// Permanent redirect preserves any bookmarks or external links.
import { permanentRedirect } from 'next/navigation';
export default function Page() {
  permanentRedirect('/dashboard/abrechnung/rechnungsempfaenger');
}
```

No DB changes. The component (`RechnungsempfaengerPage`) is unchanged.

---

## Task 6 — Unified Vorlagen editor

### Philosophy

A "Vorlage" is the complete specification for how an invoice PDF looks and reads.
Previously split across two separate admin pages:
- `pdf_vorlagen` → column layout, grouping mode
- `invoice_text_blocks` → intro/outro text, assigned via payers

After this task, a single Vorlage record owns both concerns. The editor is one
page, one mental model.

### New route
`src/app/dashboard/abrechnung/vorlagen/page.tsx`

### Component structure

```
src/features/invoices/components/vorlagen/
  vorlagen-page.tsx                ← two-column PanelList layout (reuses existing pattern)
  vorlagen-panel.tsx               ← left list (replaces PdfVorlagenPanel)
  vorlage-unified-editor.tsx       ← right editor panel (extends VorlageEditorPanel)
  vorlage-text-section.tsx         ← new section: intro/outro pickers + preview
```

### `vorlage-unified-editor.tsx`

Extends the existing `VorlageEditorPanel` with a new collapsible section
**"Brieftext"** below the column layout section:

```tsx
/**
 * VorlageUnifiedEditor
 *
 * Full editor for a single pdf_vorlagen row. Combines:
 *   1. Layout section — column picker, drag-reorder, main_layout radio
 *      (existing VorlageEditorPanel logic, lifted here)
 *   2. Brieftext section (NEW) — intro_block_id + outro_block_id selects
 *      pointing to invoice_text_blocks. Shows a text preview of the selected
 *      block inline so the user does not have to navigate away.
 *   3. Live PDF preview — same usePDF preview as Step 4 of the invoice builder.
 *
 * Save writes both layout fields and text block FKs to pdf_vorlagen in one
 * updatePdfVorlage call (Task 1 added the FK columns).
 *
 * Text block management (create/edit/delete blocks) remains on the
 * dedicated text-blocks admin page, reachable via a "Texte verwalten →"
 * link in the Brieftext section. We do NOT inline the full CRUD here —
 * the Vorlage editor is for assignment, not authoring.
 */
```

### `vorlage-text-section.tsx`

```tsx
/**
 * VorlageTextSection
 *
 * Renders two selects (Einleitung, Schlussformel) for assigning invoice_text_blocks
 * to this Vorlage. Each select shows block name + a collapsed preview of the
 * content on hover/expand.
 *
 * Props:
 *   introBlockId: string | null    — current value from pdf_vorlagen.intro_block_id
 *   outroBlockId: string | null    — current value from pdf_vorlagen.outro_block_id
 *   textBlocks: GroupedTextBlocks  — all company text blocks, loaded once
 *   onChange: (field, id) => void  — controlled update callback
 *
 * "Keine (Kostenträger-Standard)" option is always present in both selects —
 * selecting it sets the FK to null, which means the payer fallback chain applies.
 * This preserves backwards compatibility: existing payer assignments still work.
 *
 * "Texte verwalten →" link opens /dashboard/settings/invoice-templates in a
 * new tab so the user can author blocks without losing editor state.
 */
```

### Text-block resolution update

In `InvoicePdfDocument` (or wherever intro/outro text is currently resolved),
update the resolution order:

```ts
/**
 * Text block resolution order (updated in Phase 10 — unified Vorlagen):
 *
 *  1. pdf_vorlagen.intro_block_id / outro_block_id (Vorlage-level, highest priority)
 *     — the resolved Vorlage for this invoice may specify text blocks directly.
 *  2. payers.default_intro_block_id / default_outro_block_id (payer-level)
 *     — used when the Vorlage has no text-block assignment (null FK).
 *  3. invoice_text_blocks WHERE is_default = true (company default)
 *  4. Hardcoded fallback strings in InvoicePdfCoverBody (lowest priority)
 *
 * This chain means: setting a text block on a Vorlage overrides the payer
 * assignment for all invoices resolved to that Vorlage, which is exactly
 * the expected behavior (e.g. "Reha Kompakt" Vorlage uses formal text,
 * regardless of payer defaults).
 */
```

---

## Task 7 — Old settings routes: redirects

Add `permanentRedirect` shells:

| Old route | Redirects to |
|---|---|
| `/dashboard/settings/invoice-templates` | `/dashboard/abrechnung/vorlagen` |
| `/dashboard/settings/pdf-vorlagen` | `/dashboard/abrechnung/vorlagen` |
| `/dashboard/rechnungsempfaenger` | `/dashboard/abrechnung/rechnungsempfaenger` |

Both old routes point to the same new unified Vorlagen page. The page itself
handles both concerns now.

```ts
// src/app/dashboard/settings/invoice-templates/page.tsx
// Route moved. Full text-block authoring is now accessible via
// "Texte verwalten →" inside /dashboard/abrechnung/vorlagen.
// The standalone text-blocks admin page is kept but no longer linked in
// the main nav — power users who bookmarked it will be redirected here.
import { permanentRedirect } from 'next/navigation';
export default function Page() {
  permanentRedirect('/dashboard/abrechnung/vorlagen');
}
```

---

## Task 8 — Docs + inline comments

### `docs/navigation.md` (create new)

```markdown
# Navigation structure

## Sidebar sections

### Abrechnung (expand-and-navigate)

"Abrechnung" is the billing product section. It uses the expand-and-navigate
pattern: clicking the label navigates to /dashboard/abrechnung (the billing
overview dashboard); clicking the chevron icon toggles the submenu.

Children:
- Rechnungen → /dashboard/invoices
- Angebote → /dashboard/angebote
- Rechnungsempfänger → /dashboard/abrechnung/rechnungsempfaenger
- Vorlagen → /dashboard/abrechnung/vorlagen (unified PDF + text editor)

### Account

Manages entities: Fahrgäste, Fahrer, Kostenträger, Fremdfirmen.
Rechnungsempfänger was here until Phase 10; now under Abrechnung.

### Einstellungen

App-wide settings only: Unternehmen, Unzugeordnete Fahrten.
Rechnungsvorlagen and PDF-Vorlagen were here until Phase 10; now unified
under Abrechnung > Vorlagen.

## Expand-and-navigate pattern

Implemented in app-sidebar.tsx. Detection: item.url !== '#' && item.items?.length > 0.
The parent renders as Link + separate ChevronRight SidebarMenuAction.
The expand state is managed by the same Collapsible as collapse-only items.

## Cmd+K / kbar

kbar/index.tsx imports navItems from nav-config.ts and flattens children for
search. The Abrechnung parent item is included with its dashboard URL so users
can navigate directly via Cmd+K → "Abrechnung".
```

### `docs/invoice-text-templates.md` — update resolution chain section

Add the updated 4-level chain documented in Task 6 above.

### `docs/pdf-vorlagen.md` — update

Add a section "Unified Vorlagen editor (Phase 10)" describing:
- The new `intro_block_id` / `outro_block_id` FK columns
- The updated resolution chain
- That the old `/dashboard/settings/pdf-vorlagen` route redirects to
  `/dashboard/abrechnung/vorlagen`

### `docs/abrechnung-overview.md` (create new)

Document the Abrechnung dashboard page:
- KPI cards and their definitions (open, overdue, this month, pending Angebote)
- Overdue derivation formula (`created_at + payment_due_days`)
- Quick-pay interaction (optimistic update pattern)
- Note: KPIs are client-side derived; migration path to server-side RPC if
  invoice volume grows large

### Inline comments — mandatory locations

Add or update inline comments in every file changed by this plan:

| File | Comment required |
|---|---|
| `src/config/nav-config.ts` | Block comment at top explaining three item variants and Phase 10 restructure |
| `src/components/layout/app-sidebar.tsx` | Comment above expand-and-navigate branch explaining the three render variants |
| `src/features/invoices/components/abrechnung-overview/use-abrechnung-kpis.ts` | JSDoc on hook explaining each KPI, overdue formula, and future RPC migration note |
| `src/features/invoices/components/abrechnung-overview/abrechnung-recent-invoices.tsx` | JSDoc explaining quick-pay optimistic update pattern |
| `src/features/invoices/components/vorlagen/vorlage-unified-editor.tsx` | JSDoc explaining unified concept and what each section owns |
| `src/features/invoices/components/vorlagen/vorlage-text-section.tsx` | JSDoc on props, "Keine" option semantics, backwards compatibility |
| `src/features/invoices/types/pdf-vorlage.types.ts` | Inline comments on new FK fields |
| Resolution function in `InvoicePdfDocument` | Updated resolution chain comment (4 levels) |
| `supabase/migrations/20260412120000_pdf_vorlagen_text_blocks.sql` | COMMENT ON COLUMN for both new fields |

---

## Verification

After all tasks:

1. `bun run build` — must succeed, 0 errors
2. `bun run test` — all existing tests pass
3. Manual smoke:
   - Click "Abrechnung" label → navigates to `/dashboard/abrechnung`
   - Click "Abrechnung" chevron → expands submenu without navigating
   - `/dashboard/rechnungsempfaenger` → redirects to new path
   - `/dashboard/settings/invoice-templates` → redirects to Vorlagen
   - `/dashboard/settings/pdf-vorlagen` → redirects to Vorlagen
   - Vorlage editor: save intro_block_id → reflected in generated PDF
   - Quick-pay button: click → optimistic badge flip → confirmed on reload
   - Cmd+K → type "Abrechnung" → navigates to overview

