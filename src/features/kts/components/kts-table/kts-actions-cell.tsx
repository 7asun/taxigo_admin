'use client';

import { useState, type ComponentType } from 'react';
import { AlertCircle, Check, Loader2, RotateCcw, Send, X } from 'lucide-react';

import { Icons } from '@/components/icons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import {
  useClearKtsMistakeMutation,
  useCreateKtsHandoverMutation,
  useMarkKtsCheckedMutation,
  useReceiveKtsCorrectionMutation
} from '@/features/kts/hooks/use-kts-status';
import type { KtsTripRow } from '@/features/kts/types/kts-trip-row';
import { getOpenKtsCorrection } from '@/features/kts/types/kts-trip-row';
import type { KtsStatus } from '@/features/kts/kts.service';

export type KtsExpandState = { id: string; mode: 'fehler' | 'send' } | null;

export interface KtsActionsCellProps {
  trip: KtsTripRow;
  expandedRow: KtsExpandState;
  setExpandedRow: (val: KtsExpandState) => void;
}

export function KtsActionsCell({
  trip,
  expandedRow,
  setExpandedRow
}: KtsActionsCellProps) {
  const checkedMutation = useMarkKtsCheckedMutation();
  const clearMutation = useClearKtsMistakeMutation();
  const receiveMutation = useReceiveKtsCorrectionMutation();
  const handoverMutation = useCreateKtsHandoverMutation();
  const [handoverDialogOpen, setHandoverDialogOpen] = useState(false);
  const [handoverError, setHandoverError] = useState<string | null>(null);

  const status = trip.kts_status as KtsStatus | null;
  const openRound = getOpenKtsCorrection(trip);
  const isExpanded = expandedRow?.id === trip.id;

  const anyPending =
    checkedMutation.isPending ||
    clearMutation.isPending ||
    receiveMutation.isPending ||
    handoverMutation.isPending;

  const toggleExpand = (mode: 'fehler' | 'send') => {
    if (isExpanded && expandedRow?.mode === mode) {
      setExpandedRow(null);
    } else {
      setExpandedRow({ id: trip.id, mode });
    }
  };

  if (
    status === 'uebergeben' ||
    status === 'abgerechnet' ||
    status === 'ruecklaufer' ||
    status === 'bezahlt'
  ) {
    return <span className='text-muted-foreground text-xs'>—</span>;
  }

  if (status === 'ungeprueft') {
    return (
      <ActionButtons
        disabled={anyPending}
        primary={{
          label: 'Korrekt',
          icon: Check,
          pending: checkedMutation.isPending,
          onClick: () => {
            void checkedMutation.mutateAsync({ tripId: trip.id });
          }
        }}
        secondary={{
          label: 'Fehler melden',
          icon: X,
          onClick: () => toggleExpand('fehler')
        }}
      />
    );
  }

  if (status === 'fehlerhaft') {
    return (
      <ActionButtons
        disabled={anyPending}
        primary={{
          label: 'An Aussteller senden',
          icon: Send,
          onClick: () => toggleExpand('send')
        }}
        secondary={{
          label: 'Fehler aufheben',
          icon: RotateCcw,
          pending: clearMutation.isPending,
          onClick: () => {
            void clearMutation.mutateAsync({ tripId: trip.id });
          }
        }}
      />
    );
  }

  if (status === 'in_korrektur') {
    // why: receiveKtsCorrection requires correctionId — never call without open round id from RSC embed.
    const canReceive = Boolean(openRound?.id);
    return (
      <ActionButtons
        disabled={anyPending || !canReceive}
        primary={{
          label: 'Erhalten',
          icon: Check,
          pending: receiveMutation.isPending,
          disabled: !canReceive,
          tooltip: canReceive ? undefined : 'Keine offene Korrektur',
          onClick: () => {
            if (!openRound?.id) return;
            void receiveMutation.mutateAsync({
              tripId: trip.id,
              correctionId: openRound.id
            });
          }
        }}
      />
    );
  }

  if (status === 'korrekt') {
    return (
      <>
        <ActionButtons
          disabled={anyPending}
          primary={{
            label: 'Übergeben',
            icon: Icons.post,
            onClick: () => {
              setHandoverError(null);
              setHandoverDialogOpen(true);
            }
          }}
          secondary={{
            label: 'Erneut öffnen',
            icon: AlertCircle,
            onClick: () => toggleExpand('fehler')
          }}
        />

        <AlertDialog
          open={handoverDialogOpen}
          onOpenChange={(open) => {
            setHandoverDialogOpen(open);
            if (open) setHandoverError(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Übergabe bestätigen</AlertDialogTitle>
              <AlertDialogDescription>
                Diese Fahrt wird an die Buchhaltung übergeben. Die Aktion kann
                nicht rückgängig gemacht werden.
              </AlertDialogDescription>
            </AlertDialogHeader>

            {handoverError ? (
              <p className='text-destructive px-1 text-sm'>{handoverError}</p>
            ) : null}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={handoverMutation.isPending}>
                Abbrechen
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={handoverMutation.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  setHandoverError(null);
                  void handoverMutation
                    .mutateAsync({ tripIds: [trip.id] })
                    .then(() => {
                      setHandoverDialogOpen(false);
                    })
                    .catch((err: unknown) => {
                      setHandoverError(
                        err instanceof Error
                          ? err.message
                          : 'Übergabe fehlgeschlagen.'
                      );
                    });
                }}
              >
                {handoverMutation.isPending ? (
                  <Icons.spinner className='mr-2 h-4 w-4 animate-spin' />
                ) : null}
                Übergabe bestätigen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return null;
}

interface ActionConfig {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
  pending?: boolean;
  disabled?: boolean;
  tooltip?: string;
}

function ActionButtons({
  primary,
  secondary,
  disabled
}: {
  primary?: ActionConfig;
  secondary?: ActionConfig;
  disabled?: boolean;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className='flex flex-wrap items-center gap-1'>
        {primary ? <ActionButton config={primary} disabled={disabled} /> : null}
        {secondary ? (
          <ActionButton config={secondary} disabled={disabled} />
        ) : null}
      </div>
    </TooltipProvider>
  );
}

function ActionButton({
  config,
  disabled: groupDisabled
}: {
  config: ActionConfig;
  disabled?: boolean;
}) {
  const Icon = config.icon;
  const isDisabled = groupDisabled || config.disabled || config.pending;

  const button = (
    <Button
      type='button'
      variant='ghost'
      size='sm'
      className='h-8 gap-1 px-2 text-xs'
      disabled={isDisabled}
      onClick={config.onClick}
    >
      {config.pending ? (
        <Loader2 className='h-3.5 w-3.5 animate-spin' />
      ) : (
        <Icon className='h-3.5 w-3.5' />
      )}
      <span className='hidden sm:inline'>{config.label}</span>
    </Button>
  );

  if (config.tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{button}</span>
        </TooltipTrigger>
        <TooltipContent>{config.tooltip}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{config.label}</TooltipContent>
    </Tooltip>
  );
}
