'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { PlanStatusBadge } from '@/features/driver-planning/components/plan-status-badge';
import {
  PLAN_STATUSES,
  type PlanStatus
} from '@/features/driver-planning/types';
import { parseYmdToLocalDate } from '@/lib/date-ymd';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { toast } from 'sonner';
import { useCompleteReconciliation, useReopenReconciliation } from '../hooks';
import {
  RECONCILIATION_STATUS,
  isShiftTimeIncomplete,
  type ShiftDaySummary
} from '../types';
import { ShiftDetailPanel } from './shift-detail-panel';
import { ShiftFahrtenRow } from './shift-fahrten-row';
import { ShiftIstZeitRow } from './shift-ist-zeit-row';

type ShiftDayRowProps = {
  summary: ShiftDaySummary;
  driverId: string;
  driverName: string;
  showIstZeit: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onIstZeitSaved: () => void;
};

function formatDayHeading(dateYmd: string): string {
  const d = parseYmdToLocalDate(dateYmd);
  if (!d) return dateYmd;
  return format(d, 'EEE, dd.MM.yyyy', { locale: de });
}

function isValidPlanStatus(value: string | null): value is PlanStatus {
  return value != null && value in PLAN_STATUSES;
}

export function ShiftDayRow({
  summary,
  driverId,
  driverName,
  showIstZeit,
  isExpanded,
  onToggleExpand,
  onIstZeitSaved
}: ShiftDayRowProps) {
  const completeMutation = useCompleteReconciliation(driverId, summary.date);
  const reopenMutation = useReopenReconciliation(driverId, summary.date);

  const isCompleted =
    summary.reconciliation_status === RECONCILIATION_STATUS.COMPLETED;
  const isOpen = summary.reconciliation_status === RECONCILIATION_STATUS.OPEN;
  const isPlanOnly = summary.day_type === 'plan_only';
  // WHY plan_only branch: Urlaub/Krank days have no reconciliation action —
  // nothing to verify or complete.
  const incompleteShift = isShiftTimeIncomplete(summary);

  const handleComplete = () => {
    void completeMutation.mutateAsync(
      { driverId, date: summary.date },
      {
        onSuccess: (result) => {
          if (!result.success) {
            toast.error(
              result.message ?? 'Schicht konnte nicht abgeschlossen werden.'
            );
          } else {
            toast.success('Schicht abgeschlossen.');
            onIstZeitSaved();
          }
        }
      }
    );
  };

  const handleReopen = () => {
    void reopenMutation.mutateAsync(undefined, {
      onSuccess: (result) => {
        if (!result.success) {
          toast.error('Schicht konnte nicht wieder geöffnet werden.');
        } else {
          toast.success('Schicht wieder geöffnet.');
          onIstZeitSaved();
        }
      }
    });
  };

  const handleDetailComplete = () => {
    onIstZeitSaved();
  };

  const statusBadge = (() => {
    if (isPlanOnly && isValidPlanStatus(summary.plan_status)) {
      return <PlanStatusBadge status={summary.plan_status} />;
    }
    if (isCompleted) {
      return (
        <Badge
          className='border-green-200 bg-green-100 text-green-800 dark:border-green-800 dark:bg-green-950/50 dark:text-green-200'
          variant='outline'
        >
          Abgeschlossen
        </Badge>
      );
    }
    if (isOpen) {
      return (
        <Badge
          variant='secondary'
          className='border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
        >
          In Bearbeitung
        </Badge>
      );
    }
    return (
      <Badge variant='secondary' className='text-muted-foreground'>
        Nicht geprüft
      </Badge>
    );
  })();

  return (
    <div className='bg-card text-card-foreground border-border overflow-hidden rounded-md border shadow-sm'>
      <div className='flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4'>
        <div className='min-w-0 shrink font-medium sm:w-44'>
          {formatDayHeading(summary.date)}
        </div>
        <div className='flex flex-1 justify-center'>{statusBadge}</div>
        <div className='ml-auto flex shrink-0 items-center gap-2'>
          {!isPlanOnly &&
            (isCompleted ? (
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={handleReopen}
                disabled={reopenMutation.isPending}
              >
                Erneut öffnen
              </Button>
            ) : (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className='inline-flex'>
                      <Button
                        type='button'
                        size='sm'
                        onClick={handleComplete}
                        disabled={incompleteShift || completeMutation.isPending}
                      >
                        Abschließen
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {incompleteShift && (
                    <TooltipContent>Beginn oder Ende fehlt.</TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            ))}
        </div>
      </div>

      {!isPlanOnly && (
        <div
          className={cn(
            'border-border space-y-0 border-t px-3 sm:px-4',
            'divide-border divide-y'
          )}
        >
          <ShiftIstZeitRow
            driverId={driverId}
            date={summary.date}
            startedAt={summary.shift_started_at}
            endedAt={summary.shift_ended_at}
            breakMinutes={summary.shift_break_minutes}
            totalRevenue={summary.total_revenue}
            showIstZeit={showIstZeit}
            onSaved={onIstZeitSaved}
          />
          <ShiftFahrtenRow
            dayType={summary.day_type}
            totalTrips={summary.total_trips}
            selbstzahlerCount={summary.selbstzahler_count}
            rechnungCount={summary.rechnung_count}
            totalRevenue={summary.total_revenue}
            isExpanded={isExpanded}
            onToggleExpand={onToggleExpand}
          />
          {/* Phase B: <ShiftFahrtenbuchRow /> — vehicle_shift_logs row goes here.
              Do not remove this comment until Phase B is built. */}

          <div
            className={cn(
              'overflow-hidden transition-[max-height,opacity] duration-200 ease-out motion-reduce:transition-none',
              isExpanded ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'
            )}
            aria-hidden={!isExpanded}
          >
            {isExpanded && (
              <div className='border-border border-t px-0 py-4 sm:px-1'>
                <ShiftDetailPanel
                  driverId={driverId}
                  dateYmd={summary.date}
                  driverName={driverName}
                  enabled
                  onAfterComplete={handleDetailComplete}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
