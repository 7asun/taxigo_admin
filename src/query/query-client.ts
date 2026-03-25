import { QueryClient } from '@tanstack/react-query';

/**
 * @fileoverview Shared TanStack Query defaults for the admin app.
 *
 * **staleTime** — Data is treated as fresh for this duration; avoids refetching on every
 * remount. Realtime invalidation and mutations still trigger refetches via
 * `invalidateQueries` (see `src/query/README.md`).
 *
 * **Why not default (0)?** — `staleTime: 0` marks data stale immediately, so focus/reconnect
 * refetches more often than needed for dispatch UIs.
 */
const DEFAULT_STALE_TIME_MS = 60_000;

/**
 * Creates a `QueryClient` with app-wide defaults. Use a single instance in
 * `QueryClientProvider` ([`providers.tsx`](../components/layout/providers.tsx)).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS,
        retry: 1,
        refetchOnWindowFocus: true
      }
    }
  });
}
