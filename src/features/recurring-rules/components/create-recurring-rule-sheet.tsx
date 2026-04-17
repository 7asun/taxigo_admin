'use client';

/**
 * Two-step Sheet: pick a Fahrgast, then create a recurring rule with the same
 * fields as `RecurringRuleSheet` (via `RecurringRuleFormBody`).
 *
 * **Why `RecurringRuleFormBody` and not `RecurringRulePanel`?** The panel is a
 * Miller-column shell (`PanelHeader` / `PanelBody` / `PanelFooter`) meant to
 * sit in a full-height column beside other columns. Embedding it in a Sheet
 * would nest competing scroll regions and layout contexts. The form body is
 * headless and already shared by `RecurringRuleSheet` for overlay flows — same
 * pattern as `docs/panel-layout-system.md` (Sheet vs Miller column).
 */

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { ClientAutoSuggest } from '@/components/ui/client-auto-suggest';
import { buildRecurringRulePayload } from '@/features/clients/lib/build-recurring-rule-payload';
import {
  RecurringRuleFormBody,
  RuleFormValues,
  getRuleFormDefaults,
  ruleFormSchema,
  NO_BILLING_VARIANT_SENTINEL,
  handleRuleFormInvalid
} from '@/features/clients/components/recurring-rule-form-body';
import { recurringRulesService } from '@/features/trips/api/recurring-rules.service';
import { useTripFormData } from '@/features/trips/hooks/use-trip-form-data';
import type { ClientOption } from '@/features/trips/hooks/use-trip-form-data';
import { formatClientAddress } from '@/features/clients/lib/format-client-address';
import { createClient } from '@/lib/supabase/client';

type SheetStep = 'select-client' | 'create-rule';

export interface CreateRecurringRuleSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

async function searchClientsForSheet(query: string): Promise<ClientOption[]> {
  // Threshold intentionally lives in ClientAutoSuggest (query.length >= 2) so it is not duplicated here.
  if (!query || query.length < 2) return [];
  const supabase = createClient();
  const { data } = await supabase
    .from('clients')
    .select(
      'id, first_name, last_name, company_name, is_company, phone, phone_secondary, email, street, street_number, zip_code, city, is_wheelchair'
    )
    .or(
      `first_name.ilike.%${query}%,last_name.ilike.%${query}%,company_name.ilike.%${query}%,email.ilike.%${query}%`
    )
    .limit(8);
  return data || [];
}

function clientDisplayName(client: ClientOption): string {
  return client.is_company
    ? client.company_name || ''
    : [client.first_name, client.last_name].filter(Boolean).join(' ') || '—';
}

