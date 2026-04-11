'use client';

/**
 * columns.tsx
 *
 * TanStack Table column definitions for the invoice list table.
 *
 * Columns:
 *   Invoice number | Payer | Period | Mode | Status badge | Total | Actions
 *
 * Status badge styling uses theme tokens only (no hardcoded colors).
 * For status-to-color mapping, open src/lib/trip-status.ts as a reference.
 */

import { type ColumnDef } from '@tanstack/react-table';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { MoreHorizontal, Eye, FileDown, FileText } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { formatClientNumber, formatPayerNumber } from '@/lib/customer-number';
import type {
  InvoiceWithPayer,
  InvoiceStatus,
  InvoiceMode
} from '../../types/invoice.types';

// ─── Status badge ─────────────────────────────────────────────────────────────

/** Maps invoice status to a shadcn Badge variant + German label. */
export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const config: Record<
    InvoiceStatus,
    {
      variant: 'default' | 'secondary' | 'destructive' | 'outline';
      label: string;
    }
  > = {
    draft: { variant: 'secondary', label: 'Entwurf' },
    sent: { variant: 'outline', label: 'Versendet' },
    paid: { variant: 'default', label: 'Bezahlt' },
    cancelled: { variant: 'destructive', label: 'Storniert' },
    corrected: { variant: 'destructive', label: 'Korrigiert' }
  };

  const { variant, label } = config[status] ?? {
    variant: 'secondary',
    label: status
  };
  return <Badge variant={variant}>{label}</Badge>;
}

/** Maps invoice mode to a human-readable German label. */
function formatMode(mode: InvoiceMode): string {
  const labels: Record<InvoiceMode, string> = {
    monthly: 'Monatlich',
    single_trip: 'Einzelfahrt',
    per_client: 'Fahrgast'
  };
  return labels[mode] ?? mode;
}

// ─── Column definitions ───────────────────────────────────────────────────────

/**
 * Creates the column definitions for the invoice list table.
 *
 * @param onView      - Called when the user clicks "Ansehen" on a row.
 * @param onPreview   - Opens PDF preview for the invoice (new tab).
 * @param onDownload  - Called when the user clicks "PDF herunterladen".
 */
export function createInvoiceColumns({
  onView,
  onPreview,
  onDownload
}: {
  onView: (id: string) => void;
  onPreview: (id: string) => void;
  onDownload: (id: string) => void;
}): ColumnDef<InvoiceWithPayer>[] {
  return [
    {
      accessorKey: 'invoice_number',
      header: 'Rechnungsnr.',
      cell: ({ row }) => (
        <span className='font-mono text-sm font-medium'>
          {row.original.invoice_number}
        </span>
      )
    },
    {
      id: 'client_name',
      header: 'Fahrgast',
      cell: ({ row }) => {
        const client = row.original.client;
        const clientName = client
          ? [client.first_name, client.last_name].filter(Boolean).join(' ')
          : '—';
        return (
          <div>
            <div className='text-sm font-medium'>{clientName}</div>
            {client?.customer_number && (
              <div className='text-muted-foreground text-xs'>
                {formatClientNumber(client.customer_number)}
              </div>
            )}
          </div>
        );
      }
    },
    {
      // Payer is a joined object from the API
      id: 'payer_name',
      header: 'Kostenträger',
      cell: ({ row }) => (
        <div>
          <div className='text-sm font-medium'>
            {row.original.payer?.name ?? '—'}
          </div>
          {row.original.payer?.number && (
            <div className='text-muted-foreground text-xs'>
              {formatPayerNumber(row.original.payer.number)}
            </div>
          )}
        </div>
      )
    },
    {
      id: 'period',
      header: 'Zeitraum',
      cell: ({ row }) => {
        const from = format(new Date(row.original.period_from), 'dd.MM.yy', {
          locale: de
        });
        const to = format(new Date(row.original.period_to), 'dd.MM.yy', {
          locale: de
        });
        return (
          <span className='text-muted-foreground text-sm'>
            {from} – {to}
          </span>
        );
      }
    },
    {
      accessorKey: 'mode',
      header: 'Typ',
      cell: ({ row }) => (
        <Badge variant='outline' className='text-xs font-normal'>
          {formatMode(row.original.mode)}
        </Badge>
      )
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <InvoiceStatusBadge status={row.original.status} />
    },
    {
      accessorKey: 'total',
      header: 'Betrag',
      cell: ({ row }) => (
        <span className='font-semibold tabular-nums'>
          {new Intl.NumberFormat('de-DE', {
            style: 'currency',
            currency: 'EUR'
          }).format(row.original.total)}
        </span>
      )
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='icon' className='h-7 w-7'>
              <MoreHorizontal className='h-4 w-4' />
              <span className='sr-only'>Aktionen</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onClick={() => onView(row.original.id)}>
              <Eye className='mr-2 h-4 w-4' />
              Ansehen
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onPreview(row.original.id)}>
              <FileText className='mr-2 h-4 w-4' />
              PDF-Vorschau
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDownload(row.original.id)}>
              <FileDown className='mr-2 h-4 w-4' />
              PDF herunterladen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
  ];
}
