'use client';

/**
 * company-settings-page.tsx
 *
 * Page-level shell for the company settings area.
 * Intentionally tab-based so future sections (notifications, team,
 * integrations, etc.) can be added as new <TabsContent> blocks
 * without touching existing code.
 *
 * Current tabs:
 *   - Unternehmen  → CompanySettingsForm (legal, tax, banking, logo)
 *
 * Future tabs to add here (no other files need changing):
 *   - Benachrichtigungen → NotificationSettingsForm
 *   - Team              → TeamSettingsForm
 *   - Integrationen     → IntegrationsSettingsForm
 *
 * Design system: theme tokens only, shadcn/ui Tabs + PageContainer.
 */

import { Building2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CompanySettingsForm } from './company-settings-form';

export function CompanySettingsPage() {
  return (
    <div className='mx-auto w-full max-w-4xl flex-1 space-y-6 pb-10'>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className='flex items-start gap-3'>
        <div className='bg-primary/10 text-primary mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl'>
          <Building2 className='h-5 w-5' />
        </div>
        <div>
          <h2 className='text-3xl font-bold tracking-tight'>Einstellungen</h2>
          <p className='text-muted-foreground mt-1'>
            Verwalten Sie die Stammdaten Ihres Unternehmens.
          </p>
        </div>
      </div>

      {/* ── Tab navigation ──────────────────────────────────────────────── */}
      {/*
        HOW TO ADD A FUTURE TAB:
          1. Add a <TabsTrigger value='your-tab'>Label</TabsTrigger>
          2. Add a <TabsContent value='your-tab'><YourForm /></TabsContent>
          Done — no other files need changing.
      */}
      <Tabs defaultValue='company' className='space-y-6'>
        <TabsList className='bg-muted'>
          <TabsTrigger value='company' className='gap-2'>
            <Building2 className='h-3.5 w-3.5' />
            Unternehmen
          </TabsTrigger>
          {/* Future tabs go here ↓ */}
        </TabsList>

        {/* ── Tab: Unternehmen ────────────────────────────────────────── */}
        <TabsContent value='company' className='space-y-0'>
          <CompanySettingsForm />
        </TabsContent>

        {/* Future <TabsContent> blocks go here ↓ */}
      </Tabs>
    </div>
  );
}
