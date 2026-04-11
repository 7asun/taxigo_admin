'use client';

/**
 * Step2ScopePicker — progressive Kostenträger → Abrechnungsfamilie → Unterart selects.
 *
 * Shown only when creating a rule from the global Preisregeln page (scope prop is null
 * on the dialog). Hidden for edits and for client_price_tag creates.
 *
 * Resolution: most specific selection wins.
 *   variant selected  → scope kind 'billing_variant'
 *   family selected   → scope kind 'billing_type'
 *   payer only        → scope kind 'payer'
 *
 * Upstream changes reset downstream state (handled in index.tsx via useEffect).
 */

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

export interface Step2ScopePickerProps {
  pickPayerId: string | null;
  pickFamilyId: string | null;
  pickVariantId: string | null;
  payers: { id: string; name: string }[];
  billingFamilies: {
    id: string;
    name: string;
    billing_variants: { id: string; name: string }[];
  }[];
  selectedFamily: { billing_variants: { id: string; name: string }[] } | null;
  busy: boolean;
  onPayerChange: (id: string | null) => void;
  onFamilyChange: (id: string | null) => void;
  onVariantChange: (id: string | null) => void;
}

export function Step2ScopePicker({
  pickPayerId,
  pickFamilyId,
  pickVariantId,
  payers,
  billingFamilies,
  selectedFamily,
  busy,
  onPayerChange,
  onFamilyChange,
  onVariantChange
}: Step2ScopePickerProps) {
  return (
    <div className='space-y-3 border-t pt-2'>
      <p className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
        Zuordnung
      </p>
      <div className='space-y-1.5'>
        <Label>Kostenträger</Label>
        <Select
          value={pickPayerId ?? ''}
          onValueChange={(v) => onPayerChange(v || null)}
          disabled={busy}
        >
          <SelectTrigger>
            <SelectValue placeholder='Kostenträger wählen…' />
          </SelectTrigger>
          <SelectContent>
            {payers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {pickPayerId && billingFamilies.length > 0 && (
        <div className='space-y-1.5'>
          <Label>
            Abrechnungsfamilie{' '}
            <span className='text-muted-foreground text-xs font-normal'>
              (optional)
            </span>
          </Label>
          <Select
            value={pickFamilyId ?? ''}
            onValueChange={(v) => onFamilyChange(v || null)}
            disabled={busy}
          >
            <SelectTrigger>
              <SelectValue placeholder='Alle Familien' />
            </SelectTrigger>
            <SelectContent>
              {billingFamilies.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {pickFamilyId && (selectedFamily?.billing_variants ?? []).length > 0 && (
        <div className='space-y-1.5'>
          <Label>
            Unterart{' '}
            <span className='text-muted-foreground text-xs font-normal'>
              (optional)
            </span>
          </Label>
          <Select
            value={pickVariantId ?? ''}
            onValueChange={(v) => onVariantChange(v || null)}
            disabled={busy}
          >
            <SelectTrigger>
              <SelectValue placeholder='Alle Unterarten' />
            </SelectTrigger>
            <SelectContent>
              {(selectedFamily?.billing_variants ?? []).map((bv) => (
                <SelectItem key={bv.id} value={bv.id}>
                  {bv.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
