'use client';

import type { VisibilityState } from '@tanstack/react-table';
import { ChevronDown } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

import type { Json } from '@/types/database.types';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { AnsichtenSheet } from '@/features/trips/components/ansichten-sheet';
import { columns as tripsTableColumns } from '@/features/trips/components/trips-tables/columns';
import {
  jsonToColumnOrder,
  jsonToParamEntries,
  jsonToVisibilityState,
  useApplyTripPreset
} from '@/features/trips/hooks/use-apply-trip-preset';
import {
  buildTripPresetParamsFromSearchParams,
  useCurrentTripViewSnapshot
} from '@/features/trips/hooks/use-current-trip-view-snapshot';
import {
  useCreateTripPreset,
  useTripPresets
} from '@/features/trips/hooks/use-trip-presets';
import { todayYmdInBusinessTz } from '@/features/trips/lib/trip-business-date';
import { useTripsRscRefresh } from '@/features/trips/providers';
import { useTripsTableStore } from '@/features/trips/stores/use-trips-table-store';
import {
  stableParamsJson,
  TRIP_PRESET_PARAM_KEYS,
  type TripPreset,
  type TripPresetParams
} from '@/features/trips/types/trip-preset.types';

// Default column visibility — must stay aligned with TripsTable `initialState.columnVisibility`
// (`trips-tables/index.tsx`). Used when deselecting an active preset.
const DEFAULT_COLUMN_VISIBILITY: VisibilityState = {
  net_price: false,
  tax_rate: false,
  reha_schein: false
};

/**
 * Default column order — must stay in lockstep with the `columns` array order in
 * `trips-tables/columns.tsx` (each column’s `id` / definition order). If a column is
 * added, removed, or reordered in `columns.tsx`, update this array the same way.
 */
const DEFAULT_COLUMN_ORDER: string[] = [
  'select',
  'scheduled_at',
  'time',
  'name',
  'pickup_address',
  'dropoff_address',
  'driver_id',
  'status',
  'gross_price',
  'invoice_status',
  'payer_name',
  'fremdfirma',
  'fremdfirma_abrechnung',
  'billing_type',
  'billing_calling_station',
  'billing_betreuer',
  'kts_document_applies',
  'kts_fehler',
  'kts_fehler_beschreibung',
  'reha_schein',
  'net_price',
  'tax_rate',
  'actions'
];

const FILTER_LABELS: Partial<Record<keyof TripPresetParams, string>> = {
  search: 'Suche',
  status: 'Status',
  driver_id: 'Fahrer',
  payer_id: 'Kostenträger',
  billing_variant_id: 'Abrechnung',
  invoice_status: 'Rechnungsstatus',
  scheduled_at: 'Zeitraum',
  sort: 'Sortierung',
  view: 'Ansicht'
};

function countVisibleHidableColumns(visibility: VisibilityState): number {
  let n = 0;
  for (const col of tripsTableColumns) {
    if (col.enableHiding === false) continue;
    const id = String(col.id);
    if (visibility[id] !== false) n++;
  }
  return n;
}

function presetParamsForCompare(raw: unknown): TripPresetParams {
  const e = jsonToParamEntries(raw);
  const out: TripPresetParams = {};
  for (const key of TRIP_PRESET_PARAM_KEYS) {
    const v = e[key];
    if (v != null && v !== '') {
      (out as Record<string, string>)[key] = v;
    }
  }
  return out;
}

/** Full hidable-column signature so partial TanStack state matches DB JSON. */
function canonicalColumnVisibilityForCompare(
  visibility: VisibilityState
): string {
  const out: Record<string, boolean> = {};
  for (const col of tripsTableColumns) {
    if (col.enableHiding === false) continue;
    const id = String(col.id);
    out[id] = visibility[id] !== false;
  }
  const entries = Object.entries(out).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(entries));
}

/** Compare stored order to live table order; legacy / empty presets skip order match. */
function presetColumnOrderMatches(
  storedOrder: Json,
  currentOrder: string[]
): boolean {
  const order = jsonToColumnOrder(storedOrder);
  if (order.length === 0) return true;
  if (currentOrder.length === 0) return true;
  return JSON.stringify(order) === JSON.stringify(currentOrder);
}

/**
 * Active preset = same whitelisted URL params + same column visibility mirror (stable JSON).
 * Intentionally ignores pagination keys — they are never part of stored presets.
 * Reference parity with `activePresetId` memo below (precomputed stable JSON there).
 */
