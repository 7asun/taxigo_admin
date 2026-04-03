'use client';

/**
 * @fileoverview Fahrten filter bar — **URL is the source of truth** for the trip grid.
 *
 * - `trips-listing.tsx` (RSC) reads the same search params from the URL and runs the Supabase query.
 *   Param names and sentinels (`all`, `unassigned`, `scheduled_at` shape) must stay aligned with that
 *   server component and `nuqs` parsers — otherwise the UI shows filters that do not match the data.
 * - This component **never** owns trip rows locally; it only updates the URL and calls
 *   `refreshTripsPage()` so Next.js refetches the RSC payload and TanStack trip caches invalidate.
 * - Reference lists (Fahrer, Kostenträger, Abrechnung) come from `useTripFormData` → TanStack Query
 *   (`referenceKeys` in `src/query/keys/reference.ts`). **Billing variants** load only when `payer_id` is a
 *   real UUID — never treat the string `'all'` as a payer id (the hook disables that query).
 *
 * Layout: below `md`, compact row + collapsible “more filters”; from `md` up, one horizontal row.
 */
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { de } from 'date-fns/locale';
import { ChevronDown, ListFilter, RotateCcw, Settings2 } from 'lucide-react';
import { CheckIcon, CaretSortIcon } from '@radix-ui/react-icons';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command';
import { DateRangePicker } from '@/components/ui/date-time-picker';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import { useTripFormData } from '@/features/trips/hooks/use-trip-form-data';
import { useTripsRscRefresh } from '@/features/trips/providers';
import { useTripsTableStore } from '@/features/trips/stores/use-trips-table-store';
import { useIsNarrowScreen } from '@/hooks/use-is-narrow-screen';
import { cn } from '@/lib/utils';
import { todayYmdInBusinessTz } from '@/features/trips/lib/trip-business-date';
import type { DateRange } from 'react-day-picker';

interface TripsFiltersBarProps {
  totalItems: number;
}

