'use client';

import * as React from 'react';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Filter,
  UserRound
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import {
  Command,
  CommandGroup,
  CommandList,
  CommandSeparator
} from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { KTS_FILTER_OPTION_ROWS } from '@/features/trips/lib/kts-filter';
import { cn } from '@/lib/utils';
import {
  useBillingVariantsForPayerQuery,
  useBillingVariantsQuery,
  useDriversQuery,
  useFremdfirmenQuery,
  usePayersQuery
} from '@/features/trips/hooks/use-trip-reference-queries';
import type {
  ExportAssigneeFilter,
  ExportFilters,
  ExportStatusFilterValue
} from '@/features/trips/types/csv-export.types';
import type { KtsFilterValue } from '@/features/trips/lib/kts-filter';
import type {
  BillingVariantOption,
  PayerOption
} from '@/features/trips/types/trip-form-reference.types';

const STATUS_OPTIONS: { label: string; value: ExportStatusFilterValue }[] = [
  { label: 'Offen', value: 'pending' },
  { label: 'Zugewiesen', value: 'assigned' },
  { label: 'In Fahrt', value: 'in_progress' },
  { label: 'Abgeschlossen', value: 'completed' },
  { label: 'Storniert', value: 'cancelled' }
];

/** Matches shadcn SelectTrigger — mirrored on the billing variant popover trigger. */
const SELECT_TRIGGER_CLASSNAME =
  "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

interface ExportFilterStepProps {
  filters: ExportFilters;
  onFiltersChange: (filters: ExportFilters) => void;
  onNext: () => void;
  onCancel: () => void;
}

type AssigneeSelectValue =
  | 'all'
  | 'unassigned'
  | `driver:${string}`
  | `fremdfirma:${string}`;

function assigneeToSelectValue(
  assignee: ExportAssigneeFilter | null
): AssigneeSelectValue {
  if (!assignee) return 'all';
  if (assignee.type === 'unassigned') return 'unassigned';
  if (assignee.type === 'driver') return `driver:${assignee.driverId}`;
  return `fremdfirma:${assignee.fremdfirmaId}`;
}

function selectValueToAssignee(
  value: AssigneeSelectValue
): ExportAssigneeFilter | null {
  if (value === 'all') return null;
  if (value === 'unassigned') return { type: 'unassigned' };
  if (value.startsWith('driver:')) {
    return { type: 'driver', driverId: value.slice('driver:'.length) };
  }
  if (value.startsWith('fremdfirma:')) {
    return {
      type: 'fremdfirma',
      fremdfirmaId: value.slice('fremdfirma:'.length)
    };
  }
  return null;
}

function getBillingVariantDisplayLabel(variant: BillingVariantOption): string {
  if (variant.name !== 'Standard') {
    return `${variant.billing_type_name ?? variant.name} · ${variant.name}`;
  }
  return variant.billing_type_name ?? variant.name;
}

/**
 * Step 1: Export filters — payer, billing variants, assignee, status, KTS/Reha.
 * Billing variant source follows the list/export rule: one payer → payer-scoped variants; otherwise all variants.
 */
