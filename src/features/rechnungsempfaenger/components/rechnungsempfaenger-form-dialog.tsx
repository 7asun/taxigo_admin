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
import {
  AddressAutocomplete,
  type AddressResult
} from '@/features/trips/components/address-autocomplete';
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
  onDeleted?: () => void;
  createRecipient: (
    row: Omit<RechnungsempfaengerInsert, 'company_id'>
  ) => Promise<unknown>;
  updateRecipient: (args: {
    id: string;
    patch: Partial<RechnungsempfaengerRow>;
  }) => Promise<unknown>;
  deleteRecipient?: (id: string) => Promise<unknown>;
  isSaving: boolean;
  isDeleting?: boolean;
}

export function RechnungsempfaengerFormDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
  onDeleted,
  createRecipient,
  updateRecipient,
  deleteRecipient,
  isSaving,
  isDeleting
}: RechnungsempfaengerFormDialogProps) {
  // Name structure
  const [anrede, setAnrede] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [abteilung, setAbteilung] = useState('');

  // Contact
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  // Address (from autocomplete)
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('DE');
  const [addressSearch, setAddressSearch] = useState('');

  // Other
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setAnrede(editing.anrede ?? '');
      setFirstName(editing.first_name ?? '');
      setLastName(editing.last_name ?? '');
      setCompanyName(editing.company_name ?? '');
      setAbteilung(editing.abteilung ?? '');
      setPhone(editing.phone ?? '');
      setEmail(editing.email ?? '');
      setAddressLine1(editing.address_line1 ?? '');
      setAddressLine2(editing.address_line2 ?? '');
      setPostalCode(editing.postal_code ?? '');
      setCity(editing.city ?? '');
      setCountry(editing.country ?? 'DE');
      setAddressSearch(editing.address_line1 ?? '');
      setNotes(editing.notes ?? '');
      setIsActive(!!editing.is_active);
    } else {
      setAnrede('');
      setFirstName('');
      setLastName('');
      setCompanyName('');
      setAbteilung('');
      setPhone('');
      setEmail('');
      setAddressLine1('');
      setAddressLine2('');
      setPostalCode('');
      setCity('');
      setCountry('DE');
      setAddressSearch('');
      setNotes('');
      setIsActive(true);
    }
  }, [open, editing]);

  const handleAddressSelect = (result: AddressResult | string) => {
    if (typeof result === 'string') {
      setAddressSearch(result);
      setAddressLine1(result);
      return;
    }
    setAddressSearch(result.address);
    setAddressLine1(result.address);
    if (result.zip_code) setPostalCode(result.zip_code);
    if (result.city) setCity(result.city);
  };

  const buildDisplayName = (): string => {
    const parts: string[] = [];
    if (anrede.trim()) parts.push(anrede.trim());
    if (firstName.trim()) parts.push(firstName.trim());
    if (lastName.trim()) parts.push(lastName.trim());
    return parts.join(' ') || companyName.trim() || 'Unbenannt';
  };

  const submit = async () => {
    const displayName = buildDisplayName();
    const ln = lastName.trim();
    if (!ln && !companyName.trim()) {
      toast.error('Nachname oder Firmenname erforderlich');
      return;
    }

    try {
      const patch = {
        name: displayName,
        anrede: anrede.trim() || null,
        first_name: firstName.trim() || null,
        last_name: ln || null,
        company_name: companyName.trim() || null,
        abteilung: abteilung.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address_line1: addressLine1.trim() || null,
        address_line2: addressLine2.trim() || null,
        postal_code: postalCode.trim() || null,
        city: city.trim() || null,
        country: country.trim() || 'DE',
        notes: notes.trim() || null,
        is_active: isActive
      };

      if (editing) {
        await updateRecipient({
          id: editing.id,
          patch
        });
        toast.success('Gespeichert');
      } else {
        await createRecipient(patch);
        toast.success('Angelegt');
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Fehler');
    }
  };

  const handleDelete = async () => {
    if (!editing || !deleteRecipient) return;
    if (!confirm('Rechnungsempfänger wirklich löschen?')) return;
    try {
      await deleteRecipient(editing.id);
      toast.success('Gelöscht');
      onDeleted?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Fehler beim Löschen');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !isSaving && !isDeleting && onOpenChange(o)}
    >
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {editing
              ? 'Rechnungsempfänger bearbeiten'
              : 'Neuer Rechnungsempfänger'}
          </DialogTitle>
        </DialogHeader>
        <div className='max-h-[60vh] space-y-4 overflow-y-auto pr-1'>
          {/* Name Section */}
          <div className='space-y-3'>
            <div className='grid grid-cols-3 gap-2'>
              <div>
                <Label>Anrede</Label>
                <Input
                  value={anrede}
                  onChange={(e) => setAnrede(e.target.value)}
                  placeholder='z.B. Herr'
                  className='mt-1'
                />
              </div>
              <div>
                <Label>Vorname</Label>
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className='mt-1'
                />
              </div>
              <div>
                <Label>Nachname *</Label>
                <Input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className='mt-1'
                />
              </div>
            </div>
            <div>
              <Label>Firmenname (optional)</Label>
              <Input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder='Falls Rechnung an Firma adressiert'
                className='mt-1'
              />
            </div>
            <div>
              <Label>Abteilung (optional)</Label>
              <Input
                value={abteilung}
                onChange={(e) => setAbteilung(e.target.value)}
                placeholder='z.B. Kundenservice, Rechnungswesen'
                className='mt-1'
              />
            </div>
          </div>

          {/* Contact Section */}
          <div className='grid grid-cols-2 gap-2'>
            <div>
              <Label>Telefon</Label>
              <Input
                type='tel'
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
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
          </div>

          {/* Address Section */}
          <div className='space-y-3 border-t pt-3'>
            <div>
              <Label>Adresse suchen</Label>
              <div className='mt-1'>
                <AddressAutocomplete
                  value={addressSearch}
                  onChange={handleAddressSelect}
                  placeholder='Adresse eingeben...'
                />
              </div>
            </div>
            <div>
              <Label>Adresse Zeile 1</Label>
              <Input
                value={addressLine1}
                onChange={(e) => {
                  setAddressLine1(e.target.value);
                  setAddressSearch(e.target.value);
                }}
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
            <div className='grid grid-cols-3 gap-2'>
              <div>
                <Label>PLZ</Label>
                <Input
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  className='mt-1'
                />
              </div>
              <div className='col-span-2'>
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
          </div>

          {/* Notes */}
          <div className='border-t pt-3'>
            <Label>Notizen (intern)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className='mt-1 min-h-[72px] resize-y'
              placeholder='Optional'
            />
          </div>

          {/* Active toggle */}
          <div className='flex items-center gap-2 border-t pt-3'>
            <Switch
              checked={isActive}
              onCheckedChange={setIsActive}
              id='active'
            />
            <Label htmlFor='active'>Aktiv</Label>
          </div>
        </div>

        <DialogFooter className='gap-2 sm:justify-between'>
          <div>
            {editing && deleteRecipient && (
              <Button
                variant='destructive'
                onClick={() => void handleDelete()}
                disabled={isDeleting || isSaving}
              >
                {isDeleting ? 'Löschen...' : 'Löschen'}
              </Button>
            )}
          </div>
          <div className='flex gap-2'>
            <Button
              variant='outline'
              onClick={() => onOpenChange(false)}
              disabled={isSaving || isDeleting}
            >
              Abbrechen
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={isSaving || isDeleting}
            >
              {isSaving ? 'Speichern...' : 'Speichern'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
