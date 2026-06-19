'use client';

import * as React from 'react';

import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useDebouncedCallback } from '@/hooks/use-debounced-callback';

import { normalizeKtsPatch } from '@/features/kts/kts.service';
import { useUpdateKtsMutation } from '@/features/kts/hooks/use-update-kts-mutation';
import { useTripFieldUpdate } from '@/features/trips/hooks/use-trip-field-update';
import type { TripRow } from '@/features/trips/types/trip-row';

export type { TripRow };

// ─── Shared optimistic KTS columns (separate table cells, one logical row) ───
// Each column mounts its own Provider; per-trip-id stores + useSyncExternalStore
// keep kts_document_applies and kts_fehler in sync across those trees.

const ktsDocOverrideListeners = new Map<string, Set<() => void>>();
/** Explicit override for server `kts_document_applies`; missing key = use server. */
const ktsDocOverrides = new Map<string, boolean>();

function subscribeKtsDocOverride(
  tripId: string,
  onChange: () => void
): () => void {
  let set = ktsDocOverrideListeners.get(tripId);
  if (!set) {
    set = new Set();
    ktsDocOverrideListeners.set(tripId, set);
  }
  set.add(onChange);
  return () => {
    set!.delete(onChange);
    if (set!.size === 0) {
      ktsDocOverrideListeners.delete(tripId);
    }
  };
}

function getKtsDocOverrideSnapshot(tripId: string): boolean | undefined {
  return ktsDocOverrides.get(tripId);
}

function setKtsDocOverride(tripId: string, value: boolean | null): void {
  if (value === null) {
    if (ktsDocOverrides.has(tripId)) {
      ktsDocOverrides.delete(tripId);
      ktsDocOverrideListeners.get(tripId)?.forEach((l) => l());
    }
    return;
  }
  const prev = ktsDocOverrides.get(tripId);
  if (prev === value) return;
  ktsDocOverrides.set(tripId, value);
  ktsDocOverrideListeners.get(tripId)?.forEach((l) => l());
}

const ktsFehlerOverrideListeners = new Map<string, Set<() => void>>();
/** Explicit override for server `kts_fehler`; missing key = use server. */
const ktsFehlerOverrides = new Map<string, boolean>();

function subscribeKtsFehlerOverride(
  tripId: string,
  onChange: () => void
): () => void {
  let listenerSet = ktsFehlerOverrideListeners.get(tripId);
  if (!listenerSet) {
    listenerSet = new Set();
    ktsFehlerOverrideListeners.set(tripId, listenerSet);
  }
  listenerSet.add(onChange);
  return () => {
    listenerSet!.delete(onChange);
    if (listenerSet!.size === 0) {
      ktsFehlerOverrideListeners.delete(tripId);
    }
  };
}

function getKtsFehlerOverrideSnapshot(tripId: string): boolean | undefined {
  return ktsFehlerOverrides.get(tripId);
}

function setKtsFehlerOverride(tripId: string, value: boolean | null): void {
  if (value === null) {
    if (ktsFehlerOverrides.has(tripId)) {
      ktsFehlerOverrides.delete(tripId);
      ktsFehlerOverrideListeners.get(tripId)?.forEach((l) => l());
    }
    return;
  }
  const prev = ktsFehlerOverrides.get(tripId);
  if (prev === value) return;
  ktsFehlerOverrides.set(tripId, value);
  ktsFehlerOverrideListeners.get(tripId)?.forEach((l) => l());
}

const KtsOptimisticContext = React.createContext<{
  ktsActive: boolean;
  setKtsOptimistic: (v: boolean | null) => void;
  ktsFehlerActive: boolean;
  setKtsFehlerOptimistic: (v: boolean | null) => void;
} | null>(null);

function useKtsOptimistic() {
  return React.useContext(KtsOptimisticContext);
}

function useKtsRowOptimisticShared(trip: TripRow) {
  const tripId = trip.id;

  const docOverride = React.useSyncExternalStore(
    (cb) => subscribeKtsDocOverride(tripId, cb),
    () => getKtsDocOverrideSnapshot(tripId),
    () => undefined
  );

  const fehlerOverride = React.useSyncExternalStore(
    (cb) => subscribeKtsFehlerOverride(tripId, cb),
    () => getKtsFehlerOverrideSnapshot(tripId),
    () => undefined
  );

  React.useEffect(() => {
    setKtsDocOverride(tripId, null);
  }, [tripId, trip.kts_document_applies]);

  React.useEffect(() => {
    setKtsFehlerOverride(tripId, null);
  }, [tripId, trip.kts_fehler]);

  const ktsActive =
    docOverride !== undefined ? docOverride : !!trip.kts_document_applies;
  const ktsFehlerActive = !ktsActive
    ? false
    : fehlerOverride !== undefined
      ? fehlerOverride
      : !!trip.kts_fehler;

  React.useEffect(() => {
    if (!ktsActive) {
      setKtsFehlerOverride(tripId, null);
    }
  }, [tripId, ktsActive]);

  const setKtsOptimistic = React.useCallback(
    (v: boolean | null) => {
      setKtsDocOverride(tripId, v);
    },
    [tripId]
  );

  const setKtsFehlerOptimistic = React.useCallback(
    (v: boolean | null) => {
      setKtsFehlerOverride(tripId, v);
    },
    [tripId]
  );

  return React.useMemo(
    () => ({
      ktsActive,
      setKtsOptimistic,
      ktsFehlerActive,
      setKtsFehlerOptimistic
    }),
    [ktsActive, setKtsOptimistic, ktsFehlerActive, setKtsFehlerOptimistic]
  );
}

