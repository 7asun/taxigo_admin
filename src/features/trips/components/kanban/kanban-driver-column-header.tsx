'use client';

import { Badge } from '@/components/ui/badge';
import {
  PLAN_STATUSES,
  type PlanStatus
} from '@/features/driver-planning/types';
import type { DriverDayContext } from '@/lib/driver-availability';
import { cn } from '@/lib/utils';
import { GripVertical } from 'lucide-react';
import type { DraggableAttributes } from '@dnd-kit/core';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';

type KanbanDriverColumnHeaderProps = {
  title: string;
  subtitle?: string;
  tripCount: number;
  dayContext?: DriverDayContext;
  isColumnDropTarget: boolean;
  listeners: SyntheticListenerMap | undefined;
  attributes: DraggableAttributes;
};

function availabilityBadgeLabel(dayContext: DriverDayContext): string {
  const availability = dayContext.plan?.status ?? dayContext.availability;
  if (availability === 'available') return PLAN_STATUSES.working;
  if (availability in PLAN_STATUSES) {
    return PLAN_STATUSES[availability as PlanStatus];
  }
  if (availability === 'unknown') return 'Unbekannt';
  return availability;
}

function headerTintClass(dayContext: DriverDayContext): string | undefined {
  const status = dayContext.plan?.status ?? dayContext.availability;
  if (status === 'sick') return 'bg-destructive/5';
  if (
    status === 'vacation' ||
    status === 'day_off' ||
    status === 'special_leave' ||
    status === 'half_day_vacation'
  ) {
    return 'bg-amber-500/10 dark:bg-amber-950/30';
  }
  if (status === 'training') {
    return 'bg-blue-500/10 dark:bg-blue-950/30';
  }
  return undefined;
}

function badgeVariant(
  dayContext: DriverDayContext
): 'destructive' | 'secondary' | 'outline' {
  const status = dayContext.plan?.status ?? dayContext.availability;
  if (status === 'sick') return 'destructive';
  if (status === 'training') return 'secondary';
  return 'outline';
}

export function KanbanDriverColumnHeader({
  title,
  subtitle,
  tripCount,
  dayContext,
  isColumnDropTarget,
  listeners,
  attributes
}: KanbanDriverColumnHeaderProps) {
  const showUnavailableBadge = dayContext != null && !dayContext.isDispatchable;

  return (
    <div
      className={cn(
        'bg-muted sticky top-0 z-10 flex cursor-grab items-baseline justify-between gap-2 rounded-t-lg border-b px-3 py-2 shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition-colors duration-150 active:cursor-grabbing',
        isColumnDropTarget && 'bg-primary/10',
        showUnavailableBadge && dayContext && headerTintClass(dayContext)
      )}
      {...listeners}
      {...attributes}
    >
      <div className='flex min-w-0 flex-1 items-center gap-1.5'>
        <GripVertical className='text-muted-foreground h-4 w-4 shrink-0' />
        <div className='flex min-w-0 flex-col gap-0.5'>
          <div className='flex min-w-0 items-center gap-1.5'>
            <span className='truncate text-sm font-medium'>{title}</span>
            {showUnavailableBadge && dayContext && (
              <Badge
                variant={badgeVariant(dayContext)}
                className='shrink-0 px-1.5 py-0 text-[10px]'
              >
                {availabilityBadgeLabel(dayContext)}
              </Badge>
            )}
          </div>
          {subtitle && (
            <span className='text-muted-foreground text-[11px]'>
              {subtitle}
            </span>
          )}
        </div>
      </div>
      <Badge variant='outline' className='px-2 py-0 text-[11px]'>
        {tripCount}
      </Badge>
    </div>
  );
}
