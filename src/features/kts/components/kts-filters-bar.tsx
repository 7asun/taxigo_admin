'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Check, ChevronDown, RotateCcw, X, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { useTripsRscRefresh } from '@/features/trips/providers';
import type { KtsStatus } from '@/features/kts/kts.service';
import {
  KTS_STATUS_DOT,
  KTS_STATUS_LABELS,
  KTS_STATUS_VALUES
} from '@/lib/kts-status';
import { cn } from '@/lib/utils';

interface KtsFiltersBarProps {
  totalItems: number;
}

interface KtsStatusFilterProps {
  selectedStatuses: string[];
  onToggle: (status: KtsStatus) => void;
  onClear: () => void;
}

function KtsStatusFilter({
  selectedStatuses,
  onToggle,
  onClear
}: KtsStatusFilterProps) {
  const triggerLabel =
    selectedStatuses.length === 0
      ? 'Status'
      : selectedStatuses.length === 1
        ? KTS_STATUS_LABELS[selectedStatuses[0] as KtsStatus]
        : `Status (${selectedStatuses.length})`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='h-9 shrink-0 gap-1 text-xs font-normal'
        >
          <span className='truncate'>{triggerLabel}</span>
          {selectedStatuses.length > 0 ? (
            <span
              role='button'
              tabIndex={0}
              className='hover:text-foreground inline-flex shrink-0 rounded-sm opacity-70 hover:opacity-100'
              aria-label='Statusfilter zurücksetzen'
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onClear();
                }
              }}
            >
              <X className='h-3.5 w-3.5' />
            </span>
          ) : null}
          <ChevronDown className='h-3.5 w-3.5 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-56 p-0'>
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup>
              {KTS_STATUS_VALUES.map((status) => {
                const isSelected = selectedStatuses.includes(status);
                return (
                  <CommandItem
                    key={status}
                    value={status}
                    onSelect={() => onToggle(status)}
                    className='text-xs'
                  >
                    <div
                      className={cn(
                        'border-primary mr-1 flex size-4 shrink-0 items-center justify-center rounded-sm border',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'opacity-50 [&_svg]:invisible'
                      )}
                    >
                      <Check className='size-3' />
                    </div>
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        KTS_STATUS_DOT[status]
                      )}
                    />
                    {KTS_STATUS_LABELS[status]}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {selectedStatuses.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={onClear}
                    className='justify-center text-center text-xs'
                  >
                    Alle zurücksetzen
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function parseCommaSeparated(param: string | null): string[] {
  return param?.split(',').filter(Boolean) ?? [];
}

export function KtsFiltersBar({ totalItems }: KtsFiltersBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const { refreshTripsPage } = useTripsRscRefresh();

  const search = searchParams.get('search') ?? '';
  const ktsStatusParam = searchParams.get('kts_status');
  const selectedStatuses = useMemo(
    () => parseCommaSeparated(ktsStatusParam),
    [ktsStatusParam]
  );
  const overdue = searchParams.get('overdue') === 'true';

  const [localSearch, setLocalSearch] = useState(search);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  /**
   * why: default queue view is ungeprueft — admin starts with unchecked papers (like Fahrten defaults to today).
   * One-time on mount; empty deps so we do not fight filter updates.
   */
  useEffect(() => {
    if (searchParams.get('kts_status') != null) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('kts_status', 'ungeprueft');
    params.set('page', '1');
    const next = `${pathname}?${params.toString()}`;
    startTransition(() => {
      router.replace(next, { scroll: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateFilters = (
    updates: Record<string, string | string[] | null | undefined | boolean>
  ) => {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined) return;
      if (key === 'overdue') {
        if (value === true) params.set('overdue', 'true');
        else params.delete('overdue');
        return;
      }
      if (value === null || value === '') {
        params.delete(key);
      } else if (Array.isArray(value)) {
        if (value.length > 0) params.set(key, value.join(','));
        else params.delete(key);
      } else {
        params.set(key, String(value));
      }
    });

    params.set('page', '1');
    const next = `${pathname}?${params.toString()}`;
    startTransition(() => {
      router.replace(next, { scroll: false });
    });
    void refreshTripsPage();
  };

  const toggleStatus = (status: KtsStatus) => {
    const next = new Set(selectedStatuses);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    updateFilters({ kts_status: [...next] });
  };

  const clearStatusFilter = () => {
    updateFilters({ kts_status: [] });
  };

  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      updateFilters({ search: value || null });
    }, 350);
  };

  const hasActiveFilters =
    selectedStatuses.length > 0 ||
    Boolean(search.trim()) ||
    overdue ||
    (ktsStatusParam != null && ktsStatusParam !== 'ungeprueft');

  const resetFilters = () => {
    updateFilters({
      kts_status: ['ungeprueft'],
      search: null,
      overdue: false
    });
    setLocalSearch('');
  };

  return (
    <div className='flex min-w-0 shrink-0 items-center gap-2'>
      <KtsStatusFilter
        selectedStatuses={selectedStatuses}
        onToggle={toggleStatus}
        onClear={clearStatusFilter}
      />

      <div className='relative min-w-0 flex-1 md:max-w-xs'>
        <Input
          placeholder='Fahrgast oder KTS-Patient-ID…'
          value={localSearch}
          onChange={(e) => handleSearchChange(e.target.value)}
          className='h-9 pr-8 text-xs'
        />
        {localSearch ? (
          <button
            type='button'
            className='text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2'
            onClick={() => handleSearchChange('')}
            aria-label='Suche löschen'
          >
            <XCircle className='h-4 w-4' />
          </button>
        ) : null}
      </div>

      <div className='flex items-center gap-2'>
        <Switch
          id='kts-overdue-filter'
          checked={overdue}
          onCheckedChange={(checked) => updateFilters({ overdue: checked })}
        />
        <Label htmlFor='kts-overdue-filter' className='text-xs font-normal'>
          Überfällig
        </Label>
      </div>

      <div className='flex-1' />

      <span className='text-muted-foreground text-sm tabular-nums'>
        {totalItems} Belege
      </span>
      {hasActiveFilters ? (
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-8 gap-1 px-2 text-xs'
          onClick={resetFilters}
        >
          <RotateCcw className='h-3.5 w-3.5' />
          Zurücksetzen
        </Button>
      ) : null}
    </div>
  );
}
