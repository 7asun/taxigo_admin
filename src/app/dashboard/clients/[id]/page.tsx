import FormCardSkeleton from '@/components/form-card-skeleton';
import PageContainer from '@/components/layout/page-container';
import { createClient } from '@/lib/supabase/server';
import ClientForm from '@/features/clients/components/client-form';
import { Client } from '@/features/clients/api/clients.service';
import { Suspense } from 'react';
import { formatClientNumber } from '@/lib/customer-number';

export const metadata = {
  title: 'Dashboard : Fahrgast bearbeiten'
};

type PageProps = { params: Promise<{ id: string }> };

export default async function Page(props: PageProps) {
  const params = await props.params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', params.id)
    .single();

  if (error) throw error;

  return (
    <PageContainer scrollable>
      <div className='flex-1 space-y-4'>
        <Suspense fallback={<FormCardSkeleton />}>
          <ClientForm
            initialData={data as Client}
            pageTitle={
              data.customer_number
                ? `${[data.first_name, data.last_name].filter(Boolean).join(' ')} (${formatClientNumber(data.customer_number)})`
                : 'Fahrgast bearbeiten'
            }
          />
        </Suspense>
      </div>
    </PageContainer>
  );
}
