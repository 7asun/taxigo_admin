import type { QueryClient } from '@tanstack/react-query';
import { tripKeys } from '@/query/keys';

/**
 * Debounces arbitrary side effects (e.g. `router.refresh()` + Query invalidation) for
 * noisy Supabase streams. Same lifecycle as `createDebouncedInvalidateByQueryKey`: call
 * `schedule` from the handler, `cancel` on effect cleanup.
 */
export function createDebouncedCallback(
  fn: () => void | Promise<void>,
  delayMs = 400
): { schedule: () => void; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const cancel = (): void => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };

  const schedule = (): void => {
    cancel();
    timeoutId = setTimeout(() => {
      timeoutId = undefined;
      void fn();
    }, delayMs);
  };

  return { schedule, cancel };
}

/**
 * Debounces `invalidateQueries` for noisy Supabase `postgres_changes` streams.
 * Call `schedule` from the channel handler; call `cancel` in the effect cleanup.
 */
export function createDebouncedInvalidateByQueryKey(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  delayMs = 350
): { schedule: () => void; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const cancel = (): void => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };

  const schedule = (): void => {
    cancel();
    timeoutId = setTimeout(() => {
      timeoutId = undefined;
      void queryClient.invalidateQueries({ queryKey });
    }, delayMs);
  };

  return { schedule, cancel };
}

/**
 * Debounces invalidation for a single trip detail row (see `useTripQuery`).
 */
export function createDebouncedTripDetailInvalidation(
  queryClient: QueryClient,
  tripId: string,
  delayMs = 350
): { schedule: () => void; cancel: () => void } {
  return createDebouncedInvalidateByQueryKey(
    queryClient,
    tripKeys.detail(tripId),
    delayMs
  );
}
