import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet';
import type {
  RecurringRule,
  UpdateRecurringRule
} from '@/features/trips/api/recurring-rules.service';
import {
  countTripsForShorten,
  generationHorizonDays,
  isEndDateShortening,
  runCreateWithGeneration,
  runUpdateWithCleanup
} from '@/features/clients/lib/recurring-rule-submit-flow';
import {
  RecurringRuleFormBody,
  RuleFormValues,
  ruleFormSchema,
  getRuleFormDefaults,
  NO_BILLING_VARIANT_SENTINEL,
  handleRuleFormInvalid
} from './recurring-rule-form-body';
import { useTripFormData } from '@/features/trips/hooks/use-trip-form-data';
import { buildRecurringRulePayload } from '@/features/clients/lib/build-recurring-rule-payload';
import { formatClientAddress } from '@/features/clients/lib/format-client-address';
import type { ClientOption } from '@/features/trips/types/trip-form-reference.types';
import { DeleteRecurringRuleDialog } from '@/features/recurring-rules/components/delete-recurring-rule-dialog';
import { ShortenEndDateDialog } from '@/features/recurring-rules/components/shorten-end-date-dialog';

/**
 * RecurringRuleSheet
 *
 * Slide-over Sheet overlay for creating or editing a recurring trip rule.
 * Used in the classic (non-column) page view — e.g. from /dashboard/clients/[id].
 *
 * The form content is shared with RecurringRulePanel (the column view variant)
 * via the RecurringRuleFormBody component. The external API of this component
 * is intentionally unchanged so that all existing call sites keep working.
 *
 * External API (props) — do not change without updating all consumers:
 *   isOpen        — controls Sheet open state
 *   onOpenChange  — called when Sheet requests close
 *   clientId      — the client this rule belongs to
 *   initialData   — if provided, form renders in edit mode
 *   onSuccess     — called after a successful create or update
 *
 * Sheet and RecurringRulePanel submit the same `ruleData` shape (incl. payer + billing).
 */

interface RecurringRuleSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  initialData?: RecurringRule;
  onSuccess: () => void;
}

