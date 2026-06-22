/**
 * Central badge styling and label map for kts_status enum values.
 * Mirrors trip-status.ts pattern — change both if the cva API changes.
 */
import { cva } from 'class-variance-authority';

import type { KtsStatus } from '@/features/kts/kts.service';

export const ktsStatusBadge = cva(
  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      status: {
        ungeprueft: 'bg-muted text-muted-foreground border-border',
        korrekt:
          'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800',
        fehlerhaft:
          'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800',
        in_korrektur:
          'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
        uebergeben:
          'bg-muted/50 text-muted-foreground border-border opacity-70',
        abgerechnet:
          'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
        ruecklaufer:
          'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800',
        bezahlt:
          'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800'
      }
    },
    defaultVariants: { status: 'ungeprueft' }
  }
);

export const KTS_STATUS_LABELS: Record<KtsStatus, string> = {
  ungeprueft: 'Ungeprüft',
  korrekt: 'Korrekt',
  fehlerhaft: 'Fehlerhaft',
  in_korrektur: 'In Korrektur',
  uebergeben: 'Übergeben',
  abgerechnet: 'Abgerechnet',
  ruecklaufer: 'Rückläufer',
  bezahlt: 'Bezahlt'
};

/** Filter dot colors — abgerechnet uses blue (green reserved for bezahlt in PR4.2). */
export const KTS_STATUS_DOT: Record<KtsStatus, string> = {
  ungeprueft: 'bg-muted-foreground',
  korrekt: 'bg-green-500',
  fehlerhaft: 'bg-red-500',
  in_korrektur: 'bg-amber-500',
  uebergeben: 'bg-muted-foreground/50',
  abgerechnet: 'bg-blue-500',
  ruecklaufer: 'bg-orange-500',
  bezahlt: 'bg-green-500'
};

/** All kts_status values for filter UI. */
export const KTS_STATUS_VALUES: KtsStatus[] = [
  'ungeprueft',
  'korrekt',
  'fehlerhaft',
  'in_korrektur',
  'uebergeben',
  'abgerechnet',
  'ruecklaufer',
  'bezahlt'
];

/** Abrechnung tab group_status filter values (subset of kts_status). */
export const ABRECHNUNG_GROUP_STATUS_VALUES = [
  'abgerechnet',
  'ruecklaufer',
  'bezahlt'
] as const satisfies readonly KtsStatus[];

export type AbrechnungGroupStatus =
  (typeof ABRECHNUNG_GROUP_STATUS_VALUES)[number];

export const KTS_STATUS_ABGERECHNET = 'abgerechnet' as const;
export const KTS_STATUS_RUECKLAUFER = 'ruecklaufer' as const;
export const KTS_STATUS_BEZAHLT = 'bezahlt' as const;
