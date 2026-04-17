'use client';

import * as React from 'react';
import { createClient } from '@/lib/supabase/client';
import type { ClientOption } from '@/features/trips/hooks/use-trip-form-data';

/**
 * Debounce delay before firing a Supabase query after the user stops typing.
 * 300ms balances responsiveness with fewer round-trips than an undebounced input.
 */
export const CLIENT_SEARCH_DEBOUNCE_MS = 300;

/**
 * How many clients to show when the search box is empty — a stable alphabetical
 * slice so step 1 always has a list without requiring two characters (unlike
 * `useTripFormData.searchClients`).
 */
export const CLIENT_BROWSE_PAGE_SIZE = 100;

/**
 * Max rows for a non-empty search. Larger than `searchClients`'s limit (8) so the
 * Regelfahrten picker can scroll through enough matches for dispatch workflows.
 */
export const CLIENT_SEARCH_MAX_RESULTS = 50;

/**
 * Standalone debounced client lookup for the "Neue Regelfahrt" sheet step 1.
 *
 * **Why not `useTripFormData().searchClients`?** That hook pulls payers, drivers,
 * and billing variants on every mount — wasteful for a client picker. Its
 * `searchClients` also returns `[]` when the query is empty or shorter than 2
 * characters, which would leave step 1 blank. This hook uses the browser
 * Supabase client directly with a dedicated browse query for empty input.
 *
 * **Stale responses:** We use a `cancelled` boolean cleared in `useEffect` cleanup,
 * not `AbortController`. The Supabase JS client does not reliably honour
 * `AbortSignal` on all query paths; a flag after `await` avoids races when the
 * user types quickly without pretending requests were aborted server-side.
 */
export function useClientSearch(query: string): {
  clients: ClientOption[];
  isLoading: boolean;
} {
  const [clients, setClients] = React.useState<ClientOption[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);

  React.useEffect(() => {
    // Stale-response guard: cleanup sets `true` so in-flight Supabase results
    // are ignored (no AbortController — see file JSDoc).
    let cancelled = false;
    const trimmed = query.trim();

    const run = async () => {
      setIsLoading(true);
      const supabase = createClient();

      try {
        if (!trimmed) {
          const { data, error } = await supabase
            .from('clients')
            .select(
              'id, first_name, last_name, company_name, is_company, phone, phone_secondary, email, street, street_number, zip_code, city, is_wheelchair'
            )
            .order('last_name', { ascending: true })
            .limit(CLIENT_BROWSE_PAGE_SIZE);

          if (cancelled) return;
          if (error) {
            setClients([]);
            return;
          }
          setClients((data ?? []) as ClientOption[]);
        } else {
          const { data, error } = await supabase
            .from('clients')
            .select(
              'id, first_name, last_name, company_name, is_company, phone, phone_secondary, email, street, street_number, zip_code, city, is_wheelchair'
            )
            .or(
              `first_name.ilike.%${trimmed}%,last_name.ilike.%${trimmed}%,company_name.ilike.%${trimmed}%,email.ilike.%${trimmed}%`
            )
            .order('last_name', { ascending: true })
            .limit(CLIENT_SEARCH_MAX_RESULTS);

          if (cancelled) return;
          if (error) {
            setClients([]);
            return;
          }
          setClients((data ?? []) as ClientOption[]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    const t = window.setTimeout(() => {
      void run();
    }, CLIENT_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query]);

  return { clients, isLoading };
}
