'use client';

import { useEffect, useState } from 'react';

/**
 * index.tsx  (invoice-detail)
 *
 * Invoice detail page layout.
 *
 * Layout: two-column on md+
 *   Left (main): Invoice header info + line items table
 *   Right (sidebar): Status badge + action buttons + PDF download
 *
 * Uses the useInvoiceDetail() hook which fetches the full invoice
 * including joined payer, company_profile, and line items.
 */

import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { ArrowLeft, FileDown, Loader2 } from 'lucide-react';
import { PDFDownloadLink } from '@react-pdf/renderer';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';

import { InvoiceActions } from './invoice-actions';
import { InvoicePdfDocument } from '../invoice-pdf/InvoicePdfDocument';
import { generatePaymentQrDataUrl } from '../invoice-pdf/generate-payment-qr-data-url';
import { resolveCompanyAssetUrl } from '@/features/storage/resolve-company-asset-url';
import { useInvoiceDetail } from '../../hooks/use-invoice';
import { formatTaxRate } from '../../lib/tax-calculator';
import type { InvoiceStatus } from '../../types/invoice.types';

const formatEur = (v: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(
    v
  );

const calculateNetAmount = (unitPrice: number, quantity: number) =>
  Math.round(unitPrice * quantity * 100) / 100;

/** Status badge config (mirrors columns.tsx for consistency). */
const STATUS_CONFIG: Record<
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

interface InvoiceDetailViewProps {
  invoiceId: string;
}

/**
 * Full invoice detail view: header, line items table, sidebar with actions.
 */
export function InvoiceDetailView({ invoiceId }: InvoiceDetailViewProps) {
  const router = useRouter();
  const { data: invoice, isLoading, isError } = useInvoiceDetail(invoiceId);
  const [paymentQrDataUrl, setPaymentQrDataUrl] = useState<string | null>(null);
  const [pdfLogoUrl, setPdfLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!invoice) {
      setPaymentQrDataUrl(null);
      setPdfLogoUrl(null);
      return;
    }
    let cancelled = false;
    void generatePaymentQrDataUrl(invoice).then((url) => {
      if (!cancelled) setPaymentQrDataUrl(url);
    });

    void (async () => {
      const logoPath = invoice.company_profile?.logo_path ?? null;
      const legacyUrl = invoice.company_profile?.logo_url ?? null;
      if (!logoPath && !legacyUrl) {
        if (!cancelled) setPdfLogoUrl(null);
        return;
      }

      // Longer TTL so a downloaded PDF can embed the image reliably.
      const resolved = await resolveCompanyAssetUrl({
        path: logoPath,
        url: legacyUrl,
        expiresInSeconds: 60 * 60 * 24
      });
      if (!cancelled) setPdfLogoUrl(resolved);
    })();

    return () => {
      cancelled = true;
    };
  }, [invoice]);

  if (isLoading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-8 w-64' />
        <Skeleton className='h-4 w-48' />
        <Skeleton className='h-64 w-full' />
      </div>
    );
  }

  if (isError || !invoice) {
    return (
      <div className='text-destructive py-12 text-center text-sm'>
        Rechnung konnte nicht geladen werden.
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[invoice.status];
  const pdfInvoice =
    pdfLogoUrl && invoice.company_profile
      ? {
          ...invoice,
          company_profile: {
            ...invoice.company_profile,
            logo_url: pdfLogoUrl
          }
        }
      : invoice;

  return (
    <div className='space-y-6'>
      {/* ── Back + title row ─────────────────────────────────────────────── */}
      <div className='flex items-start justify-between'>
        <div className='flex items-center gap-3'>
          <Button variant='ghost' size='icon' onClick={() => router.back()}>
            <ArrowLeft className='h-4 w-4' />
          </Button>
          <div>
            <h1 className='font-mono text-xl font-bold'>
              {invoice.invoice_number}
            </h1>
            <p className='text-muted-foreground text-sm'>
              Erstellt{' '}
              {format(new Date(invoice.created_at), 'dd. MMMM yyyy', {
                locale: de
              })}
            </p>
          </div>
        </div>
        <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
      </div>

      <div className='grid grid-cols-1 gap-6 lg:grid-cols-3'>
        {/* ── Main: header info + line items ───────────────────────────── */}
        <div className='space-y-6 lg:col-span-2'>
          {/* Sender + recipient addresses */}
          <div className='grid grid-cols-2 gap-6'>
            {/* Company (Rechnungssteller) */}
            <div>
              <p className='text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase'>
                Von
              </p>
              {invoice.company_profile ? (
                <div className='text-sm leading-relaxed'>
                  <p className='font-semibold'>
                    {invoice.company_profile.legal_name}
                  </p>
                  <p>
                    {invoice.company_profile.street}{' '}
                    {invoice.company_profile.street_number}
                  </p>
                  <p>
                    {invoice.company_profile.zip_code}{' '}
                    {invoice.company_profile.city}
                  </p>
                </div>
              ) : (
                <p className='text-muted-foreground text-sm'>—</p>
              )}
            </div>

            {/* Payer (Rechnungsempfänger) */}
            <div>
              <p className='text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase'>
                An
              </p>
              {invoice.payer ? (
                <div className='text-sm leading-relaxed'>
                  <p className='font-semibold'>{invoice.payer.name}</p>
                  {invoice.payer.street && (
                    <p>
                      {invoice.payer.street} {invoice.payer.street_number}
                    </p>
                  )}
                  {invoice.payer.zip_code && (
                    <p>
                      {invoice.payer.zip_code} {invoice.payer.city}
                    </p>
                  )}
                </div>
              ) : (
                <p className='text-muted-foreground text-sm'>—</p>
              )}
            </div>
          </div>

          {/* Invoice meta: period + payment days */}
          <div className='bg-muted/40 grid grid-cols-3 gap-4 rounded-lg px-4 py-3 text-sm'>
            <div>
              <p className='text-muted-foreground text-xs'>Zeitraum</p>
              <p className='font-medium'>
                {format(new Date(invoice.period_from), 'dd.MM.yy', {
                  locale: de
                })}{' '}
                –{' '}
                {format(new Date(invoice.period_to), 'dd.MM.yy', {
                  locale: de
                })}
              </p>
            </div>
            <div>
              <p className='text-muted-foreground text-xs'>Zahlungsziel</p>
              <p className='font-medium'>{invoice.payment_due_days} Tage</p>
            </div>
            <div>
              <p className='text-muted-foreground text-xs'>Fällig am</p>
              <p className='font-medium'>
                {format(
                  new Date(
                    new Date(invoice.created_at).getTime() +
                      invoice.payment_due_days * 86400000
                  ),
                  'dd.MM.yyyy',
                  { locale: de }
                )}
              </p>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <div className='text-sm'>
              <p className='text-muted-foreground mb-1 text-xs font-semibold uppercase'>
                Notizen
              </p>
              <p className='whitespace-pre-line'>{invoice.notes}</p>
            </div>
          )}

          <Separator />

          {/* Line items table */}
          <div className='rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-8'>#</TableHead>
                  <TableHead>Beschreibung</TableHead>
                  <TableHead>km</TableHead>
                  <TableHead>MwSt</TableHead>
                  <TableHead className='text-right'>Betrag</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.line_items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className='text-muted-foreground text-xs'>
                      {item.position}
                    </TableCell>
                    <TableCell>
                      <div className='text-sm'>{item.description}</div>
                      {item.billing_variant_name && (
                        <div className='text-muted-foreground text-xs'>
                          {item.billing_variant_name}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className='text-sm'>
                      {item.distance_km !== null
                        ? `${item.distance_km.toFixed(1)}`
                        : '—'}
                    </TableCell>
                    <TableCell className='text-sm'>
                      {formatTaxRate(item.tax_rate)}
                    </TableCell>
                    <TableCell className='text-right text-sm font-medium'>
                      {formatEur(
                        calculateNetAmount(item.unit_price, item.quantity)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className='text-sm'>
                    Netto
                  </TableCell>
                  <TableCell className='text-right text-sm'>
                    {formatEur(invoice.subtotal)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className='text-muted-foreground text-sm'
                  >
                    MwSt
                  </TableCell>
                  <TableCell className='text-muted-foreground text-right text-sm'>
                    {formatEur(invoice.tax_amount)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={4} className='font-bold'>
                    Brutto
                  </TableCell>
                  <TableCell className='text-right font-bold'>
                    {formatEur(invoice.total)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </div>

        {/* ── Sidebar: status + actions ─────────────────────────────────── */}
        <div className='space-y-4'>
          {/* Invoice totals summary card */}
          <div className='bg-card border-border space-y-3 rounded-xl border p-4'>
            <p className='text-muted-foreground text-xs font-semibold tracking-wide uppercase'>
              Gesamtbetrag
            </p>
            <p className='text-3xl font-bold'>{formatEur(invoice.total)}</p>
            <Separator />
            <div className='space-y-1 text-sm'>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Netto</span>
                <span>{formatEur(invoice.subtotal)}</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>MwSt</span>
                <span>{formatEur(invoice.tax_amount)}</span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <InvoiceActions invoice={invoice} />

          {/* PDF download */}
          <PDFDownloadLink
            document={
              <InvoicePdfDocument
                invoice={pdfInvoice}
                paymentQrDataUrl={paymentQrDataUrl}
              />
            }
            fileName={`${invoice.invoice_number}.pdf`}
          >
            {({ loading }) => (
              <Button
                variant='outline'
                className='w-full gap-2'
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <FileDown className='h-4 w-4' />
                )}
                PDF herunterladen
              </Button>
            )}
          </PDFDownloadLink>
        </div>
      </div>
    </div>
  );
}
