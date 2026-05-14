'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult
} from '@tanstack/react-query';

import {
  createTripPreset,
  deleteTripPreset,
  fetchTripPresets,
  reorderTripPresets,
  updateTripPreset
} from '@/features/trips/api/trip-presets.service';
import type {
  TripPreset,
  TripPresetParams,
  TripPresetUpdate
} from '@/features/trips/types/trip-preset.types';
import { createClient } from '@/lib/supabase/client';
import { tripKeys } from '@/query/keys';

const PRESETS_STALE_MS = 5 * 60 * 1000;

export function useTripPresets() {
  return useQuery({
    queryKey: tripKeys.presets(),
    queryFn: async () => {
      const supabase = createClient();
      return fetchTripPresets(supabase);
    },
    staleTime: PRESETS_STALE_MS
  });
}

export function useCreateTripPreset(): UseMutationResult<
  TripPreset,
  Error,
  {
    name: string;
    params: TripPresetParams;
    column_visibility: Record<string, boolean>;
    column_order: string[];
    /** Passed for API clarity; creates always prepend at `sort_order = 0`. */
    sort_order?: number;
  }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => createTripPreset(createClient(), input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tripKeys.presets() });
    }
  });
}

export function useUpdateTripPreset(): UseMutationResult<
  TripPreset,
  Error,
  { id: string; patch: TripPresetUpdate }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => updateTripPreset(createClient(), id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tripKeys.presets() });
    }
  });
}

export function useDeleteTripPreset(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => deleteTripPreset(createClient(), id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tripKeys.presets() });
    }
  });
}

export function useReorderTripPresets(): UseMutationResult<
  void,
  Error,
  string[]
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds) => reorderTripPresets(createClient(), orderedIds),
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey: tripKeys.presets() });
      const previous = queryClient.getQueryData<TripPreset[]>(
        tripKeys.presets()
      );
      if (previous) {
        const byId = new Map(previous.map((p) => [p.id, p]));
        const next = orderedIds
          .map((id, i) => {
            const row = byId.get(id);
            if (!row) return null;
            return { ...row, sort_order: i };
          })
          .filter(Boolean) as TripPreset[];
        queryClient.setQueryData(tripKeys.presets(), next);
      }
      return { previous };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(tripKeys.presets(), ctx.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: tripKeys.presets() });
    }
  });
}
