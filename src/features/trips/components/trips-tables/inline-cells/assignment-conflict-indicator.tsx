'use client';

/**
 * AssignmentConflictIndicator — purely presentational overlap badge.
 *
 * Renders a small amber AlertTriangle when a trip has both KTS and Reha-Schein
 * active simultaneously. This combination is unusual and warrants admin review.
 *
 * WHY it returns null rather than rendering an invisible placeholder:
 *   The component is absolutely positioned inside a `relative` wrapper, so it
 *   contributes zero to layout flow in both states. Returning null avoids adding
 *   an empty DOM node on the ~99 % of rows that have no overlap.
 *
 * WHY amber rather than destructive (red):
 *   This is an informational signal, not an error. Destructive color would imply
 *   the trip is broken or invalid; amber matches the "attention needed" pattern
 *   already established by the urgency indicator for upcoming/imminent trips.
 *
 * Placement: absolutely positioned in the top-right corner of the `relative`
 * wrapper div in the KTS column cell definition. The indicator sits as an
 * overlay and never participates in block layout, so the KTS switch occupies
 * the identical position on overlap rows and non-overlap rows.
 */

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { hasKtsRehaOverlap } from '@/features/trips/lib/trip-assignment-flags';
import type { TripRow } from '@/features/trips/types/trip-row';

const OVERLAP_LABEL = 'KTS und Reha-Schein gleichzeitig aktiv';

export function AssignmentConflictIndicator({ trip }: { trip: TripRow }) {
  if (!hasKtsRehaOverlap(trip)) {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* absolute positions the icon in the top-right corner of the
              `relative` wrapper without affecting the KTS switch position */}
          <span
            className='absolute -top-1 -right-1 flex cursor-default items-center justify-center'
            aria-label={OVERLAP_LABEL}
          >
            <AlertTriangle
              className='size-3 text-amber-500 dark:text-amber-400'
              aria-hidden
            />
            <span className='sr-only'>{OVERLAP_LABEL}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top' className='text-xs'>
          {OVERLAP_LABEL}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
