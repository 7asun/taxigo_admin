'use client';

import { useState, useEffect } from 'react';
import { Copy, Check, Mail } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { generateInvoiceEmailDraft } from '../../lib/generate-invoice-email-draft';
import { useSaveInvoiceEmailDraft } from '../../hooks/use-save-invoice-email-draft';
import type { InvoiceDetail } from '../../types/invoice.types';

interface InvoiceEmailDraftProps {
  invoice: InvoiceDetail;
}

type CopyState = 'idle' | 'copied';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setState('copied');
    setTimeout(() => setState('idle'), 2000);
  };
  return (
    <Button
      variant='ghost'
      size='sm'
      onClick={copy}
      className='h-7 gap-1.5 text-xs'
    >
      {state === 'copied' ? (
        <Check className='h-3.5 w-3.5' />
      ) : (
        <Copy className='h-3.5 w-3.5' />
      )}
      {state === 'copied' ? 'Kopiert' : label}
    </Button>
  );
}

export function InvoiceEmailDraft({ invoice }: InvoiceEmailDraftProps) {
  const save = useSaveInvoiceEmailDraft(invoice.id);

  const initial = (() => {
    if (invoice.email_subject || invoice.email_body) {
      return {
        subject: invoice.email_subject ?? '',
        body: invoice.email_body ?? ''
      };
    }
    const generated = generateInvoiceEmailDraft(invoice);
    return { subject: generated.subject, body: generated.body };
  })();

  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (invoice.email_subject) setSubject(invoice.email_subject);
    if (invoice.email_body) setBody(invoice.email_body);
  }, [invoice.email_subject, invoice.email_body]);

  const handleSave = () => {
    save.mutate({ email_subject: subject, email_body: body });
  };

  const isDirty =
    subject !== (invoice.email_subject ?? '') ||
    body !== (invoice.email_body ?? '');

  const clientEmail = invoice.client?.email?.trim() || null;

  return (
    <div className='flex w-full flex-col gap-4'>
      <Button
        type='button'
        variant='outline'
        className='h-9 w-full justify-between gap-2 px-4 font-medium'
        onClick={() => setOpen((v) => !v)}
      >
        <span className='flex items-center gap-2'>
          <Mail className='text-muted-foreground h-4 w-4' />
          E-Mail vorbereiten
        </span>
        <span className='text-muted-foreground text-xs font-normal'>
          {open ? 'Schließen' : 'Öffnen'}
        </span>
      </Button>
      {open && (
        <div className='space-y-4'>
          {clientEmail && (
            <div className='space-y-1.5'>
              <div className='flex items-center justify-between'>
                <label className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
                  E-Mail-Adresse
                </label>
                <CopyButton text={clientEmail} label='E-Mail kopieren' />
              </div>
              <input
                readOnly
                type='text'
                value={clientEmail}
                tabIndex={-1}
                className='bg-muted/40 text-muted-foreground w-full cursor-default rounded-md border px-3 py-2 text-sm'
              />
            </div>
          )}
          <div className='space-y-1.5'>
            <div className='flex items-center justify-between'>
              <label className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
                Betreff
              </label>
              <CopyButton text={subject} label='Betreff kopieren' />
            </div>
            <input
              type='text'
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className='bg-background focus:ring-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none'
            />
          </div>
          <div className='space-y-1.5'>
            <div className='flex items-center justify-between'>
              <label className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
                E-Mail-Text
              </label>
              <CopyButton text={body} label='Text kopieren' />
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className='bg-background focus:ring-ring w-full resize-y rounded-md border px-3 py-2 font-mono text-sm leading-relaxed focus:ring-2 focus:outline-none'
            />
          </div>
          <div className='flex justify-end'>
            <Button
              size='sm'
              variant={isDirty ? 'default' : 'secondary'}
              onClick={handleSave}
              disabled={save.isPending || !isDirty}
            >
              {save.isPending ? 'Speichern…' : 'Entwurf speichern'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
