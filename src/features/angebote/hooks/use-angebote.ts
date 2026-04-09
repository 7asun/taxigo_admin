/**
 * use-angebote.ts
 *
 * React Query hooks for reading Angebote data.
 * Mutations live in use-angebot-builder.ts.
 */

import { useQuery } from '@tanstack/react-query';
import { angebotKeys } from '@/query/keys';
import { listAngebote, getAngebot } from '../api/angebote.api';

/**
 * Fetches all Angebote for the current company, newest first.
 */
export function useAngeboteList() {
  return useQuery({
    queryKey: angebotKeys.list(),
    queryFn: () => listAngebote(),
    staleTime: 30_000
  });
}

/**
 * Fetches a single Angebot with its line items.
 *
 * @param id - Angebot UUID.
 */
export function useAngebotDetail(id: string) {
  return useQuery({
    queryKey: angebotKeys.detail(id),
    queryFn: () => getAngebot(id),
    enabled: !!id,
    staleTime: 30_000
  });
}
