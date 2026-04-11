/**
 * AbrechnungRecentInvoices
 *
 * Shows the 10 most recently created invoices (sorted by created_at DESC,
 * limit 10 via listInvoices + useInvoices filter).
 *
 * Columns: Nummer | Empfänger | Betrag | Fällig | Status | (actions)
 *
 * Empfänger: Briefkopf — {@link rechnungsempfaenger_snapshot} via
 * recipientFromRechnungsempfaengerSnapshot; fallback payer name if snapshot missing.
 *
 * Status: InvoiceStatusBadge only.
 * Actions: ghost MoreHorizontal DropdownMenu for draft/sent (status transitions);
 * empty for terminal statuses. Same menu pattern as invoice list actions column.
 * Uses useUpdateInvoiceStatus (optimistic list patch + onSettled invalidation).
 *
 * Row click: navigate to /dashboard/invoices/[id]. Actions cell stops propagation.
 */

'use client';

import { addDays, isBefore, parseISO, startOfToday } from 'date-fns';
import { de } from 'date-fns/locale';
import { format } from 'date-fns';
import { MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { useInvoices } from '@/features/invoices/hooks/use-invoices';
import { useUpdateInvoiceStatus } from '@/features/invoices/hooks/use-invoice';
import type { InvoiceStatusTransition } from '@/features/invoices/api/invoices.api';
import type {
  InvoiceWithPayer,
  InvoiceStatus
} from '@/features/invoices/types/invoice.types';
import { InvoiceStatusBadge } from '@/features/invoices/components/invoice-list-table/columns';
import { recipientFromRechnungsempfaengerSnapshot } from '@/features/invoices/components/invoice-pdf/lib/rechnungsempfaenger-pdf';
import { Skeleton } from '@/components/ui/skeleton';

function formatEur(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(value);
}

/** Briefkopf / Rechnungsempfänger as frozen at invoice creation (§14 UStG). */
function invoiceBriefkopfRecipientLabel(inv: InvoiceWithPayer): string {
  const isPerClientBilled = inv.mode === 'per_client' && !!inv.client;
  const snapName = recipientFromRechnungsempfaengerSnapshot(
    inv.rechnungsempfaenger_snapshot
  )?.displayName?.trim();
  if (isPerClientBilled) {
    if (snapName) return snapName;
    return (
      inv.client!.company_name?.trim() ||
      [inv.client!.first_name, inv.client!.last_name]
        .filter(Boolean)
        .join(' ') ||
      '—'
    );
  }
  // monthly / single_trip: snapshot → payer fallback
  return snapName || inv.payer?.name?.trim() || '—';
}

/**
 * Valid next-state transitions for updateInvoiceStatus (draft/sent only).
 */
function getAvailableTransitions(
  status: InvoiceStatus
): { value: InvoiceStatusTransition; label: string }[] {
  switch (status) {
    case 'draft':
      return [{ value: 'sent', label: 'Als versendet markieren' }];
    case 'sent':
      return [
        { value: 'paid', label: 'Als bezahlt markieren' },
        { value: 'cancelled', label: 'Stornieren' }
      ];
    default:
      return [];
  }
}

function InvoiceRecentActionsCell({ invoice }: { invoice: InvoiceWithPayer }) {
  const updateStatus = useUpdateInvoiceStatus(invoice.id);
  const transitions = getAvailableTransitions(invoice.status);

  if (transitions.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className='h-7 w-7'
          disabled={updateStatus.isPending}
        >
          <MoreHorizontal className='h-4 w-4' />
          <span className='sr-only'>Status ändern</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {transitions.map((t) => (
          <DropdownMenuItem
            key={t.value}
            onClick={() => updateStatus.mutate(t.value)}
          >
            {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AbrechnungRecentInvoices() {
  const router = useRouter();
  const { invoices, isLoading } = useInvoices({ limit: 10 });
  const today = startOfToday();

  if (isLoading) {
    return (
      <div className='space-y-2'>
        <Skeleton className='h-8 w-48' />
        <Skeleton className='h-40 w-full' />
      </div>
    );
  }

  const rows = invoices ?? [];

  return (
    <div className='space-y-3'>
      <h3 className='text-muted-foreground text-sm font-medium'>
        Zuletzt erstellte Rechnungen
      </h3>
      <div className='rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nummer</TableHead>
              <TableHead>Empfänger</TableHead>
              <TableHead className='text-right'>Betrag</TableHead>
              <TableHead>Fällig</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className='w-10'>
                <span className='sr-only'>Aktionen</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className='text-muted-foreground h-24 text-center'
                >
                  Keine Rechnungen vorhanden.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((inv) => (
                <RecentInvoiceRow
                  key={inv.id}
                  inv={inv}
                  today={today}
                  onRowClick={() =>
                    router.push(`/dashboard/invoices/${inv.id}`)
                  }
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function RecentInvoiceRow({
  inv,
  today,
  onRowClick
}: {
  inv: InvoiceWithPayer;
  today: Date;
  onRowClick: () => void;
}) {
  const due = addDays(parseISO(inv.created_at), inv.payment_due_days ?? 14);
  const overdue = inv.status === 'sent' && isBefore(due, today);
  const dueLabel = format(due, 'dd.MM.yyyy', { locale: de });

  return (
    <TableRow className='cursor-pointer' onClick={onRowClick}>
      <TableCell className='font-mono text-sm font-medium'>
        {inv.invoice_number}
      </TableCell>
      <TableCell className='max-w-[12rem] truncate text-sm'>
        {invoiceBriefkopfRecipientLabel(inv)}
      </TableCell>
      <TableCell className='text-right font-semibold tabular-nums'>
        {formatEur(inv.total)}
      </TableCell>
      <TableCell
        className='text-sm tabular-nums'
        style={overdue ? { color: 'var(--color-error)' } : undefined}
      >
        {dueLabel}
      </TableCell>
      <TableCell>
        <InvoiceStatusBadge status={inv.status} />
      </TableCell>
      <TableCell className='text-right' onClick={(e) => e.stopPropagation()}>
        <InvoiceRecentActionsCell invoice={inv} />
      </TableCell>
    </TableRow>
  );
}