/* eslint-disable @typescript-eslint/no-unused-vars -- Kept in sync with activePresetId memo; not invoked on hot path */
function isPresetActive(
  preset: TripPreset,
  searchParams: ReturnType<typeof useSearchParams>,
  columnVisibility: VisibilityState
): boolean {
  const storedParams = presetParamsForCompare(preset.params);
  const currentParams = buildTripPresetParamsFromSearchParams(searchParams);
  if (stableParamsJson(currentParams) !== stableParamsJson(storedParams)) {
    return false;
  }
  const storedVisCanon = canonicalColumnVisibilityForCompare(
    jsonToVisibilityState(preset.column_visibility)
  );
  const currentVisCanon = canonicalColumnVisibilityForCompare(columnVisibility);
  if (storedVisCanon !== currentVisCanon) {
    return false;
  }
  return true;
}
/* eslint-enable @typescript-eslint/no-unused-vars */

interface SavePresetSubMenuProps {
  disabled: boolean;
  getSnapshot: () => {
    params: TripPresetParams;
    column_visibility: VisibilityState;
    column_order: string[];
  };
  snapshotSummary: { filterPart: string; visN: number };
}

/** Isolated so saveSubOpen / input state do not re-run the parent activePresetId memo or preset list. */
function SavePresetSubMenu({
  disabled,
  getSnapshot,
  snapshotSummary
}: SavePresetSubMenuProps) {
  const [saveSubOpen, setSaveSubOpen] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const saveInputRef = React.useRef<HTMLInputElement>(null);
  const createMutation = useCreateTripPreset();

  React.useEffect(() => {
    if (saveSubOpen) {
      setNewName('');
      setSaveError(null);
      requestAnimationFrame(() => saveInputRef.current?.focus());
    }
  }, [saveSubOpen]);

  const handleSaveSubmit = async () => {
    const name = newName.trim();
    if (!name || name.length > 60) {
      setSaveError('Bitte einen Namen (1–60 Zeichen) eingeben.');
      return;
    }
    const snap = getSnapshot();
    setSaveError(null);
    try {
      await createMutation.mutateAsync({
        name,
        params: snap.params,
        column_visibility: snap.column_visibility,
        column_order: snap.column_order,
        sort_order: 0
      });
      setNewName('');
      setSaveSubOpen(false);
    } catch {
      setSaveError('Speichern fehlgeschlagen. Bitte erneut versuchen.');
    }
  };

  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className='w-full'>
            <DropdownMenuItem disabled className='text-xs'>
              Aktuelle Ansicht speichern
            </DropdownMenuItem>
          </div>
        </TooltipTrigger>
        <TooltipContent side='left'>
          Ansichten sind nur in der Listenansicht verfügbar.
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <DropdownMenuSub open={saveSubOpen} onOpenChange={setSaveSubOpen}>
      <DropdownMenuSubTrigger className='text-xs'>
        Aktuelle Ansicht speichern
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className='w-72 p-3'
        sideOffset={6}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void handleSaveSubmit();
          }
          if (e.key === 'Escape') {
            setSaveSubOpen(false);
          }
        }}
      >
        <div className='space-y-2'>
          <label className='text-xs font-medium' htmlFor='ansicht-name'>
            Name der Ansicht
          </label>
          <Input
            id='ansicht-name'
            ref={saveInputRef}
            value={newName}
            maxLength={60}
            onChange={(e) => setNewName(e.target.value)}
            placeholder='z. B. Einsatzleitung'
            className='h-8 text-xs'
          />
          <div className='text-muted-foreground space-y-1 text-xs'>
            <div className='text-foreground font-medium'>Enthält:</div>
            <div>
              {snapshotSummary.filterPart ? (
                <span>✓ Filter ({snapshotSummary.filterPart})</span>
              ) : (
                <span>✓ Filter (Standard)</span>
              )}
            </div>
            <div>✓ Spalten ({snapshotSummary.visN} sichtbar)</div>
          </div>
          {saveError && <p className='text-destructive text-xs'>{saveError}</p>}
          <div className='flex justify-end pt-1'>
            <Button
              type='button'
              size='sm'
              className='h-7 text-xs'
              disabled={createMutation.isPending || newName.trim() === ''}
              onClick={() => void handleSaveSubmit()}
            >
              Speichern
            </Button>
          </div>
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function AnsichtenDropdown() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { refreshTripsPage } = useTripsRscRefresh();
  const columnVisibility = useTripsTableStore((s) => s.columnVisibility);
  const tripsColumnOrder = useTripsTableStore((s) => s.columnOrder);
  const setPendingColumnVisibility = useTripsTableStore(
    (s) => s.setPendingColumnVisibility
  );
  const setPendingColumnOrder = useTripsTableStore(
    (s) => s.setPendingColumnOrder
  );

  const currentView = searchParams.get('view') ?? 'list';

  const { data: presets = [], isLoading } = useTripPresets();
  const applyPreset = useApplyTripPreset();
  const getSnapshot = useCurrentTripViewSnapshot(
    searchParams,
    columnVisibility,
    tripsColumnOrder
  );
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const resetToDefault = React.useCallback(() => {
    const params = new URLSearchParams();
    params.set('view', 'list');
    params.set('page', '1');
    params.set('scheduled_at', todayYmdInBusinessTz());
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    void refreshTripsPage();
    const tbl = useTripsTableStore.getState().table;
    if (tbl !== null) {
      tbl.setColumnVisibility(DEFAULT_COLUMN_VISIBILITY);
      tbl.setColumnOrder(DEFAULT_COLUMN_ORDER);
    } else {
      setPendingColumnVisibility(DEFAULT_COLUMN_VISIBILITY);
      setPendingColumnOrder(DEFAULT_COLUMN_ORDER);
    }
  }, [
    router,
    pathname,
    refreshTripsPage,
    setPendingColumnVisibility,
    setPendingColumnOrder
  ]);

  const snapshotSummary = React.useMemo(() => {
    const params = buildTripPresetParamsFromSearchParams(searchParams);
    const filterKeys = Object.keys(params).filter(
      (k) => params[k as keyof TripPresetParams]
    );
    const filterPart =
      filterKeys.length > 0
        ? filterKeys
            .map((k) => FILTER_LABELS[k as keyof TripPresetParams] ?? k)
            .join(', ')
        : '';
    const visN = countVisibleHidableColumns(columnVisibility);
    return { filterPart, visN };
  }, [searchParams, columnVisibility]);

  const activePresetId = React.useMemo(() => {
    if (!presets?.length) return null;
    const currentParamsJson = stableParamsJson(
      buildTripPresetParamsFromSearchParams(searchParams)
    );
    const currentVisJson =
      canonicalColumnVisibilityForCompare(columnVisibility);
    return (
      presets.find((preset) => {
        const paramsMatch =
          stableParamsJson(presetParamsForCompare(preset.params)) ===
          currentParamsJson;
        const visMatch =
          canonicalColumnVisibilityForCompare(
            jsonToVisibilityState(preset.column_visibility)
          ) === currentVisJson;
        const orderMatch = presetColumnOrderMatches(
          preset.column_order,
          tripsColumnOrder
        );
        return paramsMatch && visMatch && orderMatch;
      })?.id ?? null
    );
  }, [presets, searchParams, columnVisibility, tripsColumnOrder]);

  return (
    <TooltipProvider delayDuration={0}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='h-9 shrink-0 gap-1'
            disabled={isLoading}
          >
            Ansichten
            <ChevronDown className='size-4 opacity-60' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-56'>
          <DropdownMenuLabel className='text-muted-foreground text-[10px] font-normal tracking-wide uppercase'>
            Gespeicherte Ansichten
          </DropdownMenuLabel>
          <DropdownMenuGroup>
            {presets.length === 0 && (
              <div className='text-muted-foreground px-2 py-1.5 text-xs'>
                Keine Ansichten gespeichert.
              </div>
            )}
            {presets.map((preset) => {
              const active = preset.id === activePresetId;
              return (
                <DropdownMenuItem
                  key={preset.id}
                  className='gap-2 text-xs'
                  onSelect={() => {
                    if (active) {
                      resetToDefault();
                    } else {
                      applyPreset(preset);
                    }
                  }}
                >
                  <span className='shrink-0' aria-hidden>
                    {active ? '●' : '○'}
                  </span>
                  <span className='min-w-0 truncate'>{preset.name}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <SavePresetSubMenu
            disabled={currentView === 'kanban'}
            getSnapshot={getSnapshot}
            snapshotSummary={snapshotSummary}
          />

          <DropdownMenuItem
            className='text-xs'
            onSelect={() => setSheetOpen(true)}
          >
            Ansichten verwalten
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AnsichtenSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        getSnapshot={getSnapshot}
      />
    </TooltipProvider>
  );
}
