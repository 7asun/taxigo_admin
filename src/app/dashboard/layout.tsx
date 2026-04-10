import KBar from '@/components/kbar';
import AppSidebar from '@/components/layout/app-sidebar';
import Header from '@/components/layout/header';
import { InfoSidebar } from '@/components/layout/info-sidebar';
import { InfobarProvider } from '@/components/ui/infobar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { getDocSearchData } from '@/lib/documentation';
import { createClient } from '@/lib/supabase/server';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Next Shadcn Dashboard Starter',
  description: 'Basic dashboard with Next.js and Shadcn',
  robots: {
    index: false,
    follow: false
  }
};

export default async function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  // SECURITY: Layer 2 guard — server-side role check.
  // Even if proxy (Layer 1) is bypassed, this ensures only admins
  // can render any dashboard page. See docs/access-control.md
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/auth/sign-in');
  }
  const { data: account } = await supabase
    .from('accounts')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!account?.role) {
    redirect('/auth/sign-in');
  }
  if (account.role !== 'admin') {
    redirect('/driver/shift');
  }

  // Persisting the sidebar state in the cookie.
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar_state')?.value === 'true';

  const docSearchData = getDocSearchData();

  return (
    <KBar docSearchData={docSearchData}>
      <SidebarProvider
        defaultOpen={defaultOpen}
        className='h-svh max-h-svh overflow-hidden'
      >
        <InfobarProvider defaultOpen={false}>
          <AppSidebar />
          <SidebarInset>
            <Header />
            <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
              {children}
            </div>
          </SidebarInset>
          <InfoSidebar side='right' />
        </InfobarProvider>
      </SidebarProvider>
    </KBar>
  );
}
