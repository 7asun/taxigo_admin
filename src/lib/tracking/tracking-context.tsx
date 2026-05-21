'use client';

/**
 * Driver layout tracking context — single mount point for useDriverTracking.
 *
 * Why context: GPS must keep running across all /driver/* routes; only the
 * /driver/tracking page controls start/stop and shows status.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { TRACKING_CONSENT_STORAGE_KEY } from '@/lib/tracking/constants';
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
};

const TrackingContext = createContext<TrackingContextValue | null>(null);

function hasSessionConsent(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(TRACKING_CONSENT_STORAGE_KEY) === '1';
}

type TrackingProviderProps = {
  driverId: string;
  companyId: string;
  children: ReactNode;
};

export function TrackingProvider({
  driverId,
  companyId,
  children
}: TrackingProviderProps) {
  const [trackingEnabled, setTrackingEnabled] = useState(false);

  useEffect(() => {
    if (hasSessionConsent()) {
      setTrackingEnabled(true);
    }
  }, []);

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
      profileError: null
    }),
    [trackingEnabled, status, error, lastPosition]
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
 * Loads driver profile, restores consent from sessionStorage, mounts tracking.
 * Used by the driver app layout shell.
 */
export function DriverTrackingRoot({ children }: DriverTrackingRootProps) {
  const [driverId, setDriverId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
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

      setDriverId(profile.id);
      setCompanyId(profile.company_id);
      setProfileLoading(false);
    };
    void init();
  }, []);

  if (profileLoading) {
    return (
      <TrackingContext.Provider
        value={{
          trackingEnabled: false,
          setTrackingEnabled: () => {},
          status: 'idle',
          error: null,
          lastPosition: null,
          profileLoading: true,
          profileError: null
        }}
      >
        {children}
      </TrackingContext.Provider>
    );
  }

  if (profileError || !driverId || !companyId) {
    return (
      <TrackingContext.Provider
        value={{
          trackingEnabled: false,
          setTrackingEnabled: () => {},
          status: 'idle',
          error: null,
          lastPosition: null,
          profileLoading: false,
          profileError
        }}
      >
        {children}
      </TrackingContext.Provider>
    );
  }

  return (
    <TrackingProvider driverId={driverId} companyId={companyId}>
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
