'use client';

import { useEffect, useState } from 'react';
import { PayersService } from '@/features/payers/api/payers.service';
import type { PayerWithBillingCount } from '@/features/payers/types/payer.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { X, Filter } from 'lucide-react';

interface UnassignedTripsFilterBarProps {
  selectedPayerIds: string[];
  dateFrom: string | null;
  dateTo: string | null;
  onPayerChange: (payerIds: string[]) => void;
  onDateChange: (from: string | null, to: string | null) => void;
}

export function UnassignedTripsFilterBar({
  selectedPayerIds,
  dateFrom,
  dateTo,
  onPayerChange,
  onDateChange
}: UnassignedTripsFilterBarProps) {
  const [payers, setPayers] = useState<PayerWithBillingCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    async function loadPayers() {
      try {
        const data = await PayersService.getPayers();
        setPayers(data);
      } catch (err) {
        console.error('Failed to load payers:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadPayers();
  }, []);

  const handlePayerToggle = (payerId: string) => {
    const newSelection = selectedPayerIds.includes(payerId)
      ? selectedPayerIds.filter((id) => id !== payerId)
      : [...selectedPayerIds, payerId];
    onPayerChange(newSelection);
  };

  const clearFilters = () => {
    onPayerChange([]);
    onDateChange(null, null);
  };

  const hasActiveFilters = selectedPayerIds.length > 0 || dateFrom || dateTo;

  return (
    <div className='space-y-3'>
      {/* Filter toggle and badges */}
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          variant='outline'
          size='sm'
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className='mr-2 h-4 w-4' />
          Filter
          {hasActiveFilters && (
            <Badge variant='secondary' className='ml-2'>
              {selectedPayerIds.length + (dateFrom || dateTo ? 1 : 0)}
            </Badge>
          )}
        </Button>

        {selectedPayerIds.length > 0 && (
          <Badge variant='secondary' className='gap-1'>
            {selectedPayerIds.length} Kostenträger
            <button
              onClick={() => onPayerChange([])}
              className='hover:bg-muted ml-1 rounded-full'
            >
              <X className='h-3 w-3' />
            </button>
          </Badge>
        )}

        {(dateFrom || dateTo) && (
          <Badge variant='secondary' className='gap-1'>
            {dateFrom && dateTo
              ? `${dateFrom} – ${dateTo}`
              : dateFrom
                ? `Ab ${dateFrom}`
                : `Bis ${dateTo}`}
            <button
              onClick={() => onDateChange(null, null)}
              className='hover:bg-muted ml-1 rounded-full'
            >
              <X className='h-3 w-3' />
            </button>
          </Badge>
        )}

        {hasActiveFilters && (
          <Button variant='ghost' size='sm' onClick={clearFilters}>
            Alle Filter zurücksetzen
          </Button>
        )}
      </div>

      {/* Expanded filters */}
      {showFilters && (
        <div className='bg-card rounded-lg border p-4'>
          <div className='grid gap-4 md:grid-cols-2'>
            {/* Payer filter */}
            <div className='space-y-2'>
              <Label>Kostenträger</Label>
              <div className='flex flex-wrap gap-2'>
                {isLoading ? (
                  <div className='text-muted-foreground text-sm'>
                    Lade Kostenträger...
                  </div>
                ) : payers.length === 0 ? (
                  <div className='text-muted-foreground text-sm'>
                    Keine Kostenträger verfügbar
                  </div>
                ) : (
                  payers.map((payer) => (
                    <Button
                      key={payer.id}
                      variant={
                        selectedPayerIds.includes(payer.id)
                          ? 'default'
                          : 'outline'
                      }
                      size='sm'
                      onClick={() => handlePayerToggle(payer.id)}
                    >
                      {payer.name}
                    </Button>
                  ))
                )}
              </div>
            </div>

            {/* Date range filter */}
            <div className='space-y-2'>
              <Label>Zeitraum</Label>
              <div className='flex items-center gap-2'>
                <Input
                  type='date'
                  value={dateFrom || ''}
                  onChange={(e) => onDateChange(e.target.value || null, dateTo)}
                  className='w-auto'
                />
                <span className='text-muted-foreground'>–</span>
                <Input
                  type='date'
                  value={dateTo || ''}
                  onChange={(e) =>
                    onDateChange(dateFrom, e.target.value || null)
                  }
                  className='w-auto'
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