export function RecurringRuleSheet({
  isOpen,
  onOpenChange,
  clientId,
  initialData,
  onSuccess
}: RecurringRuleSheetProps) {
  const [client, setClient] = React.useState<ClientOption | null>(null);
  const [homeRole, setHomeRole] = React.useState<'pickup' | 'dropoff'>(
    'pickup'
  );
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);
  const [showShortenDialog, setShowShortenDialog] = React.useState(false);
  const [shortenTripCount, setShortenTripCount] = React.useState(0);
  const [shortenNewEnd, setShortenNewEnd] = React.useState<string | null>(null);
  const [pendingUpdatePayload, setPendingUpdatePayload] =
    React.useState<UpdateRecurringRule | null>(null);

  const form = useForm<RuleFormValues>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues: getRuleFormDefaults(initialData)
  });
  const { reset, setValue, getValues, watch } = form;

  const payerWatch = watch('payer_id');
  const { payers, billingTypes, searchClientsById } =
    useTripFormData(payerWatch);

  const formattedHomeAddress = React.useMemo(
    () => formatClientAddress(client),
    [client]
  );

  const payerHasNoVariants = !!payerWatch && billingTypes.length === 0;

  React.useEffect(() => {
    // If the selected payer has no variants (Unterart), keep a sentinel in the
    // form state so the shared schema does not block submit.
    if (!isOpen) return;
    const current = getValues('billing_variant_id');
    if (payerHasNoVariants) {
      if (current !== NO_BILLING_VARIANT_SENTINEL) {
        setValue('billing_variant_id', NO_BILLING_VARIANT_SENTINEL, {
          shouldValidate: false,
          shouldDirty: false
        });
      }
      return;
    }

    // If we move back to a payer that *does* have variants, clear the sentinel
    // so the user must pick a real Unterart.
    if (current === NO_BILLING_VARIANT_SENTINEL) {
      setValue('billing_variant_id', '', {
        shouldValidate: false,
        shouldDirty: false
      });
    }
  }, [isOpen, payerHasNoVariants, getValues, setValue]);

  // Reset form whenever the sheet opens or the target rule changes
  React.useEffect(() => {
    if (isOpen) {
      // 1. Fetch Client info (for address selection)
      searchClientsById(clientId).then((data) => {
        setClient(data);
      });

      // 2. Fetch Rule info
      setHomeRole('pickup');

      if (!initialData) {
        // Initialize with home address as pickup by default for new rules
        searchClientsById(clientId).then((clientData) => {
          const defaults = getRuleFormDefaults(null);
          reset({
            ...defaults,
            pickup_address:
              formatClientAddress(clientData) || defaults.pickup_address
          });
        });
      } else {
        reset(getRuleFormDefaults(initialData));
      }
    }
  }, [isOpen, initialData, reset, clientId, searchClientsById]);

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

  const finishSuccess = () => {
    onSuccess();
    onOpenChange(false);
  };

  const handleSubmit = async (values: RuleFormValues) => {
    try {
      setIsSubmitting(true);

      const ruleData = buildRecurringRulePayload(values, {
        clientId,
        payers,
        billingTypes
      });

      const payload = { ...ruleData };
      if (values.billing_variant_id === NO_BILLING_VARIANT_SENTINEL) {
        payload.billing_variant_id = null;
      }

      if (initialData) {
        const { isShortening, newEnd } = isEndDateShortening(
          initialData.end_date,
          values.end_date
        );

        if (isShortening && newEnd) {
          const count = await countTripsForShorten(initialData.id, newEnd);
          if (count > 0) {
            setPendingUpdatePayload(payload);
            setShortenNewEnd(newEnd);
            setShortenTripCount(count);
            setShowShortenDialog(true);
            return;
          }
        }

        const { deleted } = await runUpdateWithCleanup(
          initialData.id,
          payload,
          null
        );
        toast.success(
          deleted > 0
            ? `Regel aktualisiert. ${deleted} Fahrten wurden gelöscht.`
            : 'Regel erfolgreich aktualisiert'
        );
        finishSuccess();
      } else {
        const { generated, generationError } =
          await runCreateWithGeneration(payload);

        toast.success(
          `Regel erstellt. ${generated} Fahrten wurden für die nächsten ${generationHorizonDays()} Tage generiert.`
        );
        // WHY non-fatal: rule is persisted; nightly cron recovers if generation fails.
        if (generationError) {
          toast.warning(
            'Fahrten konnten nicht generiert werden — sie erscheinen nach dem nächsten nächtlichen Lauf.'
          );
        }
        finishSuccess();
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unbekannter Fehler';
      toast.error(`Fehler: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleShortenConfirm = async () => {
    if (!initialData || !pendingUpdatePayload || !shortenNewEnd) return;

    try {
      setIsSubmitting(true);
      const { deleted } = await runUpdateWithCleanup(
        initialData.id,
        pendingUpdatePayload,
        shortenNewEnd
      );
      setShowShortenDialog(false);
      setPendingUpdatePayload(null);
      setShortenNewEnd(null);
      toast.success(
        deleted > 0
          ? `Regel aktualisiert. ${deleted} Fahrten wurden gelöscht.`
          : 'Regel erfolgreich aktualisiert'
      );
      finishSuccess();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unbekannter Fehler';
      toast.error(`Fehler: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleShortenCancel = () => {
    setShowShortenDialog(false);
    setPendingUpdatePayload(null);
    setShortenNewEnd(null);
    setShortenTripCount(0);
    setIsSubmitting(false);
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className='flex w-full flex-col p-0 sm:max-w-md'>
        <SheetHeader className='border-b px-6 py-4'>
          <SheetTitle>
            {initialData ? 'Regel bearbeiten' : 'Neue wiederkehrende Fahrt'}
          </SheetTitle>
          <SheetDescription>
            Konfigurieren Sie die Wochentage und Zeiten für diese Regelfahrt.
          </SheetDescription>
        </SheetHeader>

        {/* Scrollable form fields only — footer is outside this scroll area */}
        <div className='min-h-0 flex-1 overflow-y-auto px-6'>
          <form
            id='recurring-rule-sheet-form'
            onSubmit={form.handleSubmit(handleSubmit, handleRuleFormInvalid)}
          >
            <RecurringRuleFormBody
              form={form}
              showIsActive={!!initialData}
              addressRoleSelection={{
                homeRole,
                formattedHomeAddress,
                onRoleChange: handleHomeRoleChange
              }}
            />
          </form>
        </div>

        {/* Fixed footer — never scrolls away */}
        <div className='flex shrink-0 items-center justify-end gap-2 border-t px-6 py-4'>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Abbrechen
          </Button>
          <Button
            type='submit'
            form='recurring-rule-sheet-form'
            disabled={isSubmitting}
          >
            {isSubmitting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {initialData ? 'Speichern' : 'Hinzufügen'}
          </Button>

          {initialData && (
            <Button
              type='button'
              variant='ghost'
              onClick={() => setShowDeleteDialog(true)}
              className='text-destructive hover:bg-destructive/10 hover:text-destructive ml-auto'
              disabled={isSubmitting}
            >
              Löschen
            </Button>
          )}
        </div>

        <DeleteRecurringRuleDialog
          ruleId={initialData?.id || ''}
          isOpen={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          onSuccess={() => {
            onSuccess();
            onOpenChange(false);
          }}
        />

        {initialData && shortenNewEnd && (
          <ShortenEndDateDialog
            newEndDate={shortenNewEnd}
            tripCount={shortenTripCount}
            isOpen={showShortenDialog}
            isConfirming={isSubmitting}
            onOpenChange={setShowShortenDialog}
            onConfirm={handleShortenConfirm}
            onCancel={handleShortenCancel}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
