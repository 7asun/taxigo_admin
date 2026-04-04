import { NavItem } from '@/types';

/**
 * Navigation configuration
 * Used by sidebar and Cmd+K bar.
 *
 * HOW TO ADD A NEW NAV ITEM:
 *   - Top-level page: add a new object to this array (no `items`)
 *   - Sub-page in a group: add to the parent's `items` array
 *   - New group: add a new object with an `items` array
 */
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
    // Abrechnung — dedicated section, independent from Account group
    title: 'Abrechnung',
    url: '/dashboard/invoices',
    icon: 'billing',
    shortcut: ['a', 'a'],
    isActive: false,
    items: []
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
    // Einstellungen group — standalone from Abrechnung, extensible via items[]
    // To add a new settings sub-page: add an entry to items[] below.
    title: 'Einstellungen',
    url: '#',
    icon: 'settings',
    isActive: false,
    items: [
      {
        // Company profile: legal name, tax IDs, bank details, logo
        // Data entered here is referenced by all invoices automatically.
        title: 'Unternehmen',
        url: '/dashboard/settings/company',
        icon: 'billing',
        shortcut: ['e', 'u']
      },
      {
        // Invoice text templates: intro/outro blocks (Baukasten system)
        title: 'Rechnungsvorlagen',
        url: '/dashboard/settings/invoice-templates',
        icon: 'post',
        shortcut: ['r', 'v']
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
