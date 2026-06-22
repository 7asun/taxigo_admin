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
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { useTripsRscRefresh } from '@/features/trips/providers';
import {
  ABRECHNUNG_GROUP_STATUS_VALUES,
  KTS_STATUS_DOT,
  KTS_STATUS_LABELS,
  type AbrechnungGroupStatus
} from '@/lib/kts-status';
import { cn } from '@/lib/utils';

interface KtsAbrechnungFiltersBarProps {
  totalItems: number;
}

const DEFAULT_ABRECHNUNG_STATUSES: AbrechnungGroupStatus[] = [
  'abgerechnet',
  'ruecklaufer'
];

function parseCommaSeparated(param: string | null): string[] {
  return param?.split(',').filter(Boolean) ?? [];
}

function AbrechnungStatusFilter({
  selectedStatuses,
  onToggle,
  onClear
}: {
  selectedStatuses: string[];
  onToggle: (status: AbrechnungGroupStatus) => void;
  onClear: () => void;
}) {
  const triggerLabel =
    selectedStatuses.length === 0
      ? 'Status'
      : selectedStatuses.length === 1
        ? KTS_STATUS_LABELS[selectedStatuses[0] as AbrechnungGroupStatus]
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
              {ABRECHNUNG_GROUP_STATUS_VALUES.map((status) => {
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

export function KtsAbrechnungFiltersBar({
  totalItems
}: KtsAbrechnungFiltersBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const { refreshTripsPage } = useTripsRscRefresh();

  const search = searchParams.get('search') ?? '';
  const ktsStatusParam = searchParams.get('kts_status');
  const importedFrom = searchParams.get('imported_from') ?? '';
  const importedTo = searchParams.get('imported_to') ?? '';

  const selectedStatuses = useMemo(
    () => parseCommaSeparated(ktsStatusParam),
    [ktsStatusParam]
  );

  const [localSearch, setLocalSearch] = useState(search);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  /**
   * why: default Abrechnung view shows actionable groups only (abgerechnet + ruecklaufer).
   * Reuses kts_status URL key with group_status semantics — separate from Bearbeitung queue filters.
   */
  useEffect(() => {
    if (searchParams.get('view') !== 'abrechnung') return;
    if (searchParams.get('kts_status') != null) return;

    const params = new URLSearchParams(searchParams.toString());
    params.set('kts_status', DEFAULT_ABRECHNUNG_STATUSES.join(','));
    params.set('page', '1');
    const next = `${pathname}?${params.toString()}`;
    startTransition(() => {
      router.replace(next, { scroll: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateFilters = (
    updates: Record<string, string | string[] | null | undefined>
  ) => {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined) return;
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

  const toggleStatus = (status: AbrechnungGroupStatus) => {
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

  const defaultStatusKey = DEFAULT_ABRECHNUNG_STATUSES.join(',');
  const hasActiveFilters =
    selectedStatuses.length > 0 ||
    Boolean(search.trim()) ||
    Boolean(importedFrom) ||
    Boolean(importedTo) ||
    (ktsStatusParam != null && ktsStatusParam !== defaultStatusKey);

  const resetFilters = () => {
    updateFilters({
      kts_status: DEFAULT_ABRECHNUNG_STATUSES,
      search: null,
      imported_from: null,
      imported_to: null
    });
    setLocalSearch('');
  };

  return (
    <div className='flex min-w-0 shrink-0 flex-wrap items-center gap-2'>
      <AbrechnungStatusFilter
        selectedStatuses={selectedStatuses}
        onToggle={toggleStatus}
        onClear={clearStatusFilter}
      />

      <div className='relative min-w-0 flex-1 md:max-w-xs'>
        <Input
          placeholder='Belegnummer…'
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

      <Input
        type='date'
        value={importedFrom}
        onChange={(e) =>
          updateFilters({ imported_from: e.target.value || null })
        }
        className='h-9 w-[140px] text-xs'
        aria-label='Importiert ab'
      />
      <Input
        type='date'
        value={importedTo}
        onChange={(e) => updateFilters({ imported_to: e.target.value || null })}
        className='h-9 w-[140px] text-xs'
        aria-label='Importiert bis'
      />

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
