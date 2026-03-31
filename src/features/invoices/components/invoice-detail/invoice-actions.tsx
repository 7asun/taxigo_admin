'use client';

/**
 * invoice-actions.tsx
 *
 * Status action buttons for the invoice detail page sidebar.
 *
 * Displayed buttons depend on the current invoice status:
 *
 *   draft     → [Als versendet markieren] [Stornieren]
 *   sent      → [Als bezahlt markieren]   [Stornieren]
 *   paid      → (no actions — final state)
 *   cancelled → (no actions — storniert)
 *   corrected → (no actions — replaced by Stornorechnung)
 *
 * Storno flow (two-step):
 *   1. updateInvoiceStatus('cancelled') on original invoice
 *   2. createStornorechnung() to create the Storno with negative amounts
 *   A confirmation dialog is shown before executing storno.
 */

import { useState } from 'react';
import { Loader2, Send, CheckCircle, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import {
  useUpdateInvoiceStatus,
  useCreateStornorechnung
} from '../../hooks/use-invoice';
import type { InvoiceDetail, InvoiceStatus } from '../../types/invoice.types';

interface InvoiceActionsProps {
  invoice: InvoiceDetail;
}

/**
 * Renders contextual action buttons based on the current invoice status.
 */
export function InvoiceActions({ invoice }: InvoiceActionsProps) {
  const [stornoStep, setStornoStep] = useState<
    'idle' | 'cancelling' | 'creating'
  >('idle');

  const updateStatus = useUpdateInvoiceStatus(invoice.id);
  const createStorno = useCreateStornorechnung(invoice.id);

  const isWorking =
    updateStatus.isPending || createStorno.isPending || stornoStep !== 'idle';

  /**
   * Storno flow runs in two sequential steps:
   *   1. Cancel the original invoice
   *   2. Create the Stornorechnung
   */
  const handleStorno = async () => {
    try {
      setStornoStep('cancelling');
      await updateStatus.mutateAsync('cancelled');

      setStornoStep('creating');
      await createStorno.mutateAsync({
        originalInvoice: invoice,
        originalLineItems: invoice.line_items
      });
    } finally {
      setStornoStep('idle');
    }
  };

  // No actions for terminal states
  if (['paid', 'cancelled', 'corrected'].includes(invoice.status)) {
    return null;
  }

  return (
    <div className='space-y-2'>
      {/* Mark as sent (draft only) */}
      {invoice.status === 'draft' && (
        <Button
          className='w-full gap-2'
          onClick={() => updateStatus.mutate('sent')}
          disabled={isWorking}
        >
          {updateStatus.isPending ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            <Send className='h-4 w-4' />
          )}
          Als versendet markieren
        </Button>
      )}

      {/* Mark as paid (sent only) */}
      {invoice.status === 'sent' && (
        <Button
          className='w-full gap-2'
          onClick={() => updateStatus.mutate('paid')}
          disabled={isWorking}
        >
          {updateStatus.isPending ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            <CheckCircle className='h-4 w-4' />
          )}
          Als bezahlt markieren
        </Button>
      )}

      {/* Stornieren — draft + sent */}
      {(['draft', 'sent'] as InvoiceStatus[]).includes(invoice.status) && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant='outline'
              className='text-destructive w-full gap-2'
              disabled={isWorking}
            >
              {isWorking && stornoStep !== 'idle' ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <XCircle className='h-4 w-4' />
              )}
              {stornoStep === 'cancelling'
                ? 'Storniere…'
                : stornoStep === 'creating'
                  ? 'Stornorechnung wird erstellt…'
                  : 'Stornieren'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Rechnung stornieren?</AlertDialogTitle>
              <AlertDialogDescription>
                Rechnung <strong>{invoice.invoice_number}</strong> wird
                storniert. Es wird automatisch eine Stornorechnung mit negativen
                Beträgen erstellt. Dieser Vorgang kann nicht rückgängig gemacht
                werden.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
                onClick={handleStorno}
              >
                Ja, stornieren
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
