'use client';

/**
 * index.tsx  (invoice-builder)
 *
 * Invoice builder wizard coordinator.
 *
 * This component:
 *   1. Maintains currentStep via useInvoiceBuilder()
 *   2. Renders a step indicator header
 *   3. Renders the correct step component based on currentStep
 *   4. Passes callbacks to each step for navigation
 *
 * The wizard guards against missing company_profile by showing an error
 * with a link to /dashboard/settings/company if no profile is set up.
 *
 * Props come from the page (server component passes companyId + payers/clients).
 */

import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useInvoiceBuilder } from '../../hooks/use-invoice-builder';
import { Step1Mode } from './step-1-mode';
import { Step2Params } from './step-2-params';
import { Step3LineItems } from './step-3-line-items';
import { Step4Confirm } from './step-4-confirm';
import type { InvoiceMode } from '../../types/invoice.types';

interface Payer {
  id: string;
  name: string;
  number: string;
  billing_types?: { id: string; name: string }[];
}

interface Client {
  id: string;
  first_name: string | null;
  last_name: string | null;
}

interface InvoiceBuilderProps {
  companyId: string;
  payers: Payer[];
  clients: Client[];
  /** Default payment days from company_profiles.default_payment_days */
  defaultPaymentDays: number;
  /**
   * If true, the company profile is incomplete — show a warning with link
   * to /dashboard/settings/company instead of the wizard.
   */
  companyProfileMissing?: boolean;
}

/** Step indicator config (displayed at the top of the wizard). */
const STEPS = [
  { number: 1, label: 'Modus' },
  { number: 2, label: 'Parameter' },
  { number: 3, label: 'Positionen' },
  { number: 4, label: 'Bestätigen' }
];

/**
 * Invoice builder wizard coordinator.
 * Renders step indicator + the active step component.
 */
export function InvoiceBuilder({
  companyId,
  payers,
  clients,
  defaultPaymentDays,
  companyProfileMissing
}: InvoiceBuilderProps) {
  const router = useRouter();

  const {
    currentStep,
    step2Values,
    lineItems,
    totals,
    missingPrices,
    isLoadingTrips,
    goToStep,
    handleStep1Complete,
    handleStep2Complete,
    handleStep3Complete,
    updateLineItemPrice,
    createInvoice,
    isCreating
  } = useInvoiceBuilder(companyId, (newId) => {
    // Navigate to the detail page after successful creation
    router.push(`/dashboard/invoices/${newId}`);
  });

  // ── Guard: company profile not set up ─────────────────────────────────────
  if (companyProfileMissing) {
    return (
      <Alert>
        <AlertTriangle className='h-4 w-4' />
        <AlertDescription className='space-y-2'>
          <p>
            <strong>Unternehmenseinstellungen fehlen.</strong> Bitte
            vervollständigen Sie Ihr Unternehmensprofil, bevor Sie eine Rechnung
            erstellen.
          </p>
          <Button
            variant='outline'
            size='sm'
            onClick={() => router.push('/dashboard/settings/company')}
          >
            Zu den Einstellungen
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className='space-y-8'>
      {/* ── Step indicator ───────────────────────────────────────────────── */}
      <nav aria-label='Fortschritt' className='flex items-center gap-0'>
        {STEPS.map((step, idx) => (
          <div key={step.number} className='flex items-center'>
            {/* Step circle */}
            <div className='flex flex-col items-center'>
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors',
                  currentStep === step.number
                    ? 'bg-primary text-primary-foreground'
                    : currentStep > step.number
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground'
                )}
              >
                {step.number}
              </div>
              <span
                className={cn(
                  'mt-1 text-xs',
                  currentStep === step.number
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground'
                )}
              >
                {step.label}
              </span>
            </div>
            {/* Connector line (not after last step) */}
            {idx < STEPS.length - 1 && (
              <div
                className={cn(
                  'mb-4 h-px w-16 transition-colors',
                  currentStep > step.number ? 'bg-primary/30' : 'bg-border'
                )}
              />
            )}
          </div>
        ))}
      </nav>

      {/* ── Active step ──────────────────────────────────────────────────── */}
      <div className='bg-card border-border rounded-xl border p-6'>
        {currentStep === 1 && (
          <Step1Mode
            selectedMode={(step2Values?.mode as InvoiceMode) ?? null}
            onSelect={(mode) => handleStep1Complete(mode)}
            onNext={handleStep1Complete}
          />
        )}
        {currentStep === 2 && (
          <Step2Params
            mode={(step2Values?.mode as InvoiceMode) ?? 'monthly'}
            payers={payers}
            clients={clients}
            isLoadingTrips={isLoadingTrips}
            onBack={() => goToStep(1)}
            onNext={handleStep2Complete}
          />
        )}
        {currentStep === 3 && (
          <Step3LineItems
            lineItems={lineItems}
            subtotal={totals.subtotal}
            taxAmount={totals.taxAmount}
            total={totals.total}
            missingPrices={missingPrices}
            isLoadingTrips={isLoadingTrips}
            onBack={() => goToStep(2)}
            onNext={handleStep3Complete}
            onUpdatePrice={updateLineItemPrice}
          />
        )}
        {currentStep === 4 && (
          <Step4Confirm
            subtotal={totals.subtotal}
            taxAmount={totals.taxAmount}
            total={totals.total}
            lineItemCount={lineItems.length}
            defaultPaymentDays={defaultPaymentDays}
            missingPrices={missingPrices}
            isCreating={isCreating}
            onBack={() => goToStep(3)}
            onConfirm={(step4Values) => createInvoice(step4Values)}
          />
        )}
      </div>
    </div>
  );
}
