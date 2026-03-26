'use client';

import { useEffect, useState } from 'react';
import {
  getUrgencyLevel,
  type UrgencyLevel
} from '@/features/trips/lib/urgency-logic';
import type { TripStatus } from '@/lib/trip-status';

/**
 * Live urgency level for `scheduled_at` + `status`, refreshed every 10s (same cadence as
 * `UrgencyIndicator`) so Kanban time chips stay in sync without rendering a dot.
 */
export function useUrgencyLevel(
  scheduledAt: string | Date | null | undefined,
  status: TripStatus | string
): UrgencyLevel {
  const [level, setLevel] = useState<UrgencyLevel>(() =>
    getUrgencyLevel(scheduledAt, status)
  );

  useEffect(() => {
    const update = () => setLevel(getUrgencyLevel(scheduledAt, status));
    update();
    const interval = setInterval(update, 10000);
    return () => clearInterval(interval);
  }, [scheduledAt, status]);

  return level;
}
