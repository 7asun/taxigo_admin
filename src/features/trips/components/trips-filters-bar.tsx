'use client';

/**
 * @fileoverview Fahrten filter bar — **URL is the source of truth** for the trip grid.
 *
 * - `trips-listing.tsx` (RSC) reads the same search params from the URL and runs the Supabase query.
 *   Param names and sentinels (`all`, `unassigned`, `scheduled_at` shape) must stay aligned with that
 *   server component and `nuqs` parsers — otherwise the UI shows filters that do not match the data.
 * - **Rechnungsstatus** (`invoice_status`) is a fixed option set; the RSC applies it via RPC
 *   `trip_ids_matching_invoice_effective_status` (see `trips-listing.tsx`).
 * - This component **never** owns trip rows locally; it only updates the URL and calls
 *   `refreshTripsPage()` so Next.js refetches the RSC payload and TanStack trip caches invalidate.
 * - Reference lists (Fahrer, Kostenträger, Abrechnung) come from `useTripFormData` → TanStack Query
 *   (`referenceKeys` in `src/query/keys/reference.ts`). **Billing variants** load only when exactly one
 *   payer is selected in the URL (`payer_id` comma-separated) — never treat the string `'all'` as a payer id
 *   (the hook disables that query).
 *
 * TODO: csv-export-dialog.tsx still uses single payer_id / billing_variant_id — align when export supports multi-filter.
 *
 * Layout: below `md`, compact row + collapsible “more filters”; from `md` up, one horizontal row.
 */
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronDown,
  ListFilter,
  PlusCircle,
  RotateCcw,
  Settings2,
  XCircle
} from 'lucide-react';
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
  CommandList,
  CommandSeparator
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
import {
  KTS_FILTER_OPTION_ROWS,
  type KtsFilterValue,
  parseKtsFilterParam,
  getKtsFilterTriggerLabel
} from '@/features/trips/lib/kts-filter';
import type { DateRange } from 'react-day-picker';

interface TripsFiltersBarProps {
  totalItems: number;
}

