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
Example: Abrechnung → `/dashboard/abrechnung`.

## Abrechnung section (Phase 10)

All billing-related features are consolidated here:

- `/dashboard/abrechnung` — Billing overview dashboard (KPIs + recent invoices)
- `/dashboard/invoices` — Full invoice list
- `/dashboard/angebote` — Quotes list
- `/dashboard/abrechnung/rechnungsempfaenger` — Invoice recipient catalog
- `/dashboard/abrechnung/vorlagen` — Unified Vorlagen editor (PDF layout + letter text)

## Removed from nav

- Rechnungsempfänger was under Account — moved to Abrechnung (Phase 10)
- Rechnungsvorlagen was under Einstellungen — unified into Abrechnung > Vorlagen (Phase 10)
- PDF-Vorlagen was under Einstellungen — unified into Abrechnung > Vorlagen (Phase 10)

## Old routes

All old routes issue `permanentRedirect` to the new paths. No bookmarks break.

## Cmd+K (kbar)

`src/components/kbar/index.tsx` imports `navItems` and flattens children
automatically. The Abrechnung parent item (`url !== '#'`) is included as a
navigable action. No structural changes needed to kbar.
