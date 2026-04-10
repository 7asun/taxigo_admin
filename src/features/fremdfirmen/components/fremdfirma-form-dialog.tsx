'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import type {
  FremdfirmaInsert,
  FremdfirmaRow,
  FremdfirmaUpdate
} from '@/features/fremdfirmen/api/fremdfirmen.service';
import { FREMDFIRMA_PAYMENT_MODE_OPTIONS } from '@/features/fremdfirmen/lib/fremdfirma-payment-mode-labels';
import type { FremdfirmaPaymentMode } from '@/features/trips/types/trip-form-reference.types';
import { toast } from 'sonner';

export interface FremdfirmaFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null = create */
  editing: FremdfirmaRow | null;
  onSaved: () => void;
  createFremdfirma: (row: FremdfirmaInsert) => Promise<unknown>;
  updateFremdfirma: (args: {
    id: string;
    patch: FremdfirmaUpdate;
  }) => Promise<unknown>;
  isSaving: boolean;
}

export function FremdfirmaFormDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
  createFremdfirma,
  updateFremdfirma,
  isSaving
}: FremdfirmaFormDialogProps) {
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [mode, setMode] = useState<FremdfirmaPaymentMode>('monthly_invoice');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setNumber(editing.number ?? '');
      setMode(
        (editing.default_payment_mode as FremdfirmaPaymentMode) ||
          'monthly_invoice'
      );
      setIsActive(!!editing.is_active);
    } else {
      setName('');
      setNumber('');
      setMode('monthly_invoice');
      setIsActive(true);
    }
  }, [open, editing]);

  const handleSubmit = async () => {
    const n = name.trim();
    if (!n) {
      toast.error('Name erforderlich');
      return;
    }
    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error('Nicht angemeldet');
      return;
    }
    const { data: account, error: accErr } = await supabase
      .from('accounts')
      .select('company_id')
      .eq('id', user.id)
      .maybeSingle();
    if (accErr) {
      toast.error(`Unternehmen konnte nicht geladen werden: ${accErr.message}`);
      return;
    }
    if (!account) {
      toast.error(
        'Kein Konto in der Datenbank — bitte Support oder erneut anmelden.'
      );
      return;
    }
    if (!account.company_id) {
      toast.error(
        'Ihrem Benutzer ist kein Unternehmen zugeordnet — bitte in den Einstellungen prüfen.'
      );
      return;
    }
    const sort_order = editing?.sort_order ?? 0;
    try {
      if (editing) {
        await updateFremdfirma({
          id: editing.id,
          patch: {
            name: n,
            number: number.trim() ? number.trim() : null,
            default_payment_mode: mode,
            is_active: isActive,
            sort_order
          }
        });
        toast.success('Fremdfirma aktualisiert');
      } else {
        await createFremdfirma({
          company_id: account.company_id,
          name: n,
          number: number.trim() ? number.trim() : null,
          default_payment_mode: mode,
          is_active: isActive,
          sort_order: 0
        });
        toast.success('Fremdfirma angelegt');
      }
      onSaved();
      onOpenChange(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Fremdfirma bearbeiten' : 'Neue Fremdfirma'}
          </DialogTitle>
        </DialogHeader>
        <div className='space-y-3 py-1'>
          <div className='space-y-1'>
            <Label htmlFor='ff-name'>Name</Label>
            <Input
              id='ff-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='z. B. Taxi Müller GmbH'
            />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='ff-num'>Nummer (optional)</Label>
            <Input
              id='ff-num'
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder='Interne Referenz'
            />
          </div>
          <div className='space-y-1'>
            <Label>Standard-Abrechnungsart</Label>
            <Select
              value={mode}
              onValueChange={(v) => setMode(v as FremdfirmaPaymentMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREMDFIRMA_PAYMENT_MODE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
            <Label htmlFor='ff-active' className='cursor-pointer'>
              Aktiv
            </Label>
            <Switch
              id='ff-active'
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            Abbrechen
          </Button>
          <Button
            type='button'
            disabled={isSaving}
            onClick={() => void handleSubmit()}
          >
            {isSaving ? 'Speichern…' : 'Speichern'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
