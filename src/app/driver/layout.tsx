/**
 * Driver app layout — mobile-first, no sidebar, no KBar.
 * Uses safe-area-inset for notched devices.
 * Redirects admins to dashboard (driver routes are for drivers only).
 * GPS tracking runs in DriverLayoutClient via TrackingContext (all /driver/* routes).
 * Complements Layer 1 proxy; see docs/access-control.md.
 */

import { DriverLayoutClient } from '@/app/driver/driver-layout-client';
import { createClient } from '@/lib/supabase/server';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'TaxiGo Fahrer',
  description: 'Schicht-Tracking für Fahrer',
  robots: { index: false, follow: false }
};

export default async function DriverLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from('accounts')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'driver') {
      redirect('/dashboard/overview');
    }
  }

  return <DriverLayoutClient>{children}</DriverLayoutClient>;
}
