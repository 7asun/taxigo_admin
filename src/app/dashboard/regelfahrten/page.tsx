/**
 * Alle Regelfahrten — RSC entry: loads all rules via server Supabase, then applies
 * guest filter, sort, and pagination slice from URL search params so the client
 * `useDataTable` (manual*) contract matches trips. No `loading.tsx` yet — empty
 * or slow states follow the same pattern as other dashboard list pages until
 * we add a dedicated skeleton.
 */

import PageContainer from '@/components/layout/page-container';
import {
  getAllRules,
  type RecurringRuleWithClientEmbed
} from '@/features/trips/api/recurring-rules.server';
import { RecurringRulesOverview } from '@/features/recurring-rules/components/recurring-rules-overview';
import {
  RECURRING_RULES_TABLE_DEFAULT_PAGE_SIZE,
  RECURRING_RULES_SORT_COLUMN_IDS
} from '@/features/recurring-rules/lib/recurring-rules-sort-column-ids';
import {
  formatRecurringRuleGuestLabel,
  formatRecurringRuleByDayAbbrev
} from '@/features/recurring-rules/components/recurring-rules-columns';
import { getSortingStateParser } from '@/lib/parsers';
import { formatBillingDisplayLabel } from '@/features/trips/lib/format-billing-display-label';
import { recurringReturnModeFromRow } from '@/features/trips/lib/recurring-return-mode';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard: Alle Regelfahrten'
};

export const dynamic = 'force-dynamic';

function firstString(value: string | string[] | undefined): string | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value[0];
  return value;
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  max: number
): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function filterByGuest(
  rows: RecurringRuleWithClientEmbed[],
  guest: string
): RecurringRuleWithClientEmbed[] {
  const q = guest.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    const label = formatRecurringRuleGuestLabel(r).toLowerCase();
    const hay = `${label} ${r.client_id}`.toLowerCase();
    return hay.includes(q);
  });
}

function compareColumn(
  a: RecurringRuleWithClientEmbed,
  b: RecurringRuleWithClientEmbed,
  columnId: string
): number {
  switch (columnId) {
    case 'client_name':
      return formatRecurringRuleGuestLabel(a).localeCompare(
        formatRecurringRuleGuestLabel(b),
        'de'
      );
    case 'days':
      return formatRecurringRuleByDayAbbrev(a.rrule_string).localeCompare(
        formatRecurringRuleByDayAbbrev(b.rrule_string),
        'de'
      );
    case 'pickup_time':
      // `pickup_time` can be null for daily-agreement rules; treat null as empty so
      // sorting stays stable without excluding timeless rules from the overview.
      return (a.pickup_time ?? '').localeCompare(b.pickup_time ?? '');
    case 'pickup_address':
      return a.pickup_address.localeCompare(b.pickup_address, 'de');
    case 'dropoff_address':
      return a.dropoff_address.localeCompare(b.dropoff_address, 'de');
    case 'return_mode': {
      const ra = recurringReturnModeFromRow(a);
      const rb = recurringReturnModeFromRow(b);
      const order = (m: string) =>
        m === 'none' ? 0 : m === 'time_tbd' ? 1 : 2;
      const oa = order(ra);
      const ob = order(rb);
      if (oa !== ob) return oa - ob;
      return (a.return_time ?? '').localeCompare(b.return_time ?? '');
    }
    case 'billing': {
      const la =
        formatBillingDisplayLabel(a.billing_variant).trim() ||
        a.payer?.name?.trim() ||
        '';
      const lb =
        formatBillingDisplayLabel(b.billing_variant).trim() ||
        b.payer?.name?.trim() ||
        '';
      return la.localeCompare(lb, 'de');
    }
    case 'is_active':
      return Number(a.is_active) - Number(b.is_active);
    case 'start_date':
      return a.start_date.localeCompare(b.start_date);
    default:
      return 0;
  }
}

function sortRows(
  rows: RecurringRuleWithClientEmbed[],
  sorting: { id: string; desc: boolean }[]
): RecurringRuleWithClientEmbed[] {
  if (sorting.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const s of sorting) {
      const raw = compareColumn(a, b, s.id);
      if (raw !== 0) return s.desc ? -raw : raw;
    }
    return 0;
  });
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const sp = await searchParams;
  const guest = firstString(sp.client_name) ?? '';
  const sortRaw = firstString(sp.sort);
  const sorting =
    getSortingStateParser(RECURRING_RULES_SORT_COLUMN_IDS).parseServerSide(
      sortRaw
    ) ?? [];

  const page = parsePositiveInt(firstString(sp.page), 1, 10_000);
  const perPage = parsePositiveInt(
    firstString(sp.perPage),
    RECURRING_RULES_TABLE_DEFAULT_PAGE_SIZE,
    500
  );

  const all = await getAllRules();
  const filtered = filterByGuest(all, guest);
  const sorted = sortRows(filtered, sorting);
  const totalDatasetCount = sorted.length;
  const lastPage = Math.max(1, Math.ceil(totalDatasetCount / perPage));
  const safePage = Math.min(page, lastPage); // clamp page to last valid page so slice never overshoots a small dataset
  const from = (safePage - 1) * perPage;
  const pageRows = sorted.slice(from, from + perPage);

  return (
    <PageContainer
      scrollable={false}
      pageTitle='Alle Regelfahrten'
      pageDescription='Wiederkehrende Fahrten aller Fahrgäste im Überblick.'
    >
      <div className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
        <RecurringRulesOverview
          rules={pageRows}
          totalDatasetCount={totalDatasetCount}
          perPage={perPage}
          currentPage={safePage}
        />
      </div>
    </PageContainer>
  );
}