export function TripsFiltersBar({ totalItems }: TripsFiltersBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const { refreshTripsPage } = useTripsRscRefresh();
  /** One filter layout at a time so the date `Popover` (and other overlays) are not mounted twice. */
  const isNarrow = useIsNarrowScreen(768);

  /** Mirrors URL — these keys must match `trips-listing.tsx` / `searchParamsCache` parsers. */
  const search = searchParams.get('search') ?? '';
  const driverId = searchParams.get('driver_id') ?? 'all';
  const status = searchParams.get('status') ?? 'all';
  const payerId = searchParams.get('payer_id') ?? 'all';
  const billingVariantId = searchParams.get('billing_variant_id') ?? 'all';
  const scheduledAt = searchParams.get('scheduled_at') ?? '';
  const currentView = searchParams.get('view') ?? 'list';

  const table = useTripsTableStore((s) => s.table);
  const columnVisibility = useTripsTableStore((s) => s.columnVisibility);

  const hidableColumns = useMemo(() => {
    if (!table) return [];
    return table
      .getAllColumns()
      .filter(
        (col) => typeof col.accessorFn !== 'undefined' && col.getCanHide()
      );
    // columnVisibility in deps ensures re-render (and fresh getIsVisible()) on every toggle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, columnVisibility]);

  const [localSearch, setLocalSearch] = useState(search);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local input back when URL search param changes externally (e.g. reset button)
  useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  /**
   * One-time default: if the user lands without `scheduled_at`, set “today” (business TZ) + `page=1`.
   * Intentionally empty deps — run once on mount; adding `searchParams` would re-run on every keystroke
   * and fight the debounced search input. If `scheduled_at` is already set (e.g. shared link), we no-op.
   */
  useEffect(() => {
    if (searchParams.get('scheduled_at')) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('scheduled_at', todayYmdInBusinessTz());
    params.set('page', '1');
    const next = `${pathname}?${params.toString()}`;
    startTransition(() => {
      router.replace(next, { scroll: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Drivers/payers: shared TanStack cache (`referenceKeys`). Billing types: only when `payerId` is a
   * concrete id (not `'all'`) — see `useBillingVariantsForPayerQuery`.
   */
  const { drivers, payers, billingVariants } = useTripFormData(payerId ?? null);

  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const hasAdvancedFilters = useMemo((): boolean => {
    return (
      driverId !== 'all' ||
      status !== 'all' ||
      payerId !== 'all' ||
      (Boolean(billingVariantId) && billingVariantId !== 'all')
    );
  }, [driverId, status, payerId, billingVariantId]);

  const prevAdvancedRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevAdvancedRef.current === null) {
      prevAdvancedRef.current = hasAdvancedFilters;
      if (hasAdvancedFilters) {
        setFiltersExpanded(true);
      }
      return;
    }
    if (hasAdvancedFilters !== prevAdvancedRef.current) {
      if (hasAdvancedFilters) {
        setFiltersExpanded(true);
      } else {
        setFiltersExpanded(false);
      }
      prevAdvancedRef.current = hasAdvancedFilters;
    }
  }, [hasAdvancedFilters]);

  // Parse scheduled_at from URL (single timestamp or range "from,to")
  const selectedDateRange = useMemo((): DateRange | undefined => {
    if (!scheduledAt) return undefined;
    const parts = scheduledAt.split(',');
    if (parts.length === 2) {
      const fromMs = Number(parts[0]);
      const toMs = Number(parts[1]);
      if (!Number.isNaN(fromMs) && !Number.isNaN(toMs)) {
        return {
          from: new Date(fromMs),
          to: new Date(toMs)
        };
      }
    }
    // Single date - treat as range with same start/end
    const ts = Number(scheduledAt);
    if (!Number.isNaN(ts)) {
      const d = new Date(ts);
      return { from: d, to: d };
    }
    return undefined;
  }, [scheduledAt]);

  const driverOptions = useMemo(
    () => [
      { label: 'Alle Fahrer', value: 'all' },
      { label: 'Nicht zugewiesen', value: 'unassigned' },
      ...drivers.map((d) => ({ label: d.name, value: d.id }))
    ],
    [drivers]
  );

  const statusOptions = [
    { label: 'Alle Status', value: 'all' },
    { label: 'Offen', value: 'pending' },
    { label: 'Zugewiesen', value: 'assigned' },
    { label: 'In Fahrt', value: 'in_progress' },
    { label: 'Abgeschlossen', value: 'completed' },
    { label: 'Storniert', value: 'cancelled' }
  ];

  /**
   * Writes filter deltas to the URL (always resets `page` to 1) and triggers a server refresh.
   * Do not skip `refreshTripsPage()` — `router.replace` alone can briefly show a stale RSC tree for the
   * previous params; the helper also invalidates trip-related TanStack caches (see `TripsRscRefreshProvider`).
   */
  const updateFilters = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });

    params.set('page', '1');

    const next = `${pathname}?${params.toString()}`;
    startTransition(() => {
      router.replace(next, { scroll: false });
    });
    void refreshTripsPage();
  };

  // Handle date range selection from DateRangePicker
  const handleDateRangeChange = (range: DateRange | undefined) => {
    if (!range?.from) {
      updateFilters({ scheduled_at: null });
      return;
    }
    const from = range.from.getTime();
    const to = range.to?.getTime() ?? from;
    updateFilters({
      scheduled_at: `${from},${to}`
    });
  };

  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      updateFilters({ search: value || null });
    }, 350);
  };

  const renderColumnVisibilityPopover = (triggerClassName: string) =>
    currentView === 'list' && table ? (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant='outline' size='sm' className={triggerClassName}>
            <Settings2 className='h-3.5 w-3.5 shrink-0' />
            <span className='truncate'>Spalten</span>
            <CaretSortIcon className='ml-1 h-3.5 w-3.5 shrink-0 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent align='start' className='w-48 p-0'>
          <Command>
            <CommandInput
              placeholder='Spalte suchen...'
              className='h-8 text-xs'
            />
            <CommandList>
              <CommandEmpty className='py-2 text-center text-xs'>
                Keine Spalten gefunden.
              </CommandEmpty>
              <CommandGroup>
                {hidableColumns.map((column) => (
                  <CommandItem
                    key={column.id}
                    onSelect={() =>
                      column.toggleVisibility(!column.getIsVisible())
                    }
                    className='text-xs'
                  >
                    <span className='truncate'>
                      {(column.columnDef.meta as any)?.label ?? column.id}
                    </span>
                    <CheckIcon
                      className={cn(
                        'ml-auto size-3.5 shrink-0',
                        column.getIsVisible() ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    ) : null;

  const dateFilterPicker = (
    <DateRangePicker
      value={selectedDateRange}
      onChange={handleDateRangeChange}
      triggerClassName='h-10 min-h-10 min-w-0 flex-1 md:h-8 md:min-h-0 md:flex-initial'
      placeholder='Zeitraum wählen'
    />
  );

  const advancedFilterSelects = (
    <>
      <Select
        value={driverId}
        onValueChange={(val) => {
          if (val === 'all') {
            updateFilters({ driver_id: null });
          } else {
            updateFilters({ driver_id: val });
          }
        }}
      >
        <SelectTrigger className='h-10 min-h-10 w-full min-w-0 text-xs sm:min-w-[110px] md:h-8 md:min-h-0 md:w-auto md:shrink-0'>
          <SelectValue placeholder='Fahrer' />
        </SelectTrigger>
        <SelectContent>
          {driverOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className='text-xs'>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={status}
        onValueChange={(val) => {
          if (val === 'all') {
            updateFilters({ status: null });
          } else {
            updateFilters({ status: val });
          }
        }}
      >
        <SelectTrigger className='h-10 min-h-10 w-full min-w-0 text-xs sm:min-w-[110px] md:h-8 md:min-h-0 md:w-auto md:shrink-0'>
          <SelectValue placeholder='Status' />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className='text-xs'>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={payerId}
        onValueChange={(val) => {
          if (val === 'all') {
            updateFilters({ payer_id: null, billing_variant_id: null });
          } else {
            updateFilters({ payer_id: val, billing_variant_id: null });
          }
        }}
      >
        <SelectTrigger className='h-10 min-h-10 w-full min-w-0 text-xs sm:min-w-[120px] md:h-8 md:min-h-0 md:w-auto md:shrink-0'>
          <SelectValue placeholder='Kostenträger' />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='all' className='text-xs'>
            Alle Kostenträger
          </SelectItem>
          {payers.map((payer) => (
            <SelectItem key={payer.id} value={payer.id} className='text-xs'>
              {payer.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {payerId !== 'all' && billingVariants.length > 0 && (
        <Select
          value={billingVariantId}
          onValueChange={(val) => {
            if (val === 'all') {
              updateFilters({ billing_variant_id: null });
            } else {
              updateFilters({ billing_variant_id: val });
            }
          }}
        >
          <SelectTrigger className='h-10 min-h-10 w-full min-w-0 text-xs sm:min-w-[120px] md:h-8 md:min-h-0 md:w-auto md:shrink-0'>
            <SelectValue placeholder='Abrechnung' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all' className='text-xs'>
              Alle Abrechnungen
            </SelectItem>
            {billingVariants.map((bv) => (
              <SelectItem key={bv.id} value={bv.id} className='text-xs'>
                <span className='flex flex-col gap-0 leading-tight'>
                  <span>
                    {bv.billing_type_name} · {bv.name}
                  </span>
                  <span className='text-muted-foreground font-mono text-[10px]'>
                    {bv.code}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </>
  );

  const filterCountResetFooter = (
    <div className='border-border/60 flex w-full min-w-0 shrink-0 flex-row items-center justify-between gap-2 border-t pt-2 md:w-auto md:justify-end md:border-0 md:pt-0'>
      <span className='text-muted-foreground text-[11px]'>
        {totalItems} Fahrten
      </span>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='text-muted-foreground hover:text-foreground size-10 shrink-0 md:size-8'
        aria-label='Filter zurücksetzen'
        title='Filter zurücksetzen'
        onClick={() => {
          updateFilters({
            search: null,
            driver_id: null,
            status: null,
            payer_id: null,
            scheduled_at: null,
            billing_variant_id: null
          });
        }}
      >
        <RotateCcw className='size-4' />
      </Button>
    </div>
  );

  return (
    <>
      {isNarrow ? (
        <div className='bg-muted/40 mb-1 flex min-w-0 shrink-0 flex-col gap-2 rounded-lg px-3 py-2 text-xs'>
          <Collapsible open={filtersExpanded} onOpenChange={setFiltersExpanded}>
            <div className='flex min-w-0 flex-col gap-2'>
              <div className='flex min-w-0 gap-2'>
                <Input
                  placeholder='Fahrgast oder Adresse suchen'
                  value={localSearch}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  className='h-10 min-h-10 min-w-0 flex-1'
                />
                {dateFilterPicker}
                <CollapsibleTrigger asChild>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='text-muted-foreground h-10 min-h-10 shrink-0 gap-1.5 px-2.5'
                    aria-expanded={filtersExpanded}
                  >
                    <ListFilter className='h-4 w-4 shrink-0' />
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 shrink-0 transition-transform',
                        filtersExpanded && 'rotate-180'
                      )}
                    />
                    <span className='sr-only'>Weitere Filter</span>
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <div className='flex flex-col gap-2 pt-1'>
                  <div className='grid w-full grid-cols-1 gap-2 sm:grid-cols-2'>
                    {advancedFilterSelects}
                  </div>
                  {renderColumnVisibilityPopover(
                    'h-10 min-h-10 w-full justify-between gap-1.5 text-xs font-normal'
                  )}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
          {filterCountResetFooter}
        </div>
      ) : (
        <div className='bg-muted/40 mb-1 flex min-w-0 shrink-0 flex-col gap-2 rounded-lg px-3 py-2 text-xs md:flex-row md:items-start md:justify-between md:gap-3'>
          <div className='flex w-full min-w-0 flex-col gap-2 md:min-w-0 md:flex-1 md:flex-row md:flex-nowrap md:items-center md:gap-2 md:overflow-x-auto'>
            <Input
              placeholder='Fahrgast oder Adresse suchen'
              value={localSearch}
              onChange={(event) => handleSearchChange(event.target.value)}
              className='h-10 min-h-10 w-full min-w-0 md:h-8 md:min-h-0 md:min-w-[120px] md:flex-1'
            />

            <div className='flex w-full min-w-0 gap-2 md:w-auto md:shrink-0'>
              {dateFilterPicker}
              {renderColumnVisibilityPopover(
                'h-10 min-h-10 min-w-0 flex-1 justify-between gap-1.5 text-xs font-normal md:h-8 md:min-h-0 md:min-w-[8.5rem] md:flex-initial'
              )}
            </div>

            <div className='grid w-full grid-cols-1 gap-2 sm:grid-cols-2 md:contents'>
              {advancedFilterSelects}
            </div>
          </div>

          {filterCountResetFooter}
        </div>
      )}
    </>
  );
}