/** Absent param → []; present but empty "" → []. */
function parseCommaSeparatedIds(param: string | null): string[] {
  return param?.split(',').filter(Boolean) ?? [];
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
  const payerParam = searchParams.get('payer_id');
  const selectedPayerIds = useMemo(
    () => parseCommaSeparatedIds(payerParam),
    [payerParam]
  );
  const billingVariantParam = searchParams.get('billing_variant_id');
  const selectedBillingVariantIds = useMemo(
    () => parseCommaSeparatedIds(billingVariantParam),
    [billingVariantParam]
  );
  const invoiceStatus = searchParams.get('invoice_status') ?? 'all';
  const scheduledAt = searchParams.get('scheduled_at') ?? '';
  const currentView = searchParams.get('view') ?? 'list';
  const ktsParam = searchParams.get('kts_filter');
  const selectedKtsFilterValues = useMemo(
    () => parseKtsFilterParam(ktsParam),
    [ktsParam]
  );

  const table = useTripsTableStore((s) => s.table);
  const columnVisibility = useTripsTableStore((s) => s.columnVisibility);
  // Hide invoice_status filter when the column is hidden — filtering by a column the user chose to hide is confusing.
  const invoiceStatusVisible = columnVisibility.invoice_status !== false;

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
   * Single concrete payer UUID only (billing variant query). Comma-joined `payer_id` must not be passed.
   */
  const singlePayerIdForBilling =
    selectedPayerIds.length === 1 ? selectedPayerIds[0]! : null;

  const { drivers, payers, billingVariants } = useTripFormData(
    singlePayerIdForBilling
  );

  const [payerPickerOpen, setPayerPickerOpen] = useState(false);
  const [billingPickerOpen, setBillingPickerOpen] = useState(false);
  const [ktsPickerOpen, setKtsPickerOpen] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const hasAdvancedFilters = useMemo((): boolean => {
    return (
      driverId !== 'all' ||
      status !== 'all' ||
      selectedPayerIds.length > 0 ||
      selectedBillingVariantIds.length > 0 ||
      invoiceStatus !== 'all' ||
      selectedKtsFilterValues.length > 0
    );
  }, [
    driverId,
    status,
    selectedPayerIds,
    selectedBillingVariantIds,
    invoiceStatus,
    selectedKtsFilterValues
  ]);

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

  const invoiceStatusOptions = [
    { label: 'Alle Rechnungen', value: 'all' },
    { label: 'Nicht abger.', value: 'uninvoiced' },
    { label: 'Entwurf', value: 'draft' },
    { label: 'Versendet', value: 'sent' },
    { label: 'Bezahlt', value: 'paid' }
  ];

  const payerTriggerLabel = useMemo(() => {
    const n = selectedPayerIds.length;
    if (n === 0) return 'Alle Kostenträger';
    if (n === 1) {
      const p = payers.find((x) => x.id === selectedPayerIds[0]);
      return p?.name ?? '1 Kostenträger';
    }
    return `${n} Kostenträger gewählt`;
  }, [selectedPayerIds, payers]);

  /**
   * Writes filter deltas to the URL (always resets `page` to 1) and triggers a server refresh.
   * Do not skip `refreshTripsPage()` — `router.replace` alone can briefly show a stale RSC tree for the
   * previous params; the helper also invalidates trip-related TanStack caches (see `TripsRscRefreshProvider`).
   */
  const updateFilters = (
    updates: Record<string, string | string[] | null | undefined>
  ) => {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined) return;
      if (value === null || value === '') {
        params.delete(key);
      } else if (Array.isArray(value)) {
        if (value.length > 0) {
          params.set(key, value.join(','));
        } else {
          params.delete(key);
        }
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

  const togglePayerId = (id: string) => {
    const next = new Set(selectedPayerIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const arr = [...next];
    updateFilters({
      payer_id: arr,
      billing_variant_id: arr.length === 1 ? undefined : null
    });
  };

  const clearPayerFilter = () => {
    updateFilters({ payer_id: null, billing_variant_id: null });
  };

  const payerSelection = useMemo(
    () => new Set(selectedPayerIds),
    [selectedPayerIds]
  );

  const billingTriggerLabel = useMemo(() => {
    const n = selectedBillingVariantIds.length;
    if (n === 0) return 'Alle Abrechnungen';
    if (n === 1) {
      const v = billingVariants.find(
        (x) => x.id === selectedBillingVariantIds[0]
      );
      return v ? `${v.billing_type_name} · ${v.name}` : '1 Abrechnung';
    }
    return `${n} Abrechnungen gewählt`;
  }, [selectedBillingVariantIds, billingVariants]);

  const billingSelection = useMemo(
    () => new Set(selectedBillingVariantIds),
    [selectedBillingVariantIds]
  );

  const toggleBillingVariantId = (id: string) => {
    const next = new Set(selectedBillingVariantIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateFilters({ billing_variant_id: [...next] });
  };

  const clearBillingFilter = () => {
    updateFilters({ billing_variant_id: null });
  };

  const ktsTriggerLabel = useMemo(
    () => getKtsFilterTriggerLabel(selectedKtsFilterValues),
    [selectedKtsFilterValues]
  );

  const ktsSelection = useMemo(
    () => new Set(selectedKtsFilterValues),
    [selectedKtsFilterValues]
  );

  const toggleKtsFilterValue = (value: KtsFilterValue) => {
    const next = new Set(selectedKtsFilterValues);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    const arr = [...next] as KtsFilterValue[];
    updateFilters({ kts_filter: arr.length > 0 ? arr : null });
  };

  const clearKtsFilter = () => {
    updateFilters({ kts_filter: null });
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

  const invoiceStatusFilterSelect = (
    <Select
      value={invoiceStatus}
      onValueChange={(val) => {
        if (val === 'all') {
          updateFilters({ invoice_status: null });
        } else {
          updateFilters({ invoice_status: val });
        }
      }}
    >
      <SelectTrigger className='h-10 min-h-10 w-full min-w-0 text-xs sm:min-w-[120px] md:h-9 md:min-h-0 md:w-auto md:shrink-0'>
        <SelectValue placeholder='Rechnungsstatus' />
      </SelectTrigger>
      <SelectContent>
        {invoiceStatusOptions.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className='text-xs'>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const renderColumnVisibilityPopover = (triggerClassName: string) =>
    currentView === 'list' && table ? (
      <Popover>
        <PopoverTrigger asChild>
          {/* Match SelectTrigger / Input: h-10 touch row, md:h-9 (shadcn default height) */}
          <Button variant='outline' className={cn('px-3', triggerClassName)}>
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
      triggerClassName='h-10 min-h-10 min-w-0 flex-1 md:h-9 md:min-h-0 md:flex-initial'
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
        <SelectTrigger className='h-10 min-h-10 w-full min-w-0 text-xs sm:min-w-[110px] md:h-9 md:min-h-0 md:w-auto md:shrink-0'>
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
        <SelectTrigger className='h-10 min-h-10 w-full min-w-0 text-xs sm:min-w-[110px] md:h-9 md:min-h-0 md:w-auto md:shrink-0'>
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

      <Popover open={ktsPickerOpen} onOpenChange={setKtsPickerOpen}>
        <PopoverTrigger asChild>
          <Button
            type='button'
            variant='outline'
            className='h-10 min-h-10 w-full min-w-0 justify-between gap-1.5 text-xs font-normal sm:min-w-[110px] md:h-9 md:min-h-0 md:w-auto md:shrink-0'
          >
            {selectedKtsFilterValues.length > 0 ? (
              <span
                role='button'
                tabIndex={0}
                className='focus-visible:ring-ring mr-1 inline-flex shrink-0 rounded-sm opacity-70 hover:opacity-100 focus-visible:ring-1 focus-visible:outline-none'
                aria-label='KTS-Filter zurücksetzen'
                onClick={(e) => {
                  e.stopPropagation();
                  clearKtsFilter();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    clearKtsFilter();
                  }
                }}
              >
                <XCircle className='size-4' />
              </span>
            ) : (
              <PlusCircle className='mr-1 size-4 shrink-0' />
            )}
            <span className='min-w-0 flex-1 truncate text-left'>
              {ktsTriggerLabel}
            </span>
            <CaretSortIcon className='ml-1 h-3.5 w-3.5 shrink-0 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className='w-[min(calc(100vw-2rem),18rem)] p-0'
          align='start'
        >
          <Command>
            <CommandInput
              placeholder='KTS-Option suchen…'
              className='h-8 text-xs'
            />
            <CommandList>
              <CommandEmpty className='py-2 text-center text-xs'>
                Keine Option gefunden.
              </CommandEmpty>
              <CommandGroup className='max-h-[18.75rem] overflow-y-auto'>
                {KTS_FILTER_OPTION_ROWS.map((row) => {
                  const isSelected = ktsSelection.has(row.value);
                  return (
                    <CommandItem
                      key={row.value}
                      value={`${row.label} ${row.value}`}
                      onSelect={() => toggleKtsFilterValue(row.value)}
                      className='text-xs'
                    >
                      <div
                        className={cn(
                          'border-primary mr-2 flex size-4 shrink-0 items-center justify-center rounded-sm border',
                          isSelected
                            ? 'bg-primary text-primary-foreground'
                            : 'opacity-50 [&_svg]:invisible'
                        )}
                      >
                        <CheckIcon className='size-3' />
                      </div>
                      <span className='truncate'>{row.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              {selectedKtsFilterValues.length > 0 ? (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      onSelect={() => clearKtsFilter()}
                      className='justify-center text-center text-xs'
                    >
                      × Auswahl löschen
                    </CommandItem>
                  </CommandGroup>
                </>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Popover open={payerPickerOpen} onOpenChange={setPayerPickerOpen}>
        <PopoverTrigger asChild>
          <Button
            type='button'
            variant='outline'
            className='h-10 min-h-10 w-full min-w-0 justify-between gap-1.5 text-xs font-normal sm:min-w-[120px] md:h-9 md:min-h-0 md:w-auto md:shrink-0'
          >
            {selectedPayerIds.length > 0 ? (
              <span
                role='button'
                tabIndex={0}
                className='focus-visible:ring-ring mr-1 inline-flex shrink-0 rounded-sm opacity-70 hover:opacity-100 focus-visible:ring-1 focus-visible:outline-none'
                aria-label='Kostenträgerfilter zurücksetzen'
                onClick={(e) => {
                  e.stopPropagation();
                  clearPayerFilter();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    clearPayerFilter();
                  }
                }}
              >
                <XCircle className='size-4' />
              </span>
            ) : (
              <PlusCircle className='mr-1 size-4 shrink-0' />
            )}
            <span className='min-w-0 truncate'>{payerTriggerLabel}</span>
            <CaretSortIcon className='ml-1 h-3.5 w-3.5 shrink-0 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className='w-[min(calc(100vw-2rem),18rem)] p-0'
          align='start'
        >
          <Command>
            <CommandInput
              placeholder='Kostenträger suchen…'
              className='h-8 text-xs'
            />
            <CommandList>
              <CommandEmpty className='py-2 text-center text-xs'>
                Kein Kostenträger gefunden.
              </CommandEmpty>
              <CommandGroup className='max-h-[18.75rem] overflow-y-auto'>
                {payers.map((payer) => {
                  const isSelected = payerSelection.has(payer.id);
                  return (
                    <CommandItem
                      key={payer.id}
                      value={`${payer.name} ${payer.id}`}
                      onSelect={() => togglePayerId(payer.id)}
                      className='text-xs'
                    >
                      <div
                        className={cn(
                          'border-primary mr-2 flex size-4 shrink-0 items-center justify-center rounded-sm border',
                          isSelected
                            ? 'bg-primary text-primary-foreground'
                            : 'opacity-50 [&_svg]:invisible'
                        )}
                      >
                        <CheckIcon className='size-3' />
                      </div>
                      <span className='truncate'>{payer.name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              {selectedPayerIds.length > 0 ? (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      onSelect={() => clearPayerFilter()}
                      className='justify-center text-center text-xs'
                    >
                      Auswahl löschen
                    </CommandItem>
                  </CommandGroup>
                </>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedPayerIds.length === 1 && billingVariants.length > 0 && (
        <Popover open={billingPickerOpen} onOpenChange={setBillingPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              type='button'
              variant='outline'
              className='h-10 min-h-10 w-full min-w-0 justify-between gap-1.5 text-xs font-normal sm:min-w-[120px] md:h-9 md:min-h-0 md:w-auto md:shrink-0'
            >
              {selectedBillingVariantIds.length > 0 ? (
                <span
                  role='button'
                  tabIndex={0}
                  className='focus-visible:ring-ring mr-1 inline-flex shrink-0 rounded-sm opacity-70 hover:opacity-100 focus-visible:ring-1 focus-visible:outline-none'
                  aria-label='Abrechnungsfilter zurücksetzen'
                  onClick={(e) => {
                    e.stopPropagation();
                    clearBillingFilter();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      clearBillingFilter();
                    }
                  }}
                >
                  <XCircle className='size-4' />
                </span>
              ) : (
                <PlusCircle className='mr-1 size-4 shrink-0' />
              )}
              <span className='min-w-0 flex-1 truncate text-left'>
                {billingTriggerLabel}
              </span>
              <CaretSortIcon className='ml-1 h-3.5 w-3.5 shrink-0 opacity-50' />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className='w-[min(calc(100vw-2rem),20rem)] p-0'
            align='start'
          >
            <Command>
              <CommandInput
                placeholder='Abrechnung suchen…'
                className='h-8 text-xs'
              />
              <CommandList>
                <CommandEmpty className='py-2 text-center text-xs'>
                  Keine Abrechnung gefunden.
                </CommandEmpty>
                <CommandGroup className='max-h-[18.75rem] overflow-y-auto'>
                  {billingVariants.map((bv) => {
                    const isSelected = billingSelection.has(bv.id);
                    return (
                      <CommandItem
                        key={bv.id}
                        value={`${bv.billing_type_name} ${bv.name} ${bv.code} ${bv.id}`}
                        onSelect={() => toggleBillingVariantId(bv.id)}
                        className='text-xs'
                      >
                        <div
                          className={cn(
                            'border-primary mr-2 flex size-4 shrink-0 items-center justify-center rounded-sm border',
                            isSelected
                              ? 'bg-primary text-primary-foreground'
                              : 'opacity-50 [&_svg]:invisible'
                          )}
                        >
                          <CheckIcon className='size-3' />
                        </div>
                        <span className='truncate'>
                          {bv.billing_type_name} · {bv.name}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                {selectedBillingVariantIds.length > 0 ? (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem
                        onSelect={() => clearBillingFilter()}
                        className='justify-center text-center text-xs'
                      >
                        Auswahl löschen
                      </CommandItem>
                    </CommandGroup>
                  </>
                ) : null}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
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
            billing_variant_id: null,
            invoice_status: null,
            kts_filter: null
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
                  <div className='flex min-w-0 gap-2'>
                    {invoiceStatusVisible && (
                      <div className='min-w-0 flex-1'>
                        {invoiceStatusFilterSelect}
                      </div>
                    )}
                    {renderColumnVisibilityPopover(
                      cn(
                        'h-10 min-h-10 justify-between gap-1.5 text-xs font-normal',
                        invoiceStatusVisible ? 'min-w-0 flex-1' : 'w-full'
                      )
                    )}
                  </div>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
          {filterCountResetFooter}
        </div>
      ) : (
        <div className='bg-muted/40 mb-1 flex min-w-0 shrink-0 flex-col gap-2 rounded-lg px-3 py-2 text-xs md:flex-row md:items-center md:justify-between md:gap-3'>
          <div className='flex w-full min-w-0 flex-col gap-2 md:min-w-0 md:flex-1 md:flex-row md:flex-nowrap md:items-center md:gap-2 md:overflow-x-auto'>
            <Input
              placeholder='Fahrgast oder Adresse suchen'
              value={localSearch}
              onChange={(event) => handleSearchChange(event.target.value)}
              className='h-10 min-h-10 w-full min-w-0 md:h-9 md:min-h-0 md:min-w-[120px] md:flex-1'
            />

            <div className='flex w-full min-w-0 gap-2 md:w-auto md:shrink-0'>
              {dateFilterPicker}
              {invoiceStatusVisible && invoiceStatusFilterSelect}
              {renderColumnVisibilityPopover(
                'h-10 min-h-10 min-w-0 flex-1 justify-between gap-1.5 text-xs font-normal md:h-9 md:min-h-0 md:min-w-[8.5rem] md:flex-initial'
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
