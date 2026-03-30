'use client';

import { Users } from 'lucide-react';

interface GroupedTripHintProps {
  /** Number of trips sharing `group_id` (including the open row). */
  groupMemberCount: number;
  stopOrder: number | null;
}

/**
 * Shown in the same top callout stack as linked Hin/Rück — informs dispatch that edits
 * apply only to this row.
 */
export function GroupedTripHint({
  groupMemberCount,
  stopOrder
}: GroupedTripHintProps) {
  return (
    <section aria-label='Gruppenfahrt'>
      <p className='text-muted-foreground mb-1.5 text-[10px] font-bold tracking-widest uppercase'>
        Gruppenfahrt
      </p>
      <div className='bg-muted/40 border-border flex min-h-9 items-start gap-2 rounded-lg border px-2 py-1.5'>
        <Users className='text-muted-foreground mt-0.5 h-4 w-4 shrink-0' />
        <p className='text-foreground text-xs leading-snug'>
          <span className='font-semibold'>
            Diese Fahrt gehört zu einer Gruppe
          </span>{' '}
          ({groupMemberCount} {groupMemberCount === 1 ? 'Fahrt' : 'Fahrten'} in
          dieser Gruppe). Änderungen gelten nur für{' '}
          <span className='font-medium'>diese eine Fahrt</span>; andere Beine
          bleiben unverändert.
          {stopOrder != null && (
            <span className='text-muted-foreground'>
              {' '}
              Position: {stopOrder}.
            </span>
          )}
        </p>
      </div>
    </section>
  );
}
