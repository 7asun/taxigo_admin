'use client';

/**
 * ClientPriceSearch — search input + inline results list for the
 * "Kunden-Preis setzen" flow in PricingRuleDialog.
 *
 * Loads all clients via useClientsForPricing() (reference query, cached 60s).
 * Filters client-side — no API call on keystroke.
 * The results list is only rendered when searchQuery.trim().length > 0
 * to avoid showing 100+ rows on every dialog open.
 */

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { clientDisplayName } from '@/features/clients/lib/client-display-name';
import { useClientsForPricing } from '@/features/clients/hooks/use-clients-for-pricing';

export interface ClientPriceSearchProps {
  clientId: string | null;
  priceTagInput: string;
  busy: boolean;
  onClientSelect: (id: string, currentPriceTag: number | null) => void;
  onClientClear: () => void;
  onPriceTagChange: (value: string) => void;
  onRemovePriceTag: () => void;
}

export function ClientPriceSearch({
  clientId,
  priceTagInput,
  busy,
  onClientSelect,
  onClientClear,
  onPriceTagChange,
  onRemovePriceTag
}: ClientPriceSearchProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const { data: clients = [] } = useClientsForPricing();

  const q = searchQuery.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return [];
    return clients.filter((c) =>
      clientDisplayName(c).toLowerCase().includes(q)
    );
  }, [clients, q]);

  const selectedClientName = useMemo(() => {
    if (!clientId) return '';
    const sel = clients.find((c) => c.id === clientId);
    return sel ? clientDisplayName(sel) : '';
  }, [clients, clientId]);

  return (
    <div className='space-y-3'>
      {clientId && (
        <div className='bg-muted/40 flex items-center justify-between rounded-md border px-3 py-2'>
          <span className='text-sm font-medium'>{selectedClientName}</span>
          <button
            type='button'
            onClick={onClientClear}
            className='text-muted-foreground hover:text-foreground'
          >
            <X className='h-3.5 w-3.5' />
          </button>
        </div>
      )}
      {!clientId && (
        <Input
          placeholder='Fahrgast suchen…'
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          disabled={busy}
          autoComplete='off'
        />
      )}
      {!clientId && searchQuery.trim().length > 0 && (
        <ul className='max-h-40 divide-y overflow-y-auto rounded-md border text-sm'>
          {filtered.length === 0 ? (
            <li className='text-muted-foreground px-3 py-2'>Kein Treffer.</li>
          ) : (
            filtered.map((c) => (
              <li key={c.id}>
                <button
                  type='button'
                  className='hover:bg-accent w-full px-3 py-2 text-left'
                  onClick={() => {
                    onClientSelect(c.id, c.price_tag);
                    setSearchQuery('');
                  }}
                >
                  {clientDisplayName(c)}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      {clientId && (
        <div className='space-y-1.5'>
          <Label>Preis (Brutto inkl. MwSt.)</Label>
          <Input
            type='number'
            step='0.01'
            min='0'
            placeholder='z. B. 32.60'
            value={priceTagInput}
            onChange={(e) => onPriceTagChange(e.target.value)}
            disabled={busy}
          />
          <p className='text-muted-foreground text-xs'>
            Gilt für alle Fahrten dieses Fahrgasts. Hat Vorrang vor allen
            Kassenregeln. Gespeichert als Brutto — Netto wird je Steuersatz
            berechnet.
          </p>
        </div>
      )}
      {clientId && priceTagInput.trim() !== '' && (
        <button
          type='button'
          className='text-destructive text-xs hover:underline'
          onClick={onRemovePriceTag}
          disabled={busy}
        >
          Preis entfernen
        </button>
      )}
    </div>
  );
}
