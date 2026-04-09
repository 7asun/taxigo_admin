'use client';

import { AlertTriangle, Settings } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface NoBillingTypesWarningProps {
  payerId: string;
}

export function NoBillingTypesWarning({ payerId }: NoBillingTypesWarningProps) {
  return (
    <Alert className='mb-4 border-amber-200 bg-amber-50'>
      <AlertTriangle className='h-4 w-4' />
      <AlertTitle>Abrechnungsarten fehlen</AlertTitle>
      <AlertDescription className='flex items-center justify-between gap-4'>
        <span>
          Für diesen Kostenträger sind noch keine Abrechnungsarten konfiguriert.
          Bitte zuerst anlegen.
        </span>
        <Link href='/dashboard/payers'>
          <Button variant='outline' size='sm'>
            <Settings className='mr-2 h-4 w-4' />
            Kostenträger bearbeiten
          </Button>
        </Link>
      </AlertDescription>
    </Alert>
  );
}
