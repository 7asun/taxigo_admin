/**
 * buildBreadcrumbsFromNav
 *
 * Traverses the navItems tree to find the path from root to the current page.
 * Uses nav-config as source of truth, not raw URL segments, so logical parents
 * (e.g. Abrechnung) appear even when the URL does not nest under /abrechnung/.
 *
 * Returns { title, link }[] with "Dashboard" first (hub at /dashboard/overview),
 * except on the overview page where the trail is a single Dashboard crumb.
 */

import type { NavItem } from '@/types';

export interface BreadcrumbItemData {
  title: string;
  link: string;
}

const DASHBOARD_HUB: BreadcrumbItemData = {
  title: 'Dashboard',
  link: '/dashboard/overview'
};

function normalizePath(path: string): string {
  return path.toLowerCase().replace(/\/+$/, '') || '/';
}

/** Depth-first: match children before parent so deeper routes win. */
function dfsNavMatch(
  items: NavItem[],
  pathnameNorm: string,
  ancestors: NavItem[]
): NavItem[] | null {
  for (const item of items) {
    if (item.items?.length) {
      const nested = dfsNavMatch(item.items, pathnameNorm, [
        ...ancestors,
        item
      ]);
      if (nested) return nested;
    }
    if (
      item.url &&
      item.url !== '#' &&
      normalizePath(item.url) === pathnameNorm
    ) {
      return [...ancestors, item];
    }
  }
  return null;
}

function collectNavEntries(
  items: NavItem[],
  ancestors: NavItem[]
): { urlNorm: string; urlRaw: string; trail: NavItem[] }[] {
  const rows: { urlNorm: string; urlRaw: string; trail: NavItem[] }[] = [];
  for (const item of items) {
    const trail = [...ancestors, item];
    if (item.url && item.url !== '#') {
      rows.push({
        urlNorm: normalizePath(item.url),
        urlRaw: item.url,
        trail
      });
    }
    if (item.items?.length) {
      rows.push(...collectNavEntries(item.items, trail));
    }
  }
  return rows;
}

const TAIL_SEGMENT_LABELS: Record<string, string> = {
  new: 'Neu',
  edit: 'Bearbeiten',
  preview: 'Vorschau'
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function trailToCrumbs(trail: NavItem[]): BreadcrumbItemData[] {
  return trail
    .filter((n) => n.url && n.url !== '#')
    .map((n) => ({ title: n.title, link: n.url }));
}

export function buildBreadcrumbsFromNav(
  pathname: string,
  navItems: NavItem[],
  customTitles: Record<string, string> = {}
): BreadcrumbItemData[] {
  const norm = normalizePath(pathname);

  const trail = dfsNavMatch(navItems, norm, []);

  if (trail) {
    const crumbs = trailToCrumbs(trail);

    if (
      crumbs.length === 1 &&
      normalizePath(crumbs[0]!.link) === normalizePath(DASHBOARD_HUB.link)
    ) {
      return [{ title: 'Dashboard', link: '/dashboard/overview' }];
    }

    const withoutDupHub = crumbs.filter(
      (c) => normalizePath(c.link) !== normalizePath(DASHBOARD_HUB.link)
    );
    return [DASHBOARD_HUB, ...withoutDupHub];
  }

  const entries = collectNavEntries(navItems, []);
  const sorted = [...entries].sort(
    (a, b) => b.urlNorm.length - a.urlNorm.length
  );
  const match = sorted.find(
    (e) => norm === e.urlNorm || norm.startsWith(`${e.urlNorm}/`)
  );

  if (match && norm !== match.urlNorm) {
    const base = trailToCrumbs(match.trail).filter(
      (c) => normalizePath(c.link) !== normalizePath(DASHBOARD_HUB.link)
    );
    const tail = norm.slice(match.urlNorm.length).replace(/^\//, '');
    const segments = tail.split('/').filter(Boolean);
    const lastSeg = segments[segments.length - 1];

    const custom = customTitles[norm];
    let tailTitle = custom;
    if (!tailTitle && lastSeg) {
      if (UUID_RE.test(lastSeg)) {
        tailTitle = 'Rechnung';
      } else {
        tailTitle =
          TAIL_SEGMENT_LABELS[lastSeg.toLowerCase()] ??
          lastSeg.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
      }
    }
    if (!tailTitle) tailTitle = 'Details';

    return [DASHBOARD_HUB, ...base, { title: tailTitle, link: pathname }];
  }

  return [DASHBOARD_HUB];
}
