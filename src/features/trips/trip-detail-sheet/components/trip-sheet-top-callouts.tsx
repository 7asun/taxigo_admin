'use client';

import type { Trip } from '@/features/trips/api/trips.service';
import { GroupedTripHint } from './grouped-trip-hint';
import { LinkedPartnerCallout } from './linked-partner-callout';

interface TripSheetTopCalloutsProps {
  trip: Trip;
  linkedPartner: Trip | null;
  /** Trips with the same `group_id` (may be empty while loading). */
  groupTrips: Trip[];
  partnerStatusClass: string;
  partnerStatusLabel: string;
  onNavigateToTrip?: (tripId: string) => void;
}

/**
 * Single slot above “Route & Verlauf”: linked Hin/Rück (if any), then grouped-trip hint (if any).
 */
export function TripSheetTopCallouts({
  trip,
  linkedPartner,
  groupTrips,
  partnerStatusClass,
  partnerStatusLabel,
  onNavigateToTrip
}: TripSheetTopCalloutsProps) {
  const showGroupHint = !!trip.group_id;
  const groupCount =
    groupTrips.length > 0 ? groupTrips.length : trip.group_id ? 1 : 0;

  return (
    <div className='space-y-4'>
      {linkedPartner && (
        <LinkedPartnerCallout
          anchorTrip={trip}
          partner={linkedPartner}
          statusClass={partnerStatusClass}
          statusLabel={partnerStatusLabel}
          onNavigateToTrip={onNavigateToTrip}
        />
      )}
      {showGroupHint && groupCount > 0 && (
        <GroupedTripHint
          groupMemberCount={groupCount}
          stopOrder={trip.stop_order}
        />
      )}
    </div>
  );
}
