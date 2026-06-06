'use client';

/**
 * invoice-actions.tsx
 *
 * Status action buttons for the invoice detail page sidebar.
 *
 * Displayed buttons depend on the current invoice status:
 *
 *   draft (normal)     → [Bearbeiten?] [Als versendet] [Stornieren]
 *   draft (Storno doc) → [Als versendet] [Neue Rechnung erstellen]
 *   sent               → [Als bezahlt] [Stornieren]
 *   paid / cancelled   → (no actions)
 *   corrected          → [Neue Rechnung erstellen] only
 *
 * Storno: after confirm, createStornorechnung runs a single atomic Postgres RPC.
 * Branch: after Storno, createBranchDraft copies the corrected original into a new draft.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  Send,
  CheckCircle,
  XCircle,
  Pencil,
  FilePlus2
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
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
  useCreateStornorechnung,
  useCreateBranchDraft,
  useBranchDraftExists
} from '../../hooks/use-invoice';
import type { InvoiceDetail, InvoiceStatus } from '../../types/invoice.types';

interface InvoiceActionsProps {
  invoice: InvoiceDetail;
}

function BranchDraftButton({
  originalInvoiceId,
  companyId,
  disabled,
  isWorking
}: {
  originalInvoiceId: string;
  companyId: string;
  disabled: boolean;
  isWorking: boolean;
}) {
  const router = useRouter();
  const createBranch = useCreateBranchDraft(originalInvoiceId);
  const [branchStep, setBranchStep] = useState<'idle' | 'creating'>('idle');

  const handleBranch = async () => {
    try {
      setBranchStep('creating');
      const { branchDraftId } = await createBranch.mutateAsync({
        originalInvoiceId,
        companyId
      });
      router.push(`/dashboard/invoices/${branchDraftId}/edit`);
    } finally {
      setBranchStep('idle');
    }
  };

  const buttonLabel =
    branchStep === 'creating'
      ? 'Korrekturrechnung wird erstellt…'
      : 'Neue Rechnung erstellen';

  if (disabled) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className='inline-flex w-full'>
              <Button variant='outline' className='w-full gap-2' disabled>
                <FilePlus2 className='h-4 w-4' />
                {buttonLabel}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Für diese Rechnung wurde bereits eine Korrekturrechnung erstellt.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant='outline'
          className='w-full gap-2'
          disabled={isWorking || createBranch.isPending}
        >
          {branchStep !== 'idle' || createBranch.isPending ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            <FilePlus2 className='h-4 w-4' />
          )}
          {buttonLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Neue Rechnung erstellen?</AlertDialogTitle>
          <AlertDialogDescription>
            Es wird ein neuer Rechnungsentwurf mit den Beträgen der stornierten
            Rechnung erstellt. Sie können den Entwurf anschließend im Builder
            anpassen und erneut ausstellen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction onClick={handleBranch}>
            Ja, Entwurf erstellen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Renders contextual action buttons based on the current invoice status.
 */
export function InvoiceActions({ invoice }: InvoiceActionsProps) {
  const router = useRouter();
  const [stornoStep, setStornoStep] = useState<'idle' | 'creating'>('idle');

  const updateStatus = useUpdateInvoiceStatus(invoice.id);
  const createStorno = useCreateStornorechnung(invoice.id);

  // why: Stornorechnung rows are draft + cancels_invoice_id — must not show Stornieren/Bearbeiten.
  const isStornoDocument = invoice.cancels_invoice_id != null;

  const branchOriginalId =
    invoice.status === 'corrected'
      ? invoice.id
      : isStornoDocument
        ? invoice.cancels_invoice_id
        : null;

  const branchExistsQuery = useBranchDraftExists(branchOriginalId);
  const branchAlreadyExists = branchExistsQuery.data === true;

  // why: branch drafts bypass revision_invoices_enabled on the edit route; normal drafts need the flag.
  const canEditDraft =
    invoice.status === 'draft' &&
    !isStornoDocument &&
    invoice.payer?.revision_invoices_enabled === true;

  const isWorking =
    updateStatus.isPending || createStorno.isPending || stornoStep !== 'idle';

  const handleStorno = async () => {
    try {
      setStornoStep('creating');
      await createStorno.mutateAsync({
        originalInvoice: invoice,
        originalLineItems: invoice.line_items
      });
    } finally {
      setStornoStep('idle');
    }
  };

  // why: paid/cancelled are terminal — no Storno or branch actions remain.
  if (['paid', 'cancelled'].includes(invoice.status)) {
    return null;
  }

  const branchButton =
    branchOriginalId != null ? (
      <BranchDraftButton
        originalInvoiceId={branchOriginalId}
        companyId={invoice.company_id}
        disabled={branchAlreadyExists}
        isWorking={isWorking}
      />
    ) : null;

  // why: corrected originals only offer the branch path — no sent/paid/storno actions.
  if (invoice.status === 'corrected') {
    return <div className='space-y-2'>{branchButton}</div>;
  }

  return (
    <div className='space-y-2'>
      {canEditDraft && (
        <Button
          variant='outline'
          className='w-full gap-2'
          onClick={() => router.push(`/dashboard/invoices/${invoice.id}/edit`)}
          disabled={isWorking}
        >
          <Pencil className='h-4 w-4' />
          Bearbeiten
        </Button>
      )}

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

      {(['draft', 'sent'] as InvoiceStatus[]).includes(invoice.status) &&
        !isStornoDocument && (
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
                {stornoStep === 'creating'
                  ? 'Stornorechnung wird erstellt…'
                  : 'Stornieren'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Rechnung stornieren?</AlertDialogTitle>
                <AlertDialogDescription>
                  Rechnung <strong>{invoice.invoice_number}</strong> wird
                  storniert. Es wird automatisch eine Stornorechnung mit
                  negativen Beträgen erstellt. Dieser Vorgang kann nicht
                  rückgängig gemacht werden.
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

      {branchButton}
    </div>
  );
}
