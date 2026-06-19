import { cn } from '@/lib/utils';
import type { TripAssignee } from '@/features/trips/lib/trip-assignee';

interface TripAssigneeBadgeProps {
  assignee: TripAssignee;
  className?: string;
  /** Shown on Fremdfirma rows — matches DriverSelectCell tooltip. */
  fremdfirmaTitle?: string;
}

/**
 * Pure display for a resolved TripAssignee — no data fetching.
 * Visual styles mirror DriverSelectCell (Fahrer column) for consistency.
 */
export function TripAssigneeBadge({
  assignee,
  className,
  fremdfirmaTitle = 'Abrechnungsart siehe Spalte „Abrechnung Fremdfirma“'
}: TripAssigneeBadgeProps) {
  if (assignee.kind === 'fremdfirma') {
    return (
      <span
        className={cn(
          'max-w-[11rem] text-center text-xs leading-tight font-medium',
          className
        )}
        title={fremdfirmaTitle}
      >
        Extern · {assignee.label}
      </span>
    );
  }

  if (assignee.kind === 'driver') {
    return (
      <span className={cn('text-xs font-medium', className)}>
        {assignee.label}
      </span>
    );
  }

  return (
    <span className={cn('text-muted-foreground text-xs italic', className)}>
      {assignee.label}
    </span>
  );
}
