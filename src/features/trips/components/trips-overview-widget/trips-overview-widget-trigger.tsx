'use client';

import { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { todayYmdInBusinessTz } from '@/features/trips/lib/trip-business-date';
import { cn } from '@/lib/utils';
import { TripsOverviewWidgetDialog } from './trips-overview-widget-dialog';

/**
 * Header icon trigger — self-contained open state.
 * Mount in `header.tsx` before `PendingAssignmentsPopover`; no RSC coupling.
 */
export function TripsOverviewWidgetTrigger() {
  const [open, setOpen] = useState(false);
  const [dateYmd, setDateYmd] = useState(() => todayYmdInBusinessTz());

  return (
    <>
      <Button
        type='button'
        variant='outline'
        size='icon'
        className={cn('h-9 w-9 transition-colors', open && 'bg-accent')}
        aria-label='Fahrtenübersicht'
        onClick={() => setOpen(true)}
      >
        <CalendarClock className='text-muted-foreground h-4 w-4' />
      </Button>

      <TripsOverviewWidgetDialog
        open={open}
        onOpenChange={setOpen}
        dateYmd={dateYmd}
        onDateChange={setDateYmd}
      />
    </>
  );
}
