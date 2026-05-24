'use client';

import { cn } from '@/lib/utils';
import { IconPlus } from '@tabler/icons-react';
import { formatTimeRange } from '../lib/plan-hours';
import { PLAN_STATUSES, type DriverDayPlan, type PlanStatus } from '../types';
import { STATUS_VARIANT } from './plan-status-badge';

type RosterPlanCellProps = {
  plan: DriverDayPlan | null;
  planDate: string;
  driverId: string;
  isToday: boolean;
  onClick: () => void;
};

export function RosterPlanCell({
  plan,
  planDate: _planDate,
  driverId: _driverId,
  isToday,
  onClick
}: RosterPlanCellProps) {
  const timeRange = plan ? formatTimeRange(plan) : null;
  const statusConfig = plan ? STATUS_VARIANT[plan.status as PlanStatus] : null;

  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        'flex min-h-[3.25rem] w-full cursor-pointer flex-col items-start justify-center rounded-sm border border-transparent px-1.5 py-1 text-left transition-colors hover:opacity-90',
        isToday && 'border-t-primary border-t-2',
        plan
          ? cn('border-border', statusConfig?.className)
          : 'bg-muted/40 hover:bg-muted/60'
      )}
    >
      {plan ? (
        <>
          <span className='line-clamp-1 text-[11px] leading-tight font-medium'>
            {PLAN_STATUSES[plan.status as PlanStatus]}
          </span>
          {timeRange && (
            <span className='text-muted-foreground font-mono text-[10px] tabular-nums'>
              {timeRange}
            </span>
          )}
        </>
      ) : (
        <span className='text-muted-foreground flex w-full items-center justify-center'>
          <IconPlus className='h-3.5 w-3.5' aria-hidden />
          <span className='sr-only'>Planung hinzufügen</span>
        </span>
      )}
    </button>
  );
}
