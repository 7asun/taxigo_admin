import type { UrgencyLevel } from '@/features/trips/lib/urgency-logic';

/**
 * Tailwind classes for the **entire** Kanban time chip (no urgency dot).
 * Must stay aligned with dot/badge semantics in `urgency-indicator.tsx`.
 */
export const KANBAN_TIME_CHIP_CLASS: Record<UrgencyLevel, string> = {
  none: 'bg-muted/70 hover:bg-muted/40',
  upcoming:
    'border border-blue-500/40 bg-blue-500/20 hover:bg-blue-500/30 dark:border-blue-600/50 dark:bg-blue-950/50 dark:hover:bg-blue-950/60',
  imminent:
    'border border-amber-500/45 bg-amber-500/20 hover:bg-amber-500/30 dark:border-amber-600/50 dark:bg-amber-950/40 dark:hover:bg-amber-950/55',
  due: 'border border-red-500/50 bg-red-500/20 hover:bg-red-500/30 dark:border-red-600/55 dark:bg-red-950/45 dark:hover:bg-red-950/55',
  overdue:
    'border border-red-600/60 bg-red-600/30 hover:bg-red-600/40 dark:border-red-500/70 dark:bg-red-950/55 dark:hover:bg-red-950/65 animate-pulse'
};

export const URGENCY_STYLES = {
  none: {
    label: '',
    color: 'transparent',
    bg: 'bg-transparent',
    dot: 'hidden',
    rowClass: ''
  },
  upcoming: {
    label: 'Upcoming',
    color: 'text-blue-500',
    bg: 'bg-blue-500',
    description: 'Preparing / Queueing',
    rowClass: 'border-l-4 border-l-blue-500 bg-blue-50/10 dark:bg-blue-950/5'
  },
  imminent: {
    label: 'Imminent',
    color: 'text-amber-500',
    bg: 'bg-amber-500',
    description: 'Critical / Dispatch needed',
    rowClass: 'border-l-4 border-l-amber-500 bg-amber-50/10 dark:bg-amber-950/5'
  },
  due: {
    label: 'Due',
    color: 'text-red-500',
    bg: 'bg-red-500',
    description: 'Should start now',
    rowClass:
      'border-l-4 border-l-red-500 bg-red-50/20 dark:bg-red-950/10 font-medium'
  },
  overdue: {
    label: 'Overdue',
    color: 'text-red-600',
    bg: 'bg-red-600',
    description: 'Immediate attention',
    rowClass:
      'border-l-4 border-l-red-600 bg-red-50/30 dark:bg-red-950/15 font-bold animate-pulse'
  }
} as const;

export type UrgencyLevelKey = keyof typeof URGENCY_STYLES;
