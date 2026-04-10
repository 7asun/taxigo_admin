'use client';

import { createClient } from '@/lib/supabase/client';
import type { NavItem } from '@/types';
import { useEffect, useState } from 'react';

/**
 * SECURITY: Layer 5 — UI nav filter (defense in depth).
 * Drivers must not see dashboard sidebar / KBar entries if they ever hit this hook.
 * See docs/access-control.md
 */
export function useFilteredNavItems(items: NavItem[]) {
  const [isDriver, setIsDriver] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setIsDriver(false);
          setReady(true);
        }
        return;
      }
      const { data } = await supabase
        .from('accounts')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (!cancelled) {
        setIsDriver(data?.role === 'driver');
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return items;
  }
  if (isDriver) {
    return [];
  }
  return items;
}
