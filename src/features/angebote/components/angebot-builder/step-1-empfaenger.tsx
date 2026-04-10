'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { AddressAutocomplete } from '@/features/trips/components/trip-address-passenger/address-autocomplete';

export interface EmpfaengerValues {
  recipient_company: string;
  recipient_first_name: string;
  recipient_last_name: string;
  recipient_anrede: 'Herr' | 'Frau' | '';
  recipient_street: string;
  recipient_street_number: string;
  recipient_zip: string;
  recipient_city: string;
  recipient_email: string;
  recipient_phone: string;
  customer_number: string;
}

export interface Step1EmpfaengerProps {
  values: EmpfaengerValues;
  onChange: (patch: Partial<EmpfaengerValues>) => void;
}

export function Step1Empfaenger({ values, onChange }: Step1EmpfaengerProps) {
  // Tracks raw text in the address autocomplete input independently from
  // the structured fields — allows typing without resetting to the composed value.
  const [addressText, setAddressText] = useState(
    [
      values.recipient_street,
      values.recipient_street_number,
      values.recipient_zip,
      values.recipient_city
    ]
      .filter(Boolean)
      .join(', ')
  );

  return (
    <div className='space-y-4'>
      {/* Company */}
      <div className='space-y-1.5'>
        <Label htmlFor='recipient_company'>Firma</Label>
        <Input
          id='recipient_company'
          placeholder='Musterfirma GmbH'
          value={values.recipient_company}
          onChange={(e) => onChange({ recipient_company: e.target.value })}
        />
      </div>

      {/* Anrede + Name row */}
      <div className='flex gap-3'>
        <div className='w-36 shrink-0 space-y-1.5'>
          <Label htmlFor='recipient_anrede'>Anrede</Label>
          <Select
            value={values.recipient_anrede || '__none__'}
            onValueChange={(v) =>
              onChange({
                recipient_anrede: v === '__none__' ? '' : (v as 'Herr' | 'Frau')
              })
            }
          >
            <SelectTrigger id='recipient_anrede'>
              <SelectValue placeholder='Anrede' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='__none__'>Keine Angabe</SelectItem>
              <SelectItem value='Herr'>Herr</SelectItem>
              <SelectItem value='Frau'>Frau</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className='min-w-0 flex-1 space-y-1.5'>
          <Label htmlFor='recipient_first_name'>Vorname</Label>
          <Input
            id='recipient_first_name'
            placeholder='Max'
            value={values.recipient_first_name}
            onChange={(e) => onChange({ recipient_first_name: e.target.value })}
          />
        </div>
        <div className='min-w-0 flex-1 space-y-1.5'>
          <Label htmlFor='recipient_last_name'>Nachname</Label>
          <Input
            id='recipient_last_name'
            placeholder='Mustermann'
            value={values.recipient_last_name}
            onChange={(e) => onChange({ recipient_last_name: e.target.value })}
            required
          />
        </div>
      </div>

      {/* Address autocomplete — fills street / nr / zip / city */}
      <div className='space-y-1.5'>
        <Label>Adresse</Label>
        <AddressAutocomplete
          value={addressText}
          onChange={(val) => {
            // Update the raw text as the user types
            setAddressText(typeof val === 'string' ? val : val.address);
          }}
          onSelectCallback={(addr) => {
            const composed = [
              addr.street,
              addr.street_number,
              addr.zip_code,
              addr.city
            ]
              .filter(Boolean)
              .join(', ');
            setAddressText(composed);
            onChange({
              recipient_street: addr.street ?? '',
              recipient_street_number: addr.street_number ?? '',
              recipient_zip: addr.zip_code ?? '',
              recipient_city: addr.city ?? ''
            });
          }}
          placeholder='Straße, Hausnummer, PLZ, Ort'
        />
      </div>

      {/* E-Mail + Telefon row */}
      <div className='flex gap-3'>
        <div className='min-w-0 flex-1 space-y-1.5'>
          <Label htmlFor='recipient_email'>E-Mail</Label>
          <Input
            id='recipient_email'
            type='email'
            placeholder='kontakt@firma.de'
            value={values.recipient_email}
            onChange={(e) => onChange({ recipient_email: e.target.value })}
          />
        </div>
        <div className='min-w-0 flex-1 space-y-1.5'>
          <Label htmlFor='recipient_phone'>Telefon</Label>
          <Input
            id='recipient_phone'
            type='tel'
            placeholder='+49 123 456789'
            value={values.recipient_phone}
            onChange={(e) => onChange({ recipient_phone: e.target.value })}
          />
        </div>
      </div>

      {/* Customer number */}
      <div className='space-y-1.5'>
        <Label htmlFor='customer_number'>Kundennummer</Label>
        <Input
          id='customer_number'
          placeholder='KD-001 (optional)'
          value={values.customer_number}
          onChange={(e) => onChange({ customer_number: e.target.value })}
        />
      </div>
    </div>
  );
}
