/**
 * Pure formatters for Alle Regelfahrten — guest label and RRULE weekday abbreviations.
 * Lives in a non-client module so the RSC page can safely import these functions
 * without crossing the `'use client'` boundary (that boundary replaces exports with
 * stubs and throws when server code calls them).
 */

import type { RecurringRuleWithClientEmbed } from '@/features/trips/api/recurring-rules.server';

const DAY_MAP: Record<string, string> = {
  MO: 'Mo',
  TU: 'Di',
  WE: 'Mi',
  TH: 'Do',
  FR: 'Fr',
  SA: 'Sa',
  SU: 'So'
};

// why: extracted from recurring-rules-columns.tsx so the RSC page can call this
// without crossing the Next.js server/client module boundary.
export function formatRecurringRuleGuestLabel(
  row: RecurringRuleWithClientEmbed
): string {
  const c = row.clients;
  const last = c?.last_name?.trim() ?? '';
  const first = c?.first_name?.trim() ?? '';
  if (!last && !first) return '—';
  return `${last}, ${first}`;
}

// why: extracted from recurring-rules-columns.tsx so the RSC page can call this
// without crossing the Next.js server/client module boundary.
export function formatRecurringRuleByDayAbbrev(rruleString: string): string {
  const match = rruleString.match(/BYDAY=([^;]+)/);
  if (!match) return '';
  const days = match[1].split(',');
  return days.map((d) => DAY_MAP[d] ?? d).join(', ');
}
