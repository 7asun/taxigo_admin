/**
 * React Query hooks for letters — thin wrappers over letters.api so UI never
 * touches Supabase directly. Inline Letter types avoid stale database.types.ts
 * until `bun run db:types` is run after the migration ships.
 */

'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query';

import { letterKeys } from '@/query/keys';
import {
  createLetter,
  deleteLetter,
  getLetter,
  listLetters,
  updateLetter
} from '../api/letters.api';
import type { Letter, LetterInsert, LetterUpdate } from '../types';

export function useLetters(): UseQueryResult<Letter[], Error> {
  return useQuery({
    queryKey: letterKeys.list(),
    queryFn: () => listLetters(),
    staleTime: 30_000
  });
}

export function useLetter(
  id: string | null | undefined
): UseQueryResult<Letter, Error> {
  const safeId = typeof id === 'string' && id.length > 0 ? id : null;
  return useQuery({
    queryKey: safeId
      ? letterKeys.detail(safeId)
      : ['letters', 'detail', '__idle__'],
    queryFn: () => getLetter(safeId!),
    enabled: !!safeId,
    staleTime: 30_000
  });
}

export function useCreateLetter(): UseMutationResult<
  Letter,
  Error,
  LetterInsert
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: LetterInsert) => createLetter(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: letterKeys.all });
    }
  });
}

export function useUpdateLetter(): UseMutationResult<
  Letter,
  Error,
  { id: string; patch: LetterUpdate }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: LetterUpdate }) =>
      updateLetter(id, patch),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: letterKeys.all });
      void queryClient.invalidateQueries({
        queryKey: letterKeys.detail(variables.id)
      });
    }
  });
}

export function useDeleteLetter(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteLetter(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: letterKeys.all });
    }
  });
}
