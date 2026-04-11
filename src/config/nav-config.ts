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

import { NavItem } from '@/types';

export const navItems: NavItem[] = [
  {
    title: 'Dashboard',
    url: '/dashboard/overview',
    icon: 'dashboard',
    isActive: false,
    shortcut: ['d', 'd'],
    items: []
  },
  {
    title: 'Fahrten',
    url: '/dashboard/trips',
    icon: 'trips',
    shortcut: ['t', 't'],
    isActive: false,
    items: []
  },
  {
    title: 'Abrechnung',
    url: '/dashboard/abrechnung',
    icon: 'billing',
    shortcut: ['a', 'a'],
    isActive: false,
    items: [
      {
        title: 'Rechnungen',
        url: '/dashboard/invoices',
        shortcut: ['r', 'r']
      },
      {
        title: 'Angebote',
        url: '/dashboard/angebote',
        shortcut: ['g', 'g']
      },
      {
        title: 'Rechnungsempfänger',
        url: '/dashboard/abrechnung/rechnungsempfaenger',
        shortcut: ['r', 'e']
      },
      {
        title: 'Preisregeln',
        url: '/dashboard/abrechnung/preise',
        shortcut: ['p', 'r']
      },
      {
        title: 'Vorlagen',
        url: '/dashboard/abrechnung/vorlagen',
        shortcut: ['v', 'v']
      }
    ]
  },
  {
    title: 'Account',
    url: '#',
    icon: 'account',
    isActive: true,
    items: [
      {
        title: 'Fahrgäste',
        url: '/dashboard/clients',
        icon: 'teams',
        shortcut: ['f', 'f']
      },
      {
        title: 'Fahrer',
        url: '/dashboard/drivers',
        icon: 'user',
        shortcut: ['f', 'a']
      },
      {
        title: 'Kostenträger',
        url: '/dashboard/payers',
        icon: 'billing',
        shortcut: ['k', 'k']
      },
      {
        title: 'Fremdfirmen',
        url: '/dashboard/fremdfirmen',
        icon: 'fremdfirma',
        shortcut: ['f', 'r']
      }
    ]
  },
  {
    title: 'Einstellungen',
    url: '#',
    icon: 'settings',
    isActive: false,
    items: [
      {
        title: 'Unternehmen',
        url: '/dashboard/settings/company',
        icon: 'billing',
        shortcut: ['e', 'u']
      },
      {
        title: 'Unzugeordnete Fahrten',
        url: '/dashboard/settings/unzugeordnete-fahrten',
        icon: 'warning',
        shortcut: ['u', 'f']
      }
    ]
  },
  {
    title: 'Dokumentation',
    url: '/dashboard/documentation',
    icon: 'help',
    shortcut: ['h', 'h'],
    isActive: false,
    items: []
  }
];