export function ExportFilterStep({
  filters,
  onFiltersChange,
  onNext,
  onCancel
}: ExportFilterStepProps) {
  const payersQuery = usePayersQuery();
  const driversQuery = useDriversQuery();
  const fremdfirmenQuery = useFremdfirmenQuery();

  const singlePayerId =
    filters.payerIds.length === 1 ? filters.payerIds[0]! : null;
  const usePayerScopedVariants = filters.payerIds.length === 1;

  const payerVariantsQuery = useBillingVariantsForPayerQuery(singlePayerId);
  const allVariantsQuery = useBillingVariantsQuery({
    enabled: !usePayerScopedVariants
  });

  const payers = payersQuery.data ?? [];
  const drivers = driversQuery.data ?? [];
  const fremdfirmen = fremdfirmenQuery.data ?? [];
  const billingVariants = usePayerScopedVariants
    ? (payerVariantsQuery.data ?? [])
    : (allVariantsQuery.data ?? []);

  const isLoading =
    payersQuery.isPending ||
    driversQuery.isPending ||
    fremdfirmenQuery.isPending ||
    (usePayerScopedVariants
      ? payerVariantsQuery.isPending
      : allVariantsQuery.isPending);

  const selectedPayerId = filters.payerIds[0] ?? null;
  const selectedPayer = payers.find((p) => p.id === selectedPayerId);

  const billingSelection = React.useMemo(
    () => new Set(filters.billingVariantIds),
    [filters.billingVariantIds]
  );

  const statusSelection = React.useMemo(
    () => new Set(filters.statusFilter),
    [filters.statusFilter]
  );

  const ktsSelection = React.useMemo(
    () => new Set(filters.ktsFilter),
    [filters.ktsFilter]
  );

  const updateFilters = (patch: Partial<ExportFilters>) => {
    onFiltersChange({ ...filters, ...patch });
  };

  const handlePayerChange = (value: string) => {
    if (value === 'all') {
      updateFilters({ payerIds: [], billingVariantIds: [] });
      return;
    }
    updateFilters({ payerIds: [value], billingVariantIds: [] });
  };

  const toggleBillingVariant = (id: string) => {
    const next = new Set(filters.billingVariantIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateFilters({ billingVariantIds: [...next] });
  };

  const toggleStatus = (value: ExportStatusFilterValue) => {
    const next = new Set(filters.statusFilter);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    updateFilters({ statusFilter: [...next] });
  };

  const toggleKts = (value: KtsFilterValue) => {
    const next = new Set(filters.ktsFilter);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    updateFilters({ ktsFilter: [...next] as KtsFilterValue[] });
  };

  const billingTriggerLabel = React.useMemo(() => {
    const n = filters.billingVariantIds.length;
    if (n === 0) return 'Alle Abrechnungsarten';
    if (n === 1) {
      const v = billingVariants.find(
        (x) => x.id === filters.billingVariantIds[0]
      );
      return v ? getBillingVariantDisplayLabel(v) : '1 Abrechnungsart';
    }
    return `${n} Abrechnungsarten gewählt`;
  }, [filters.billingVariantIds, billingVariants]);

  if (isLoading) {
    return (
      <div className='flex flex-col items-center justify-center py-8'>
        <span className='h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent' />
        <p className='text-muted-foreground mt-4 text-sm'>Lade Filter...</p>
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <Label
          htmlFor='export-payer-select'
          className='flex items-center gap-2'
        >
          <Building2 className='text-muted-foreground h-4 w-4' />
          Kostenträger
        </Label>
        <Select
          value={selectedPayerId ?? 'all'}
          onValueChange={handlePayerChange}
        >
          <SelectTrigger id='export-payer-select' className='w-full'>
            <SelectValue placeholder='Kostenträger wählen...' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>Alle Kostenträger</SelectItem>
            {payers.map((payer: PayerOption) => (
              <SelectItem key={payer.id} value={payer.id}>
                {payer.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filters.payerIds.length > 1 ? (
          <p className='text-muted-foreground text-xs'>
            {filters.payerIds.length} Kostenträger aus der Listenansicht —
            Abrechnungsarten zeigen alle Varianten.
          </p>
        ) : null}
      </div>

      <div className='space-y-2'>
        <Label className='flex items-center gap-2'>
          <CreditCard className='text-muted-foreground h-4 w-4' />
          Abrechnungsarten
        </Label>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type='button'
              className={cn(
                SELECT_TRIGGER_CLASSNAME,
                filters.billingVariantIds.length === 0 &&
                  'text-muted-foreground'
              )}
            >
              <span className='line-clamp-1 text-left'>
                {billingTriggerLabel}
              </span>
              <ChevronDown className='size-4 opacity-50' />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align='start'
            className='p-0'
            style={{ width: 'var(--radix-popover-trigger-width)' }}
          >
            <Command>
              <CommandList onWheel={(e) => e.stopPropagation()}>
                <CommandGroup className='max-h-[18.75rem] overflow-y-auto'>
                  {billingVariants.map((variant: BillingVariantOption) => (
                    <div
                      key={variant.id}
                      className='relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-2 text-sm outline-hidden select-none'
                    >
                      <Checkbox
                        id={`export-bv-${variant.id}`}
                        checked={billingSelection.has(variant.id)}
                        onCheckedChange={() => toggleBillingVariant(variant.id)}
                      />
                      <Label
                        htmlFor={`export-bv-${variant.id}`}
                        className='flex cursor-pointer items-center gap-2 text-sm font-normal'
                      >
                        <span
                          className='inline-block h-2 w-2 shrink-0 rounded-full'
                          style={{ backgroundColor: variant.color }}
                        />
                        <span>{getBillingVariantDisplayLabel(variant)}</span>
                      </Label>
                    </div>
                  ))}
                </CommandGroup>
                {filters.billingVariantIds.length > 0 ? (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <div className='p-2'>
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          className='w-full text-xs'
                          onClick={() =>
                            updateFilters({ billingVariantIds: [] })
                          }
                        >
                          Auswahl löschen
                        </Button>
                      </div>
                    </CommandGroup>
                  </>
                ) : null}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <div className='space-y-2'>
        <Label className='flex items-center gap-2'>
          <UserRound className='text-muted-foreground h-4 w-4' />
          Zuweisung
        </Label>
        <Select
          value={assigneeToSelectValue(filters.assigneeFilter)}
          onValueChange={(val) =>
            updateFilters({
              assigneeFilter: selectValueToAssignee(val as AssigneeSelectValue)
            })
          }
        >
          <SelectTrigger className='w-full'>
            <SelectValue placeholder='Zuweisung wählen...' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>Alle Zuweisungen</SelectItem>
            <SelectItem value='unassigned'>Nicht zugewiesen</SelectItem>
            {drivers.map((driver) => (
              <SelectItem key={driver.id} value={`driver:${driver.id}`}>
                {driver.name}
              </SelectItem>
            ))}
            {fremdfirmen.length > 0 ? (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel className='text-muted-foreground text-xs'>
                    Fremdfirmen
                  </SelectLabel>
                  {fremdfirmen.map((f) => (
                    <SelectItem key={f.id} value={`fremdfirma:${f.id}`}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            ) : null}
          </SelectContent>
        </Select>
      </div>

      <div className='grid grid-cols-2 gap-3'>
        <Collapsible defaultOpen={false}>
          <CollapsibleTrigger className='hover:bg-muted/50 group flex w-full items-center justify-between rounded-md border px-3 py-2 text-left'>
            <span className='flex min-w-0 flex-col gap-0.5'>
              <span className='flex items-center gap-2 text-sm font-medium'>
                <Filter className='text-muted-foreground h-4 w-4 shrink-0' />
                Status
              </span>
              <span className='text-muted-foreground truncate text-xs'>
                {filters.statusFilter.length === 0
                  ? 'Alle Status'
                  : `${filters.statusFilter.length} Status gewählt`}
              </span>
            </span>
            <ChevronDown className='text-muted-foreground h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180' />
          </CollapsibleTrigger>
          <CollapsibleContent className='pt-2'>
            <div className='grid grid-cols-1 gap-2'>
              {STATUS_OPTIONS.map((opt) => (
                <div key={opt.value} className='flex items-center gap-2'>
                  <Checkbox
                    id={`export-status-${opt.value}`}
                    checked={statusSelection.has(opt.value)}
                    onCheckedChange={() => toggleStatus(opt.value)}
                  />
                  <Label
                    htmlFor={`export-status-${opt.value}`}
                    className='cursor-pointer text-xs font-normal'
                  >
                    {opt.label}
                  </Label>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Collapsible defaultOpen={false}>
          <CollapsibleTrigger className='hover:bg-muted/50 group flex w-full items-center justify-between rounded-md border px-3 py-2 text-left'>
            <span className='flex min-w-0 flex-col gap-0.5'>
              <span className='text-sm font-medium'>KTS / Reha</span>
              <span className='text-muted-foreground truncate text-xs'>
                {filters.ktsFilter.length === 0
                  ? 'Kein Filter'
                  : `${filters.ktsFilter.length} Filter aktiv`}
              </span>
            </span>
            <ChevronDown className='text-muted-foreground h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180' />
          </CollapsibleTrigger>
          <CollapsibleContent className='pt-2'>
            <div className='grid grid-cols-1 gap-2'>
              {KTS_FILTER_OPTION_ROWS.map((row) => (
                <div key={row.value} className='flex items-center gap-2'>
                  <Checkbox
                    id={`export-kts-${row.value}`}
                    checked={ktsSelection.has(row.value)}
                    onCheckedChange={() => toggleKts(row.value)}
                  />
                  <Label
                    htmlFor={`export-kts-${row.value}`}
                    className='cursor-pointer text-xs font-normal'
                  >
                    {row.label}
                  </Label>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {selectedPayer ? (
        <div className='bg-muted rounded-md p-3 text-sm'>
          <span className='font-medium'>{selectedPayer.name}</span>
          {filters.billingVariantIds.length > 0 ? (
            <p className='text-muted-foreground mt-1 text-xs'>
              {filters.billingVariantIds.length} Abrechnungsart(en) gewählt
            </p>
          ) : null}
        </div>
      ) : null}

      <div className='flex gap-2'>
        <Button
          type='button'
          variant='outline'
          className='flex-1'
          onClick={onCancel}
        >
          Abbrechen
        </Button>
        <Button type='button' className='flex-1' onClick={onNext}>
          Weiter
          <ChevronRight className='ml-1 h-4 w-4' />
        </Button>
      </div>
    </div>
  );
}
