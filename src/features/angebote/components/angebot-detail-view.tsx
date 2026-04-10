'use client';

/**
 * AngebotDetailView
 *
 * Angebot detail page layout.
 *
 * Layout: two-column on md+
 *   Left:  Offer header info + line items table
 *   Right: Status badge + action buttons + PDF download
 *
 * Status transitions allowed from this page:
 *   draft     → sent       ("Als gesendet markieren")
 *   sent      → accepted   ("Angenommen")
 *   sent      → declined   ("Abgelehnt")
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { ArrowLeft, FileDown, Loader2, Pencil } from 'lucide-react';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { resolveCompanyAssetUrl } from '@/features/storage/resolve-company-asset-url';
import { createClient } from '@/lib/supabase/client';
import { angebotKeys } from '@/query/keys';
import type { InvoiceDetail } from '@/features/invoices/types/invoice.types';

import { useAngebotDetail } from '../hooks/use-angebote';
import { updateAngebotStatus } from '../api/angebote.api';
import { AngebotPdfDocument } from './angebot-pdf/AngebotPdfDocument';
import type {
  AngebotStatus,
  AngebotWithLineItems
} from '../types/angebot.types';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<AngebotStatus, string> = {
  draft: 'Entwurf',
  sent: 'Gesendet',
  accepted: 'Angenommen',
  declined: 'Abgelehnt'
};

const STATUS_CLASSES: Record<AngebotStatus, string> = {
  draft:
    'border-gray-200 bg-gray-100 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  sent: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  accepted:
    'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300',
  declined:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300'
};

const formatDate = (isoDate: string | null | undefined): string => {
  if (!isoDate) return '—';
  try {
    return format(new Date(isoDate), 'dd. MMMM yyyy', { locale: de });
  } catch {
    return isoDate;
  }
};

const formatEur = (v: number | null | undefined) => {
  if (v == null) return '—';
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(v);
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface AngebotDetailViewProps {
  angebotId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AngebotDetailView({ angebotId }: AngebotDetailViewProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: angebot, isLoading, isError } = useAngebotDetail(angebotId);

  // Company profile needed for PDF generation
  const [companyProfile, setCompanyProfile] = useState<
    InvoiceDetail['company_profile'] | null
  >(null);
  const [pdfLogoUrl, setPdfLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!angebot) return;
    const supabase = createClient();
    void supabase
      .from('company_profiles')
      .select(
        `legal_name, street, street_number, zip_code, city,
         tax_id, vat_id, bank_name, bank_iban, bank_bic,
         logo_path, logo_url, slogan, phone, inhaber, email, website,
         default_payment_days`
      )
      .eq('company_id', angebot.company_id)
      .single()
      .then(({ data }) => {
        setCompanyProfile(data ?? null);
      });
  }, [angebot?.company_id]);

  useEffect(() => {
    if (!companyProfile) {
      setPdfLogoUrl(null);
      return;
    }
    let cancelled = false;
    void resolveCompanyAssetUrl({
      path: companyProfile.logo_path ?? null,
      url: companyProfile.logo_url ?? null,
      expiresInSeconds: 3600
    }).then((url) => {
      if (!cancelled) setPdfLogoUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [companyProfile?.logo_path, companyProfile?.logo_url]);

  const companyProfileForPdf = companyProfile
    ? pdfLogoUrl
      ? { ...companyProfile, logo_url: pdfLogoUrl }
      : companyProfile
    : null;

  // ─── Status mutation ──────────────────────────────────────────────────────

  const { mutate: changeStatus, isPending: isChangingStatus } = useMutation({
    mutationFn: ({ status }: { status: AngebotStatus }) =>
      updateAngebotStatus(angebotId, status),
    onSuccess: (updated) => {
      queryClient.setQueryData(
        angebotKeys.detail(angebotId),
        (old: AngebotWithLineItems | undefined) =>
          old ? { ...old, status: updated.status } : old
      );
      queryClient.invalidateQueries({ queryKey: angebotKeys.list() });
      toast.success(`Status geändert: ${STATUS_LABELS[updated.status]}`);
    },
    onError: () => {
      toast.error('Status konnte nicht geändert werden.');
    }
  });

  // ─── Loading / error states ───────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-8 w-48' />
        <Skeleton className='h-48 w-full' />
        <Skeleton className='h-48 w-full' />
      </div>
    );
  }

  if (isError || !angebot) {
    return (
      <p className='text-destructive text-sm'>
        Angebot konnte nicht geladen werden.
      </p>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const contactDisplayName = angebot.recipient_last_name
    ? [
        angebot.recipient_anrede,
        angebot.recipient_first_name,
        angebot.recipient_last_name
      ]
        .filter(Boolean)
        .join(' ')
        .trim()
    : (angebot.recipient_name ?? '').trim();

  const recipientLines = [
    angebot.recipient_company,
    contactDisplayName || null,
    [angebot.recipient_street, angebot.recipient_street_number]
      .filter(Boolean)
      .join(' '),
    [angebot.recipient_zip, angebot.recipient_city].filter(Boolean).join(' ')
  ].filter(Boolean);

  return (
    <div className='space-y-6'>
      {/* Back + title */}
      <div className='flex items-center gap-4'>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => router.push('/dashboard/angebote')}
        >
          <ArrowLeft className='mr-1.5 h-4 w-4' />
          Alle Angebote
        </Button>
        <h1 className='text-2xl font-bold tracking-tight'>
          {angebot.angebot_number}
        </h1>
        <Badge
          variant='outline'
          className={cn('text-xs', STATUS_CLASSES[angebot.status])}
        >
          {STATUS_LABELS[angebot.status]}
        </Badge>
      </div>

      <div className='grid grid-cols-1 gap-6 md:grid-cols-3'>
        {/* ── Main content ──────────────────────────────────────────────── */}
        <div className='space-y-6 md:col-span-2'>
          {/* Offer meta */}
          <div className='border-border rounded-xl border p-6'>
            <h2 className='mb-4 text-sm font-semibold'>Angebotsdaten</h2>
            <dl className='grid grid-cols-2 gap-3 text-sm'>
              <div>
                <dt className='text-muted-foreground'>Angebotsdatum</dt>
                <dd className='font-medium'>
                  {formatDate(angebot.offer_date)}
                </dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>Gültig bis</dt>
                <dd className='font-medium'>
                  {formatDate(angebot.valid_until)}
                </dd>
              </div>
              {angebot.subject ? (
                <div className='col-span-2'>
                  <dt className='text-muted-foreground'>Betreff</dt>
                  <dd className='font-medium'>{angebot.subject}</dd>
                </div>
              ) : null}
              {angebot.customer_number ? (
                <div>
                  <dt className='text-muted-foreground'>Kundennummer</dt>
                  <dd className='font-medium'>{angebot.customer_number}</dd>
                </div>
              ) : null}
            </dl>
          </div>

          {/* Recipient */}
          {recipientLines.length > 0 ? (
            <div className='border-border rounded-xl border p-6'>
              <h2 className='mb-3 text-sm font-semibold'>Empfänger</h2>
              <address className='not-italic'>
                {recipientLines.map((line, i) => (
                  <p key={i} className='text-sm leading-6'>
                    {line}
                  </p>
                ))}
              </address>
              {angebot.recipient_email ? (
                <p className='text-muted-foreground mt-2 text-sm'>
                  {angebot.recipient_email}
                </p>
              ) : null}
              {angebot.recipient_phone ? (
                <p className='text-muted-foreground text-sm'>
                  {angebot.recipient_phone}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Line items */}
          {angebot.line_items.length > 0 ? (
            <div className='border-border overflow-hidden rounded-xl border'>
              <table className='w-full text-sm'>
                <thead className='bg-muted/50'>
                  <tr>
                    <th className='p-3 text-left font-medium'>Pos.</th>
                    <th className='p-3 text-left font-medium'>Leistung</th>
                    <th className='p-3 text-right font-medium'>
                      Anfahrtkosten
                    </th>
                    <th className='p-3 text-right font-medium'>
                      erste 5 km (je km)
                    </th>
                    <th className='p-3 text-right font-medium'>
                      ab 5 km (je km)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {angebot.line_items.map((item, idx) => (
                    <tr
                      key={item.id}
                      className={cn(
                        'border-border border-t',
                        idx % 2 === 1 && 'bg-muted/20'
                      )}
                    >
                      <td className='p-3 text-center'>{item.position}</td>
                      <td className='p-3'>{item.leistung || '—'}</td>
                      <td className='p-3 text-right'>
                        {formatEur(item.anfahrtkosten)}
                      </td>
                      <td className='p-3 text-right'>
                        {item.price_first_5km != null
                          ? `${item.price_first_5km.toFixed(2).replace('.', ',')} €/km`
                          : '—'}
                      </td>
                      <td className='p-3 text-right'>
                        {item.price_per_km_after_5 != null
                          ? `${item.price_per_km_after_5.toFixed(2).replace('.', ',')} €/km`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {/* ── Sidebar ───────────────────────────────────────────────────── */}
        <div className='space-y-4'>
          {/* Status actions */}
          <div className='border-border rounded-xl border p-4'>
            <h2 className='mb-3 text-sm font-semibold'>Aktionen</h2>
            <div className='space-y-2'>
              <Button className='w-full' variant='outline' size='sm' asChild>
                <Link href={`/dashboard/angebote/${angebotId}/edit`}>
                  <Pencil className='mr-2 h-4 w-4' />
                  Bearbeiten
                </Link>
              </Button>
              {angebot.status === 'draft' ? (
                <Button
                  className='w-full'
                  variant='outline'
                  size='sm'
                  disabled={isChangingStatus}
                  onClick={() => changeStatus({ status: 'sent' })}
                >
                  {isChangingStatus ? (
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  ) : null}
                  Als gesendet markieren
                </Button>
              ) : null}
              {angebot.status === 'sent' ? (
                <>
                  <Button
                    className='w-full'
                    variant='outline'
                    size='sm'
                    disabled={isChangingStatus}
                    onClick={() => changeStatus({ status: 'accepted' })}
                  >
                    {isChangingStatus ? (
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    ) : null}
                    Angenommen
                  </Button>
                  <Button
                    className='w-full'
                    variant='outline'
                    size='sm'
                    disabled={isChangingStatus}
                    onClick={() => changeStatus({ status: 'declined' })}
                  >
                    {isChangingStatus ? (
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    ) : null}
                    Abgelehnt
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          {/* PDF download */}
          {companyProfileForPdf ? (
            <div className='border-border rounded-xl border p-4'>
              <h2 className='mb-3 text-sm font-semibold'>PDF</h2>
              <PDFDownloadLink
                document={
                  <AngebotPdfDocument
                    angebot={angebot}
                    companyProfile={companyProfileForPdf}
                  />
                }
                fileName={`${angebot.angebot_number}.pdf`}
              >
                {({ loading }) => (
                  <Button
                    variant='outline'
                    size='sm'
                    className='w-full'
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    ) : (
                      <FileDown className='mr-2 h-4 w-4' />
                    )}
                    PDF herunterladen
                  </Button>
                )}
              </PDFDownloadLink>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
