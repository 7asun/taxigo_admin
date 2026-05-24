'use client';

/**
 * Driver layout tracking context — single mount point for useDriverTracking.
 *
 * Why context: GPS must keep running across all /driver/* routes while shift
 * is active or on break. Tracking toggles on shift bootstrap and ShiftStatusCard
 * mutations; /driver/tracking is read-only status only.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { shiftsService } from '@/features/driver-portal/api/shifts.service';
import { createClient } from '@/lib/supabase/client';
import { isShiftTrackable } from '@/lib/tracking/constants';
import {
  useDriverTracking,
  type LastPosition,
  type TrackingStatus
} from '@/lib/tracking/use-driver-tracking';

export type TrackingContextValue = {
  trackingEnabled: boolean;
  setTrackingEnabled: (val: boolean) => void;
  status: TrackingStatus;
  error: string | null;
  lastPosition: LastPosition | null;
  profileLoading: boolean;
  profileError: string | null;
  shiftStatus: string | null;
  setShiftStatus: (status: string | null) => void;
};

const TrackingContext = createContext<TrackingContextValue | null>(null);

const stubContext = (
  overrides: Partial<TrackingContextValue>
): TrackingContextValue => ({
  trackingEnabled: false,
  setTrackingEnabled: () => {},
  status: 'idle',
  error: null,
  lastPosition: null,
  profileLoading: false,
  profileError: null,
  shiftStatus: null,
  setShiftStatus: () => {},
  ...overrides
});

type TrackingProviderProps = {
  driverId: string;
  companyId: string;
  initialTrackingEnabled: boolean;
  initialShiftStatus: string | null;
  children: ReactNode;
};

export function TrackingProvider({
  driverId,
  companyId,
  initialTrackingEnabled,
  initialShiftStatus,
  children
}: TrackingProviderProps) {
  const [trackingEnabled, setTrackingEnabled] = useState(
    initialTrackingEnabled
  );
  const [shiftStatus, setShiftStatus] = useState(initialShiftStatus);

  const { status, error, lastPosition } = useDriverTracking({
    driverId,
    companyId,
    enabled: trackingEnabled
  });

  const value = useMemo<TrackingContextValue>(
    () => ({
      trackingEnabled,
      setTrackingEnabled,
      status,
      error,
      lastPosition,
      profileLoading: false,
      profileError: null,
      shiftStatus,
      setShiftStatus
    }),
    [trackingEnabled, status, error, lastPosition, shiftStatus]
  );

  return (
    <TrackingContext.Provider value={value}>
      {children}
    </TrackingContext.Provider>
  );
}

type DriverTrackingRootProps = {
  children: ReactNode;
};

/**
 * Loads driver profile + active shift, sets initial tracking state, mounts GPS.
 * Used by the driver app layout shell.
 */
export function DriverTrackingRoot({ children }: DriverTrackingRootProps) {
  const [driverId, setDriverId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [initialShiftStatus, setInitialShiftStatus] = useState<string | null>(
    null
  );
  const [initialTrackingEnabled, setInitialTrackingEnabled] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const supabase = createClient();
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (!user) {
        setProfileError('Nicht angemeldet.');
        setProfileLoading(false);
        return;
      }

      const { data: profile, error } = await supabase
        .from('accounts')
        .select('id, company_id')
        .eq('id', user.id)
        .single();

      if (error || !profile?.company_id) {
        setProfileError('Profil konnte nicht geladen werden.');
        setProfileLoading(false);
        return;
      }

      const shift = await shiftsService.getActiveShift(profile.id);
      const shiftStatus = shift?.status ?? null;

      setDriverId(profile.id);
      setCompanyId(profile.company_id);
      setInitialShiftStatus(shiftStatus);
      setInitialTrackingEnabled(isShiftTrackable(shiftStatus));
      setProfileLoading(false);
    };
    void init();
  }, []);

  if (profileLoading) {
    return (
      <TrackingContext.Provider value={stubContext({ profileLoading: true })}>
        {children}
      </TrackingContext.Provider>
    );
  }

  if (profileError || !driverId || !companyId) {
    return (
      <TrackingContext.Provider
        value={stubContext({ profileLoading: false, profileError })}
      >
        {children}
      </TrackingContext.Provider>
    );
  }

  return (
    <TrackingProvider
      driverId={driverId}
      companyId={companyId}
      initialTrackingEnabled={initialTrackingEnabled}
      initialShiftStatus={initialShiftStatus}
    >
      {children}
    </TrackingProvider>
  );
}

export function useTracking(): TrackingContextValue {
  const ctx = useContext(TrackingContext);
  if (!ctx) {
    throw new Error('useTracking must be used within DriverTrackingRoot');
  }
  return ctx;
}
