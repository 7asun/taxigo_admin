'use client';

/**
 * Unified Vorlagen admin: PDF column templates + Brieftext FKs (pdf_vorlagen) and
 * a second tab for full Textbaustein CRUD (InvoiceTemplatesSettingsPage).
 */

import { useState } from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PdfVorlagenSettingsPage } from '@/features/invoices/components/pdf-vorlagen/pdf-vorlagen-settings-page';
import { InvoiceTemplatesSettingsPage } from '@/features/invoices/components/invoice-templates-settings-page';

interface VorlagenPageProps {
  companyId: string;
}

export function VorlagenPage({ companyId }: VorlagenPageProps) {
  const [tab, setTab] = useState('layout');

  return (
    <div className='space-y-6'>
      <Tabs value={tab} onValueChange={setTab} className='w-full'>
        <TabsList className='grid w-full max-w-md grid-cols-2'>
          <TabsTrigger value='layout'>PDF & Layout</TabsTrigger>
          <TabsTrigger value='text' id='textbausteine-section'>
            Textbausteine
          </TabsTrigger>
        </TabsList>
        <TabsContent value='layout' className='mt-6'>
          <PdfVorlagenSettingsPage
            companyId={companyId}
            variant='unified'
            onOpenTextBlocks={() => setTab('text')}
          />
        </TabsContent>
        <TabsContent value='text' className='mt-6 scroll-mt-4'>
          <InvoiceTemplatesSettingsPage embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
