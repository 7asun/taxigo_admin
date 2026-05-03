'use client';

/**
 * Letter recipient step — layout mirrors `step-1-empfaenger.tsx`; `AddressAutocomplete`
 * is shared from the trips feature (same Google Places proxy routes) so we do not
 * duplicate geocoding UI.
 */

import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AddressAutocomplete } from '@/features/trips/components/trip-address-passenger/address-autocomplete';

import type { LetterFormValues } from '../../types';

export interface LetterStep1RecipientProps {
  values: Pick<
    LetterFormValues,
    | 'recipientCompany'
    | 'recipientSalutation'
    | 'recipientFirstName'
    | 'recipientLastName'
    | 'recipientStreet'
    | 'recipientZip'
    | 'recipientCity'
    | 'recipientCountry'
  >;
  onChange: (patch: Partial<LetterFormValues>) => void;
}

function composeAddressSearchText(
  v: LetterStep1RecipientProps['values']
): string {
  return [v.recipientStreet, v.recipientZip, v.recipientCity]
    .filter(Boolean)
    .join(', ');
}

export function LetterStep1Recipient({
  values,
  onChange
}: LetterStep1RecipientProps) {
  const [addressText, setAddressText] = useState(() =>
    composeAddressSearchText(values)
  );

  useEffect(() => {
    setAddressText(composeAddressSearchText(values));
  }, [values.recipientStreet, values.recipientZip, values.recipientCity]);

  return (
    <div className='space-y-4'>
      <div className='space-y-1.5'>
        <Label htmlFor='letter_recipient_company'>Firma</Label>
        <Input
          id='letter_recipient_company'
          value={values.recipientCompany}
          onChange={(e) => onChange({ recipientCompany: e.target.value })}
        />
      </div>

      <div className='flex gap-3'>
        <div className='w-36 shrink-0 space-y-1.5'>
          <Label htmlFor='letter_recipient_salutation'>Anrede</Label>
          <Input
            id='letter_recipient_salutation'
            value={values.recipientSalutation}
            onChange={(e) => onChange({ recipientSalutation: e.target.value })}
            placeholder='Herr / Frau'
          />
        </div>
        <div className='min-w-0 flex-1 space-y-1.5'>
          <Label htmlFor='letter_recipient_first_name'>Vorname</Label>
          <Input
            id='letter_recipient_first_name'
            value={values.recipientFirstName}
            onChange={(e) => onChange({ recipientFirstName: e.target.value })}
          />
        </div>
        <div className='min-w-0 flex-1 space-y-1.5'>
          <Label htmlFor='letter_recipient_last_name'>Nachname</Label>
          <Input
            id='letter_recipient_last_name'
            value={values.recipientLastName}
            onChange={(e) => onChange({ recipientLastName: e.target.value })}
          />
        </div>
      </div>

      <div className='space-y-1.5'>
        <Label>Adresse</Label>
        <AddressAutocomplete
          value={addressText}
          onChange={(val) => {
            setAddressText(typeof val === 'string' ? val : val.address);
          }}
          onSelectCallback={(addr) => {
            const streetLine = [addr.street, addr.street_number]
              .filter(Boolean)
              .join(' ')
              .trim();
            const composed = [streetLine, addr.zip_code, addr.city]
              .filter(Boolean)
              .join(', ');
            setAddressText(composed);
            onChange({
              recipientStreet: streetLine,
              recipientZip: addr.zip_code ?? '',
              recipientCity: addr.city ?? ''
            });
          }}
          placeholder='Straße, Hausnummer, PLZ, Ort'
        />
      </div>

      <div className='space-y-1.5'>
        <Label htmlFor='letter_recipient_street'>Straße</Label>
        <Input
          id='letter_recipient_street'
          value={values.recipientStreet}
          onChange={(e) => onChange({ recipientStreet: e.target.value })}
        />
      </div>

      <div className='flex gap-3'>
        <div className='w-32 shrink-0 space-y-1.5'>
          <Label htmlFor='letter_recipient_zip'>PLZ</Label>
          <Input
            id='letter_recipient_zip'
            value={values.recipientZip}
            onChange={(e) => onChange({ recipientZip: e.target.value })}
          />
        </div>
        <div className='min-w-0 flex-1 space-y-1.5'>
          <Label htmlFor='letter_recipient_city'>Ort</Label>
          <Input
            id='letter_recipient_city'
            value={values.recipientCity}
            onChange={(e) => onChange({ recipientCity: e.target.value })}
          />
        </div>
      </div>

      <div className='space-y-1.5'>
        <Label htmlFor='letter_recipient_country'>Land (optional)</Label>
        <Input
          id='letter_recipient_country'
          value={values.recipientCountry}
          onChange={(e) => onChange({ recipientCountry: e.target.value })}
        />
      </div>
    </div>
  );
}