export function CreateRecurringRuleSheet({
  isOpen,
  onOpenChange,
  onSuccess
}: CreateRecurringRuleSheetProps) {
  const [step, setStep] = React.useState<SheetStep>('select-client');
  const [selectedClient, setSelectedClient] =
    React.useState<ClientOption | null>(null);
  const [homeRole, setHomeRole] = React.useState<'pickup' | 'dropoff'>(
    'pickup'
  );
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const form = useForm<RuleFormValues>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues: getRuleFormDefaults(null)
  });

  const payerWatch = form.watch('payer_id');
  const { payers, billingTypes } = useTripFormData(payerWatch);

  const payerHasNoVariants = !!payerWatch && billingTypes.length === 0;

  // When the Sheet opens, reset step-1 state before paint so we never flash
  // step 2 from a previous session (useLayoutEffect runs before browser paint).
  React.useLayoutEffect(() => {
    if (isOpen) {
      setStep('select-client');
      setSelectedClient(null);
      setHomeRole('pickup');
      // If the sheet was closed mid-submit (or a request hung), never keep the
      // disabled state across re-opens — the user must always be able to try again.
      setIsSubmitting(false);
    }
  }, [isOpen]);

  // Mirror RecurringRuleSheet: clear form whenever the overlay is shown.
  React.useEffect(() => {
    if (isOpen) {
      form.reset(getRuleFormDefaults(null));
    }
  }, [isOpen, form]);

  React.useEffect(() => {
    // If the selected payer has no variants (Unterart), keep a sentinel in the
    // form state so the shared schema does not block submit.
    if (!isOpen) return;
    const current = form.getValues('billing_variant_id');
    if (payerHasNoVariants) {
      if (current !== NO_BILLING_VARIANT_SENTINEL) {
        form.setValue('billing_variant_id', NO_BILLING_VARIANT_SENTINEL, {
          shouldValidate: false,
          shouldDirty: false
        });
      }
      return;
    }

    // If we move back to a payer that *does* have variants, clear the sentinel
    // so the user must pick a real Unterart.
    if (current === NO_BILLING_VARIANT_SENTINEL) {
      form.setValue('billing_variant_id', '', {
        shouldValidate: false,
        shouldDirty: false
      });
    }
  }, [isOpen, payerHasNoVariants, form]);

  const formattedHomeAddress = React.useMemo(
    () => formatClientAddress(selectedClient),
    [selectedClient]
  );

  // After "Weiter", only `setStep('create-rule')` runs in the click handler.
  // `form.reset` belongs here so it runs after React commits the step — safe
  // timing for react-hook-form; re-entry (Zurück → Weiter) also gets a clean form.
  React.useEffect(() => {
    if (isOpen && step === 'create-rule' && selectedClient != null) {
      const defaults = getRuleFormDefaults(null);
      form.reset({
        ...defaults,
        pickup_address:
          homeRole === 'pickup'
            ? formattedHomeAddress
            : defaults.pickup_address,
        dropoff_address:
          homeRole === 'dropoff'
            ? formattedHomeAddress
            : defaults.dropoff_address
      });
    }
  }, [isOpen, step, selectedClient?.id, form, homeRole, formattedHomeAddress]);

  const handleHomeRoleChange = (role: 'pickup' | 'dropoff') => {
    setHomeRole(role);
    if (role === 'pickup') {
      form.setValue('pickup_address', formattedHomeAddress, {
        shouldValidate: true
      });
      form.setValue('dropoff_address', '', { shouldValidate: true });
    } else {
      form.setValue('dropoff_address', formattedHomeAddress, {
        shouldValidate: true
      });
      form.setValue('pickup_address', '', { shouldValidate: true });
    }
  };

  const handleSubmit = async (values: RuleFormValues) => {
    if (!selectedClient) return;

    try {
      setIsSubmitting(true);

      const ruleData = buildRecurringRulePayload(values, {
        clientId: selectedClient.id,
        payers,
        billingTypes
      });

      // If there is no Unterart for this payer, insert NULL (DB column is nullable).
      if (values.billing_variant_id === NO_BILLING_VARIANT_SENTINEL) {
        ruleData.billing_variant_id = null;
      }

      await recurringRulesService.createRule(ruleData);
      toast.success('Regel erfolgreich erstellt');
      onSuccess();
      onOpenChange(false);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);
      toast.error(`Fehler: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const guestDescription =
    selectedClient != null
      ? `Fahrgast: ${clientDisplayName(selectedClient)}`
      : '';

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className='flex w-full flex-col p-0 sm:max-w-md'>
        <SheetHeader className='border-b px-6 py-4'>
          <SheetTitle>Neue Regelfahrt</SheetTitle>
          <SheetDescription>
            {step === 'select-client'
              ? 'Wählen Sie zuerst einen Fahrgast aus.'
              : guestDescription}
          </SheetDescription>
        </SheetHeader>

        {step === 'select-client' ? (
          <>
            <div className='min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pt-4'>
              <ClientAutoSuggest
                placeholder='Fahrgast suchen…'
                widePopover
                value={selectedClient ? clientDisplayName(selectedClient) : ''}
                onNameChange={() => {}}
                onSelect={(client) => setSelectedClient(client)}
                searchClients={searchClientsForSheet}
              />
            </div>

            <div className='flex shrink-0 items-center justify-end gap-2 border-t px-6 py-4'>
              <Button
                type='button'
                variant='outline'
                onClick={() => onOpenChange(false)}
              >
                Abbrechen
              </Button>
              <Button
                type='button'
                disabled={selectedClient == null}
                onClick={() => setStep('create-rule')}
              >
                Weiter
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className='min-h-0 flex-1 overflow-y-auto px-6'>
              <form
                id='create-recurring-rule-from-overview-form'
                onSubmit={form.handleSubmit(
                  handleSubmit,
                  handleRuleFormInvalid
                )}
              >
                <RecurringRuleFormBody
                  form={form}
                  showIsActive={false}
                  addressRoleSelection={{
                    homeRole,
                    formattedHomeAddress,
                    onRoleChange: handleHomeRoleChange
                  }}
                />
              </form>
            </div>

            <div className='flex shrink-0 items-center justify-end gap-2 border-t px-6 py-4'>
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  setIsSubmitting(false);
                  setStep('select-client');
                }}
                disabled={isSubmitting}
              >
                Zurück
              </Button>
              <Button
                type='submit'
                form='create-recurring-rule-from-overview-form'
                disabled={isSubmitting}
              >
                {isSubmitting && (
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                )}
                Hinzufügen
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
