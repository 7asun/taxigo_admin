'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { PLAN_STATUSES, type PlanStatus } from '../types';

export const STATUS_VARIANT: Record<
  PlanStatus,
  {
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
    className?: string;
  }
> = {
  working: { variant: 'default' },
  day_off: { variant: 'secondary' },
  vacation: {
    variant: 'outline',
    className: 'border-primary/40 bg-primary/5 text-primary dark:bg-primary/10'
  },
  sick: { variant: 'destructive' },
  half_day_vacation: { variant: 'outline' },
  overtime: {
    variant: 'outline',
    className:
      'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100'
  },
  training: {
    variant: 'outline',
    className:
      'border-blue-500/40 bg-blue-500/10 text-blue-900 dark:text-blue-100'
  },
  special_leave: {
    variant: 'outline',
    className:
      'border-violet-500/40 bg-violet-500/10 text-violet-900 dark:text-violet-100'
  }
};

type PlanStatusBadgeProps = {
  status: PlanStatus;
  className?: string;
};

export function PlanStatusBadge({ status, className }: PlanStatusBadgeProps) {
  const config = STATUS_VARIANT[status];
  return (
    <Badge variant={config.variant} className={cn(config.className, className)}>
      {PLAN_STATUSES[status]}
    </Badge>
  );
}
