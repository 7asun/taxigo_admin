'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { AlertTriangle, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatRecurringRuleGuestLabel } from '@/features/recurring-rules/components/recurring-rules-columns';
import type { RecurringRuleWithClientEmbed } from '@/features/trips/api/recurring-rules.server';
import type {
  ExpiringRecurringRule,
  ExpiringRulesBannerProps
} from '@/features/dashboard/hooks/use-expiring-recurring-rules';

const AMBER_ALERT_CLASS =
  'border-amber-300 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/30';
const AMBER_TEXT_CLASS = 'text-amber-900/90 dark:text-amber-100/90';
const BLUE_ALERT_CLASS =
  'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30';
const BLUE_TEXT_CLASS = 'text-blue-900 dark:text-blue-100';

function formatEndDateYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map((part) => Number.parseInt(part, 10));
  if (!y || !m || !d) return ymd;
  return format(new Date(y, m - 1, d), 'dd.MM.yyyy', { locale: de });
}

function guestDisplayName(rule: ExpiringRecurringRule): string {
  const label = formatRecurringRuleGuestLabel(
    rule as unknown as RecurringRuleWithClientEmbed
  );
  return label === '—' ? 'Unbekannt' : label;
}

function buildBucketMessage(
  bucketRules: ExpiringRecurringRule[],
  relativeLabel: string,
  endYmd: string
): string {
  const n = bucketRules.length;
  const dateFmt = formatEndDateYmd(endYmd);

  if (n === 1) {
    const name = guestDisplayName(bucketRules[0]!);
    return `Regelfahrt von ${name} endet ${relativeLabel} (${dateFmt}). Bitte Regel prüfen.`;
  }
  if (n <= 3) {
    const names = bucketRules.map((r) => guestDisplayName(r)).join(', ');
    return `${n} Regelfahrten enden ${relativeLabel}: ${names}. Bitte Regeln prüfen.`;
  }
  return `${n} Regelfahrten enden ${relativeLabel}. Bitte Regeln prüfen.`;
}

type BucketConfig = {
  endYmd: string;
  relativeLabel: string;
  alertClass: string;
  textClass: string;
  icon: ReactNode;
};

function ExpiringBucketAlert({
  bucketRules,
  config
}: {
  bucketRules: ExpiringRecurringRule[];
  config: BucketConfig;
}) {
  if (bucketRules.length === 0) return null;

  return (
    <Alert variant='default' className={config.alertClass}>
      {config.icon}
      <AlertDescription className={config.textClass}>
        <span>
          {buildBucketMessage(bucketRules, config.relativeLabel, config.endYmd)}{' '}
          <Link
            href='/dashboard/regelfahrten'
            className='font-medium underline underline-offset-4'
          >
            Regelfahrten öffnen →
          </Link>
        </span>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Dashboard expiry countdown for recurring rules (presentational).
 * WHY no hook here: layout owns data fetching; keeps copy/bucket logic testable.
 * WHY null when empty: avoids an empty card above the timeless widget.
 * WHY window YMDs are props: Berlin date math lives only in useExpiringRecurringRules.
 */
export function ExpiringRulesBanner({
  rules,
  day1Ymd,
  day2Ymd,
  day3Ymd
}: ExpiringRulesBannerProps) {
  if (rules.length === 0) return null;

  const bucket1 = rules.filter((r) => r.end_date === day1Ymd);
  const bucket2 = rules.filter((r) => r.end_date === day2Ymd);
  const bucket3 = rules.filter((r) => r.end_date === day3Ymd);

  const buckets: { rules: ExpiringRecurringRule[]; config: BucketConfig }[] = [
    {
      rules: bucket1,
      config: {
        endYmd: day1Ymd,
        relativeLabel: 'morgen',
        alertClass: AMBER_ALERT_CLASS,
        textClass: AMBER_TEXT_CLASS,
        icon: <AlertTriangle className='text-amber-600 dark:text-amber-400' />
      }
    },
    {
      rules: bucket2,
      config: {
        endYmd: day2Ymd,
        relativeLabel: 'in 2 Tagen',
        alertClass: AMBER_ALERT_CLASS,
        textClass: AMBER_TEXT_CLASS,
        icon: <AlertTriangle className='text-amber-600 dark:text-amber-400' />
      }
    },
    {
      rules: bucket3,
      config: {
        endYmd: day3Ymd,
        relativeLabel: 'in 3 Tagen',
        alertClass: BLUE_ALERT_CLASS,
        textClass: BLUE_TEXT_CLASS,
        icon: <Info className='text-blue-600 dark:text-blue-400' />
      }
    }
  ];

  return (
    <div className='flex flex-col gap-2'>
      {buckets.map(({ rules: bucketRules, config }) => (
        <ExpiringBucketAlert
          key={config.endYmd}
          bucketRules={bucketRules}
          config={config}
        />
      ))}
    </div>
  );
}
