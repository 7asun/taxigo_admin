'use client';

/**
 * CRUD-Dialog für `rechnungsempfaenger`.
 * `company_id` setzt der Service per Session — Zod/RLS auf dem Server.
 */

import { useEffect, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import type {
  RechnungsempfaengerRow,
  RechnungsempfaengerInsert
} from '../api/rechnungsempfaenger.service';
import { toast } from 'sonner';

export interface RechnungsempfaengerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: RechnungsempfaengerRow | null;
  onSaved: () => void;
  createRecipient: (
    row: Omit<RechnungsempfaengerInsert, 'company_id'>
  ) => Promise<unknown>;
  updateRecipient: (args: {
    id: string;
    patch: Partial<RechnungsempfaengerRow>;
  }) => Promise<unknown>;
  isSaving: boolean;
}

export function RechnungsempfaengerFormDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
  createRecipient,
  updateRecipient,
  isSaving
}: RechnungsempfaengerFormDialogProps) {
  const [name, setName] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('DE');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setAddressLine1(editing.address_line1 ?? '');
      setAddressLine2(editing.address_line2 ?? '');
      setPostalCode(editing.postal_code ?? '');
      setCity(editing.city ?? '');
      setCountry(editing.country ?? 'DE');
      setEmail(editing.email ?? '');
      setNotes(editing.notes ?? '');
      setIsActive(!!editing.is_active);
    } else {
      setName('');
      setAddressLine1('');
      setAddressLine2('');
      setPostalCode('');
      setCity('');
      setCountry('DE');
      setEmail('');
      setNotes('');
      setIsActive(true);
    }
  }, [open, editing]);

  const submit = async () => {
    const n = name.trim();
    if (!n) {
      toast.error('Name erforderlich');
      return;
    }
    try {
      if (editing) {
        await updateRecipient({
          id: editing.id,
          patch: {
            name: n,
            address_line1: addressLine1.trim() || null,
            address_line2: addressLine2.trim() || null,
            postal_code: postalCode.trim() || null,
            city: city.trim() || null,
            country: country.trim() || 'DE',
            email: email.trim() || null,
            notes: notes.trim() || null,
            is_active: isActive
          }
        });
        toast.success('Gespeichert');
      } else {
        await createRecipient({
          name: n,
          address_line1: addressLine1.trim() || null,
          address_line2: addressLine2.trim() || null,
          postal_code: postalCode.trim() || null,
          city: city.trim() || null,
          country: country.trim() || 'DE',
          email: email.trim() || null,
          notes: notes.trim() || null,
          is_active: isActive
        });
        toast.success('Angelegt');
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Fehler');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !isSaving && onOpenChange(o)}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {editing
              ? 'Rechnungsempfänger bearbeiten'
              : 'Neuer Rechnungsempfänger'}
          </DialogTitle>
        </DialogHeader>
        <div className='space-y-3'>
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className='mt-1'
            />
          </div>
          <div>
            <Label>Adresse Zeile 1</Label>
            <Input
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              className='mt-1'
            />
          </div>
          <div>
            <Label>Adresse Zeile 2</Label>
            <Input
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
              className='mt-1'
            />
          </div>
          <div className='grid grid-cols-2 gap-2'>
            <div>
              <Label>PLZ</Label>
              <Input
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                className='mt-1'
              />
            </div>
            <div>
              <Label>Ort</Label>
              <Input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className='mt-1'
              />
            </div>
          </div>
          <div>
            <Label>Land</Label>
            <Input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className='mt-1'
            />
          </div>
          <div>
            <Label>E-Mail</Label>
            <Input
              type='email'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className='mt-1'
            />
          </div>
          <div>
            <Label>Notizen (intern)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className='mt-1 min-h-[72px] resize-y'
              placeholder='Optional'
            />
          </div>
          <div className='flex items-center gap-2'>
            <Switch
              checked={isActive}
              onCheckedChange={setIsActive}
              id='active'
            />
            <Label htmlFor='active'>Aktiv</Label>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Abbrechen
          </Button>
          <Button onClick={() => void submit()} disabled={isSaving}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
