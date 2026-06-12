'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useInsertKtsCorrectionMutation } from '@/features/kts/hooks/use-kts-corrections';
import { cn } from '@/lib/utils';

interface KtsCorrectionFormProps {
  tripId: string;
  companyId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

function defaultSentAt(): string {
  return format(new Date(), "yyyy-MM-dd'T'HH:mm");
}

function emptyFormState() {
  return {
    sentTo: '',
    sentAt: defaultSentAt(),
    notes: ''
  };
}

export function KtsCorrectionForm({
  tripId,
  companyId,
  onSuccess,
  onCancel
}: KtsCorrectionFormProps) {
  // why: simple two-field form — react-hook-form + zod would add dependency without meaningful validation complexity here.
  const insertMutation = useInsertKtsCorrectionMutation();
  const [sentTo, setSentTo] = useState('');
  const [sentAt, setSentAt] = useState(defaultSentAt);
  const [notes, setNotes] = useState('');
  const [sentToError, setSentToError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const resetForm = () => {
    const empty = emptyFormState();
    setSentTo(empty.sentTo);
    setSentAt(empty.sentAt);
    setNotes(empty.notes);
    setSentToError(null);
    setSubmitError(null);
  };

  const handleCancel = () => {
    resetForm();
    onCancel();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTo = sentTo.trim();
    if (!trimmedTo) {
      setSentToError('Empfänger darf nicht leer sein.');
      return;
    }
    setSentToError(null);
    setSubmitError(null);
    try {
      await insertMutation.mutateAsync({
        tripId,
        companyId,
        sentTo: trimmedTo,
        sentAt: new Date(sentAt),
        notes: notes.trim() || undefined
      });
      resetForm();
      onSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      setSubmitError(message);
    }
  };

  const isPending = insertMutation.isPending;

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      className='border-border mt-3 space-y-3 rounded-lg border border-dashed p-3'
    >
      <div className='space-y-1'>
        <Label htmlFor='kts-correction-sent-to' className='text-xs'>
          Gesendet an
        </Label>
        <Input
          id='kts-correction-sent-to'
          value={sentTo}
          onChange={(e) => {
            setSentTo(e.target.value);
            if (sentToError) setSentToError(null);
          }}
          placeholder='z.B. Dr. Müller, Reha Oldenburg'
          disabled={isPending}
          className='h-8 text-xs'
          autoComplete='off'
        />
        {sentToError ? (
          <p className='text-destructive text-[11px]'>{sentToError}</p>
        ) : null}
      </div>
      <div className='space-y-1'>
        <Label htmlFor='kts-correction-sent-at' className='text-xs'>
          Gesendet am
        </Label>
        <Input
          id='kts-correction-sent-at'
          type='datetime-local'
          value={sentAt}
          onChange={(e) => setSentAt(e.target.value)}
          disabled={isPending}
          className={cn('h-8 text-xs')}
          required
        />
      </div>
      <div className='space-y-1'>
        <Label htmlFor='kts-correction-notes' className='text-xs'>
          Notiz (optional)
        </Label>
        <Textarea
          id='kts-correction-notes'
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={isPending}
          rows={2}
          className='text-xs'
        />
      </div>
      <div className='flex flex-wrap gap-2'>
        <Button
          type='submit'
          size='sm'
          className='h-8 text-xs'
          disabled={isPending}
        >
          {isPending ? (
            <>
              <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
              Speichern…
            </>
          ) : (
            'Speichern'
          )}
        </Button>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='h-8 text-xs'
          disabled={isPending}
          onClick={handleCancel}
        >
          Abbrechen
        </Button>
      </div>
      {submitError ? (
        <p className='text-destructive text-[11px]'>{submitError}</p>
      ) : null}
    </form>
  );
}