/**
 * Per-row bridge for KTS columns. Multiple Providers per row share optimistic state
 * via trip-id stores so switches and the Fehler text column stay aligned.
 */
export function KtsCellGroupProvider({
  trip,
  children
}: {
  trip: TripRow;
  children: React.ReactNode;
}) {
  const value = useKtsRowOptimisticShared(trip);
  return (
    <KtsOptimisticContext.Provider value={value}>
      {children}
    </KtsOptimisticContext.Provider>
  );
}

export function KtsSwitchCell({ trip }: { trip: TripRow }) {
  const { mutate } = useUpdateKtsMutation();

  const ctx = useKtsOptimistic();
  const checked = ctx?.ktsActive ?? !!trip.kts_document_applies;

  function handleChange(next: boolean) {
    ctx?.setKtsOptimistic(next);
    // why: cascade (Fehler off, beschreibung null, kts_source manual) lives in kts.service — not duplicated here.
    mutate({
      id: trip.id,
      patch: { kts_document_applies: next }
    });
  }

  return (
    <div className='flex justify-center px-1'>
      <Switch
        checked={checked}
        onCheckedChange={handleChange}
        aria-label='KTS vorhanden'
      />
    </div>
  );
}

export function KtsFehlerSwitchCell({ trip }: { trip: TripRow }) {
  const { mutate } = useUpdateKtsMutation();
  const ctx = useKtsOptimistic();
  const ktsActive = ctx?.ktsActive ?? !!trip.kts_document_applies;
  const checked = ctx?.ktsFehlerActive ?? !!trip.kts_fehler;

  if (!ktsActive) {
    return (
      <div className='flex justify-center px-1'>
        <span className='text-muted-foreground'>—</span>
      </div>
    );
  }

  function handleChange(next: boolean) {
    ctx?.setKtsFehlerOptimistic(next);
    // why: beschreibung null when fehler off is applied by normalizeKtsPatch in the service.
    mutate({ id: trip.id, patch: { kts_fehler: next } });
  }

  return (
    <div className='flex justify-center px-1'>
      <Switch
        checked={checked}
        onCheckedChange={handleChange}
        aria-label='KTS-Fehler vorhanden'
      />
    </div>
  );
}

export function KtsFehlerTextCell({ trip }: { trip: TripRow }) {
  const { updateField, isPending } = useTripFieldUpdate();
  const [draft, setDraft] = React.useState(
    () => trip.kts_fehler_beschreibung ?? ''
  );

  const ctx = useKtsOptimistic();
  const ktsActive = ctx?.ktsActive ?? !!trip.kts_document_applies;
  const ktsFehlerActive = ctx?.ktsFehlerActive ?? !!trip.kts_fehler;

  // Prop can change after RSC refresh, sibling cell cascades, or another session — keep draft aligned.
  React.useEffect(() => {
    setDraft(trip.kts_fehler_beschreibung ?? '');
  }, [trip.id, trip.kts_fehler_beschreibung]);

  // 1500ms gives the admin time to finish typing a sentence before the save
  // triggers. 400ms caused visible freezes mid-input.
  const debouncedPersist = useDebouncedCallback((raw: string) => {
    const { kts_fehler_beschreibung } = normalizeKtsPatch({
      kts_fehler_beschreibung: raw.trim() || null
    });
    updateField(trip.id, 'kts_fehler_beschreibung', kts_fehler_beschreibung);
  }, 1500);

  const v = trip.kts_fehler_beschreibung as string | null | undefined;
  const t = v?.trim();

  if (!ktsActive || !ktsFehlerActive) {
    if (!t) {
      return (
        <div className='flex justify-center px-1'>
          <span className='text-muted-foreground'>—</span>
        </div>
      );
    }
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className='max-w-[160px] cursor-default truncate text-sm'>
              {t}
            </span>
          </TooltipTrigger>
          <TooltipContent side='top' className='max-w-xs text-xs'>
            {t}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <input
      className={cn(
        'border-input bg-background max-w-[180px] rounded-md border px-2 py-1 text-sm',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        isPending && 'opacity-60'
      )}
      value={draft}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        debouncedPersist(next);
      }}
      aria-label='KTS-Fehler Beschreibung'
    />
  );
}
