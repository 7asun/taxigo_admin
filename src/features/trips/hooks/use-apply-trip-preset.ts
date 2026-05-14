'use client';

import type { VisibilityState } from '@tanstack/react-table';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback } from 'react';

import { useTripsRscRefresh } from '@/features/trips/providers';
import { useTripsTableStore } from '@/features/trips/stores/use-trips-table-store';
import type { TripPreset } from '@/features/trips/types/trip-preset.types';

export function jsonToColumnOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}

export function jsonToVisibilityState(raw: unknown): VisibilityState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: VisibilityState = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export function jsonToParamEntries(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v != null && String(v) !== '') out[k] = String(v);
  }
  return out;
}

/**
 * Applies a preset atomically: URL params + column visibility + column order.
 * Visibility / order go straight to TanStack when the list table exists; otherwise
 * queued until TripsTable mounts (Kanban → Liste).
 */
export function useApplyTripPreset() {
  const router = useRouter();
  const pathname = usePathname();
  const { refreshTripsPage } = useTripsRscRefresh();
  const setPendingColumnVisibility = useTripsTableStore(
    (s) => s.setPendingColumnVisibility
  );
  const setPendingColumnOrder = useTripsTableStore(
    (s) => s.setPendingColumnOrder
  );

  return useCallback(
    (preset: TripPreset) => {
      const params = new URLSearchParams();
      const stored = jsonToParamEntries(preset.params);
      Object.entries(stored).forEach(([k, v]) => {
        if (v) params.set(k, v);
      });
      params.set('page', '1');

      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      void refreshTripsPage();

      const visibility = jsonToVisibilityState(preset.column_visibility);
      const tbl = useTripsTableStore.getState().table;
      if (tbl !== null) {
        tbl.setColumnVisibility(visibility);
      } else {
        setPendingColumnVisibility(visibility);
      }

      const order = jsonToColumnOrder(preset.column_order);
      if (order.length > 0) {
        if (tbl !== null) {
          tbl.setColumnOrder(order);
        } else {
          setPendingColumnOrder(order);
        }
      }
    },
    [
      router,
      pathname,
      refreshTripsPage,
      setPendingColumnVisibility,
      setPendingColumnOrder
    ]
  );
}
