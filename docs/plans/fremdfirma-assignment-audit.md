# Fremdfirma Assignment Audit

## 1. Trip Data Model

### Canonical exported Trip type

`src/features/trips/api/trips.service.ts` defines `Trip` as an alias to the generated Supabase row type:

```ts
export type Trip = Database['public']['Tables']['trips']['Row'];
export type InsertTrip = Database['public']['Tables']['trips']['Insert'];
export type UpdateTrip = Database['public']['Tables']['trips']['Update'];
```

`src/features/unassigned-trips/types/unassigned-trips.types.ts` repeats the same alias locally:

```ts
export type Trip = Database['public']['Tables']['trips']['Row'];
```

### Full generated `trips` row type

From `src/types/database.types.ts`:

```ts
trips: {
  Row: {
    actual_dropoff_at: string | null;
    actual_pickup_at: string | null;
    billing_betreuer: string | null;
    billing_calling_station: string | null;
    billing_variant_id: string | null;
    kts_document_applies: boolean;
    kts_fehler: boolean;
    kts_fehler_beschreibung: string | null;
    kts_handover_id: string | null;
    kts_patient_id: string | null;
    kts_belegnummer: string | null;
    kts_invoice_amount: number | null;
    kts_eigenanteil: number | null;
    kts_external_invoice_id: string | null;
    kts_source: string | null;
    kts_status: Database['public']['Enums']['kts_status'] | null;
    reha_schein: boolean;
    fremdfirma_cost: number | null;
    fremdfirma_id: string | null;
    fremdfirma_payment_mode: string | null;
    no_invoice_required: boolean;
    no_invoice_source: string | null;
    selbstzahler_collected_amount: number | null;
    client_id: string | null;
    client_name: string | null;
    client_phone: string | null;
    company_id: string | null;
    created_at: string | null;
    created_by: string | null;
    driver_id: string | null;
    dropoff_address: string | null;
    dropoff_lat: number | null;
    dropoff_lng: number | null;
    dropoff_city: string | null;
    dropoff_street: string | null;
    dropoff_street_number: string | null;
    dropoff_zip_code: string | null;
    driving_distance_km: number | null;
    driving_duration_seconds: number | null;
    dropoff_location: Json | null;
    dropoff_station: string | null;
    dropoff_place_id: string | null;
    greeting_style: string | null;
    has_missing_geodata: boolean;
    group_id: string | null;
    id: string;
    ingestion_source: string | null;
    is_wheelchair: boolean;
    link_type: string | null;
    linked_trip_id: string | null;
    note: string | null;
    notes: string | null;
    needs_driver_assignment: boolean;
    canceled_reason_notes: string | null;
    payer_id: string | null;
    payment_method: string | null;
    pickup_address: string | null;
    pickup_lat: number | null;
    pickup_lng: number | null;
    pickup_city: string | null;
    pickup_street: string | null;
    pickup_street_number: string | null;
    pickup_zip_code: string | null;
    pickup_location: Json | null;
    pickup_station: string | null;
    pickup_place_id: string | null;
    /** Generated STORED: COALESCE(base_net_price,0)+COALESCE(approach_fee_net,0). Read-only; omit from writes. */
    net_price: number;
    gross_price: number | null;
    tax_rate: number | null;
    base_net_price: number | null;
    approach_fee_net: number | null;
    manual_distance_km: number | null;
    manual_gross_price: number | null;
    manual_tax_rate: number | null;
    billing_type_id: string | null;
    requested_date: string | null;
    return_status: string | null;
    rule_id: string | null;
    scheduled_at: string | null;
    status: string;
    stop_order: number | null;
    stop_updates: Json;
    vehicle_id: string | null;
  };
  Insert: {
    actual_dropoff_at?: string | null;
    actual_pickup_at?: string | null;
    billing_betreuer?: string | null;
    billing_calling_station?: string | null;
    billing_variant_id?: string | null;
    kts_document_applies?: boolean;
    kts_fehler?: boolean;
    kts_fehler_beschreibung?: string | null;
    kts_handover_id?: string | null;
    kts_patient_id?: string | null;
    kts_belegnummer?: string | null;
    kts_invoice_amount?: number | null;
    kts_eigenanteil?: number | null;
    kts_external_invoice_id?: string | null;
    kts_source?: string | null;
    kts_status?: Database['public']['Enums']['kts_status'] | null;
    reha_schein?: boolean;
    fremdfirma_cost?: number | null;
    fremdfirma_id?: string | null;
    fremdfirma_payment_mode?: string | null;
    no_invoice_required?: boolean;
    no_invoice_source?: string | null;
    selbstzahler_collected_amount?: number | null;
    client_id?: string | null;
    client_name?: string | null;
    client_phone?: string | null;
    company_id?: string | null;
    created_at?: string | null;
    created_by?: string | null;
    driver_id?: string | null;
    dropoff_address?: string | null;
    dropoff_lat?: number | null;
    dropoff_lng?: number | null;
    dropoff_city?: string | null;
    dropoff_street?: string | null;
    dropoff_street_number?: string | null;
    dropoff_zip_code?: string | null;
    driving_distance_km?: number | null;
    driving_duration_seconds?: number | null;
    dropoff_location?: Json | null;
    dropoff_station?: string | null;
    dropoff_place_id?: string | null;
    greeting_style?: string | null;
    has_missing_geodata?: boolean;
    group_id?: string | null;
    id?: string;
    ingestion_source?: string | null;
    is_wheelchair?: boolean;
    link_type?: string | null;
    linked_trip_id?: string | null;
    note?: string | null;
    notes?: string | null;
    needs_driver_assignment?: boolean;
    canceled_reason_notes?: string | null;
    payer_id?: string | null;
    payment_method?: string | null;
    pickup_address?: string | null;
    pickup_lat?: number | null;
    pickup_lng?: number | null;
    pickup_city?: string | null;
    pickup_street?: string | null;
    pickup_street_number?: string | null;
    pickup_zip_code?: string | null;
    pickup_location?: Json | null;
    pickup_station?: string | null;
    pickup_place_id?: string | null;
    gross_price?: number | null;
    tax_rate?: number | null;
    base_net_price?: number | null;
    approach_fee_net?: number | null;
    manual_distance_km?: number | null;
    manual_gross_price?: number | null;
    manual_tax_rate?: number | null;
    billing_type_id?: string | null;
    requested_date?: string | null;
    return_status?: string | null;
    rule_id?: string | null;
    scheduled_at?: string | null;
    status: string;
    stop_order?: number | null;
    stop_updates?: Json;
    vehicle_id?: string | null;
  };
  Update: {
    actual_dropoff_at?: string | null;
    actual_pickup_at?: string | null;
    billing_betreuer?: string | null;
    billing_calling_station?: string | null;
    billing_variant_id?: string | null;
    kts_document_applies?: boolean;
    kts_fehler?: boolean;
    kts_fehler_beschreibung?: string | null;
    kts_handover_id?: string | null;
    kts_patient_id?: string | null;
    kts_belegnummer?: string | null;
    kts_invoice_amount?: number | null;
    kts_eigenanteil?: number | null;
    kts_external_invoice_id?: string | null;
    kts_source?: string | null;
    kts_status?: Database['public']['Enums']['kts_status'] | null;
    reha_schein?: boolean;
    fremdfirma_cost?: number | null;
    fremdfirma_id?: string | null;
    fremdfirma_payment_mode?: string | null;
    no_invoice_required?: boolean;
    no_invoice_source?: string | null;
    selbstzahler_collected_amount?: number | null;
    client_id?: string | null;
    client_name?: string | null;
    client_phone?: string | null;
    company_id?: string | null;
    created_at?: string | null;
    created_by?: string | null;
    driver_id?: string | null;
    dropoff_address?: string | null;
    dropoff_lat?: number | null;
    dropoff_lng?: number | null;
    driving_distance_km?: number | null;
    driving_duration_seconds?: number | null;
    dropoff_location?: Json | null;
    dropoff_station?: string | null;
    dropoff_place_id?: string | null;
    greeting_style?: string | null;
    has_missing_geodata?: boolean;
    group_id?: string | null;
    id?: string;
    ingestion_source?: string | null;
    is_wheelchair?: boolean;
    link_type?: string | null;
    linked_trip_id?: string | null;
    note?: string | null;
    notes?: string | null;
    needs_driver_assignment?: boolean;
    canceled_reason_notes?: string | null;
    payer_id?: string | null;
    payment_method?: string | null;
    pickup_address?: string | null;
    pickup_lat?: number | null;
    pickup_lng?: number | null;
    pickup_location?: Json | null;
    pickup_station?: string | null;
    pickup_place_id?: string | null;
    gross_price?: number | null;
    tax_rate?: number | null;
    base_net_price?: number | null;
    approach_fee_net?: number | null;
    manual_distance_km?: number | null;
    manual_gross_price?: number | null;
    manual_tax_rate?: number | null;
    billing_type_id?: string | null;
    requested_date?: string | null;
    return_status?: string | null;
    rule_id?: string | null;
    scheduled_at?: string | null;
    status?: string;
    stop_order?: number | null;
    stop_updates?: Json;
    vehicle_id?: string | null;
  };
  Relationships: [
    {
      foreignKeyName: 'trips_billing_variant_id_fkey';
      columns: ['billing_variant_id'];
      isOneToOne: false;
      referencedRelation: 'billing_variants';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'trips_billing_type_id_fkey';
      columns: ['billing_type_id'];
      isOneToOne: false;
      referencedRelation: 'billing_types';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'trips_client_id_fkey';
      columns: ['client_id'];
      isOneToOne: false;
      referencedRelation: 'clients';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'trips_company_id_fkey';
      columns: ['company_id'];
      isOneToOne: false;
      referencedRelation: 'companies';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'trips_created_by_fkey';
      columns: ['created_by'];
      isOneToOne: false;
      referencedRelation: 'accounts';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'trips_driver_id_fkey';
      columns: ['driver_id'];
      isOneToOne: false;
      referencedRelation: 'accounts';
      referencedColumns: ['id'];
    },
    {
      foreignKeyName: 'trips_fremdfirma_id_fkey';
      columns: ['fremdfirma_id'];
      isOneToOne: false;
      referencedRelation: 'fremdfirmen';
      referencedColumns: ['id'];
    }
  ];
};
```

### Assignment-related fields

- `driver_id: string | null` references `accounts.id` through `trips_driver_id_fkey`. `null` means no internal driver is assigned. In current Fremdfirma flow it is also intentionally `null` when `fremdfirma_id` is set.
- `fremdfirma_id: string | null` references `fremdfirmen.id` through `trips_fremdfirma_id_fkey`. `null` means no external company is assigned.
- `fremdfirma_payment_mode: string | null` stores how the external company is paid. It is null when no Fremdfirma assignment exists.
- `fremdfirma_cost: number | null` stores optional external cost for cost-bearing payment modes. It is null for no Fremdfirma, self-payer, and KTS-to-Fremdfirma modes.
- `needs_driver_assignment: boolean` is used as an assignment-needed flag. Fremdfirma assignment sets it to `false`.
- `status: string` is derived in places from `driver_id` and partially from `fremdfirma_id`. A Fremdfirma trip can be `assigned` even with `driver_id = null`.
- Joined embeds used by consumers are not part of `Trip` itself but are commonly selected as `driver:accounts!trips_driver_id_fkey(name)` and `fremdfirma:fremdfirmen(id, name, default_payment_mode)`.

The type does not express assignment as a discriminated union. It is two independent nullable foreign keys plus related scalar metadata. There is no type-level invariant preventing both IDs from being present or both being null.

## 2. Fremdfirma Data Model

### Canonical exported Fremdfirma type

`src/features/fremdfirmen/api/fremdfirmen.service.ts`:

```ts
export type FremdfirmaRow = Database['public']['Tables']['fremdfirmen']['Row'];
export type FremdfirmaInsert =
  Database['public']['Tables']['fremdfirmen']['Insert'];
export type FremdfirmaUpdate =
  Database['public']['Tables']['fremdfirmen']['Update'];
```

### Full generated `fremdfirmen` table type

From `src/types/database.types.ts`:

```ts
fremdfirmen: {
  Row: {
    company_id: string;
    created_at: string;
    default_payment_mode: string;
    id: string;
    is_active: boolean;
    name: string;
    number: string | null;
    sort_order: number;
  };
  Insert: {
    company_id: string;
    created_at?: string;
    default_payment_mode?: string;
    id?: string;
    is_active?: boolean;
    name: string;
    number?: string | null;
    sort_order?: number;
  };
  Update: {
    company_id?: string;
    created_at?: string;
    default_payment_mode?: string;
    id?: string;
    is_active?: boolean;
    name?: string;
    number?: string | null;
    sort_order?: number;
  };
  Relationships: [
    {
      foreignKeyName: 'fremdfirmen_company_id_fkey';
      columns: ['company_id'];
      isOneToOne: false;
      referencedRelation: 'companies';
      referencedColumns: ['id'];
    }
  ];
};
```

### Supabase table and Trip link

- Supabase table name: `fremdfirmen`.
- Trip foreign key field: `trips.fremdfirma_id`.
- Generated relationship: `trips_fremdfirma_id_fkey`, `columns: ['fremdfirma_id']`, `referencedRelation: 'fremdfirmen'`, `referencedColumns: ['id']`.
- Recurring rules also have `recurring_rules.fremdfirma_id`, and `src/lib/recurring-trip-generator.ts` copies those fields onto generated trips.

Reference option type in `src/features/trips/types/trip-form-reference.types.ts`:

```ts
export type FremdfirmaPaymentMode =
  | 'cash_per_trip'
  | 'monthly_invoice'
  | 'self_payer'
  | 'kts_to_fremdfirma';

export interface FremdfirmaOption {
  id: string;
  name: string;
  number: string | null;
  default_payment_mode: FremdfirmaPaymentMode;
}
```

## 3. Current Assignment Logic

### Shared status helper

There is a status helper, but there is no full assignee resolver that returns "driver vs Fremdfirma vs unassigned".

`src/features/trips/lib/trip-status.ts` full implementation:

```ts
/**
 * Derives the trip status to set when driver_id changes, so UI and backend stay in sync
 * (e.g. "Offen" -> "Zugewiesen" when a driver is assigned, and back when unassigned).
 * Use this wherever trips are updated with a new driver_id (table cell, kanban, create form).
 *
 * @param currentStatus - Current trip status (e.g. 'pending', 'assigned')
 * @param newDriverId - The driver_id being set (string) or null when unassigning
 * @returns The status to set, or undefined if no change is needed
 */
export function getStatusWhenDriverChanges(
  currentStatus: string,
  newDriverId: string | null,
  options?: { fremdfirmaId?: string | null }
): string | undefined {
  if (newDriverId != null && newDriverId !== '') {
    if (currentStatus === 'pending') return 'assigned';
    return undefined;
  }
  // Trip is still "assigned" to an external company even without driver_id.
  if (options?.fremdfirmaId) {
    return undefined;
  }
  if (currentStatus === 'assigned') return 'pending';
  return undefined;
}
```

This helper is only status derivation. It does not resolve a displayable assignee.

### Fremdfirma assignment in trip detail

`src/features/fremdfirmen/components/trip-fremdfirma-section.tsx` contains the Fremdfirma assignment/unassignment logic. Relevant implementation:

```ts
const applyFremdfirmaPayload = (next: {
  fremdfirma_id: string | null;
  fremdfirma_payment_mode: FremdfirmaPaymentMode | null;
  fremdfirma_cost: number | null;
}) => {
  const payload: Record<string, unknown> = {
    fremdfirma_id: next.fremdfirma_id,
    fremdfirma_payment_mode: next.fremdfirma_payment_mode,
    fremdfirma_cost: next.fremdfirma_cost,
    driver_id: next.fremdfirma_id ? null : trip.driver_id,
    needs_driver_assignment: next.fremdfirma_id
      ? false
      : !(trip.driver_id ?? null)
  };
  const derived = getStatusWhenDriverChanges(
    trip.status,
    next.fremdfirma_id ? null : (trip.driver_id ?? null),
    { fremdfirmaId: next.fremdfirma_id }
  );
  if (derived) payload.status = derived;
  return payload;
};
```

Saving a selected vendor and mode:

```ts
const saveVendorAndMode = () => {
  if (!vendorId || !paymentMode) {
    toast.error('Fremdfirma und Abrechnungsart wählen');
    return;
  }
  runWithRecurringScope(async () => {
    await persist(
      applyFremdfirmaPayload({
        fremdfirma_id: vendorId,
        fremdfirma_payment_mode: paymentMode,
        fremdfirma_cost: showCostField ? parseCost(costStr) : null
      })
    );
  });
};
```

Toggling off clears external assignment:

```ts
if (!on) {
  paymentUserPickedRef.current = false;
  if (trip.fremdfirma_id) {
    setFremdOn(false);
    setVendorId('');
    setPaymentMode('');
    setCostStr('');
    await persist(
      applyFremdfirmaPayload({
        fremdfirma_id: null,
        fremdfirma_payment_mode: null,
        fremdfirma_cost: null
      })
    );
    return;
  }
  setFremdOn(false);
  setVendorId('');
  setPaymentMode('');
  setCostStr('');
  return;
}
```

Important behavior: assigning a Fremdfirma clears `driver_id`, sets `needs_driver_assignment` false, and keeps/derives assigned status through `getStatusWhenDriverChanges(..., { fremdfirmaId })`.

### Driver assignment in trip detail

`src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` handles driver assignment:

```ts
const handleDriverChange = async (driverId: string) => {
  if (!trip) return;
  const exec = async () => {
    setIsUpdatingDriver(true);
    try {
      const newDriverId = driverId === 'unassigned' ? null : driverId;
      const payload: { driver_id: string | null; status?: string } = {
        driver_id: newDriverId
      };
      const derivedStatus = getStatusWhenDriverChanges(
        trip.status,
        newDriverId,
        { fremdfirmaId: trip.fremdfirma_id }
      );
      if (derivedStatus) payload.status = derivedStatus;
      await tripsService.updateTrip(trip.id, payload);
      toast.success('Fahrer aktualisiert');
      void queryClient.invalidateQueries({
        queryKey: tripKeys.detail(trip.id)
      });
      void queryClient.invalidateQueries({ queryKey: tripKeys.all });
      await refreshAfterTripSave();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(`Fehler beim Zuweisen des Fahrers: ${msg}`);
    } finally {
      setIsUpdatingDriver(false);
    }
  };
  runWithRecurringScope(exec);
};
```

The detail-sheet driver select is disabled while a Fremdfirma is assigned:

```tsx
<Select
  value={trip.driver_id || 'unassigned'}
  onValueChange={handleDriverChange}
  disabled={isUpdatingDriver || !!trip.fremdfirma_id}
>
```

### Driver assignment in `/fahrten` table

`src/features/trips/components/trips-tables/driver-select-cell.tsx` updates `driver_id` directly:

```ts
const handleChange = async (value: string) => {
  const newDriverId = value === 'unassigned' ? null : value;
  if (newDriverId === selectedDriverId) return;

  setIsUpdating(true);

  const payload: { driver_id: string | null; status?: string } = {
    driver_id: newDriverId
  };
  const derivedStatus = getStatusWhenDriverChanges(trip.status, newDriverId, {
    fremdfirmaId: trip.fremdfirma_id
  });
  if (derivedStatus) payload.status = derivedStatus;

  const supabase = createClient();

  try {
    if (trip.group_id) {
      const { error } = await supabase
        .from('trips')
        .update(payload)
        .eq('group_id', trip.group_id);

      if (error) throw error;
      toast.success('Fahrer für die Gruppe aktualisiert');
    } else {
      const { error } = await supabase
        .from('trips')
        .update(payload)
        .eq('id', trip.id);

      if (error) throw error;
      toast.success('Fahrer aktualisiert');
    }

    setSelectedDriverId(newDriverId);
    void refreshTripsPage();
  } catch (error: any) {
    toast.error(
      `Fehler beim Zuweisen des Fahrers: ${
        error?.message ?? 'Unbekannter Fehler'
      }`
    );
  } finally {
    setIsUpdating(false);
  }
};
```

But if `trip.fremdfirma_id` is set, the cell does not render a select:

```tsx
if (trip.fremdfirma_id) {
  return (
    <span
      className='max-w-[11rem] text-center text-xs leading-tight font-medium'
      title='Abrechnungsart siehe Spalte „Abrechnung Fremdfirma“'
    >
      Extern · {trip.fremdfirma?.name ?? 'Fremdfirma'}
    </span>
  );
}
```

### Kanban assignment

`src/features/trips/lib/kanban-columns.ts` groups by `driver_id` only:

```ts
const columnId =
  groupBy === 'driver'
    ? (trip.driver_id ?? 'unassigned')
    : groupBy === 'status'
      ? trip.status
      : (trip.payer_id ?? 'no_payer');
```

`src/features/trips/components/kanban/kanban-board.tsx` stages driver assignment on drag:

```ts
if (groupBy === 'driver') {
  const newDriverId = value as string | null;
  current.driver_id = newDriverId;
  const derivedStatus = deriveStatusForPending(
    id,
    newDriverId,
    prev,
    trips
  );
  if (derivedStatus !== undefined) current.status = derivedStatus;
}
```

Save path passes Fremdfirma context to status derivation:

```ts
const status =
  change.status ??
  (change.driver_id !== undefined
    ? getStatusWhenDriverChanges(
        trip?.status ?? 'pending',
        change.driver_id,
        { fremdfirmaId: trip?.fremdfirma_id }
      )
    : undefined);
```

But `deriveStatusForPending` itself does not pass `fremdfirmaId`:

```ts
export function deriveStatusForPending(
  tripId: string,
  newDriverId: string | null | undefined,
  pendingChanges: Record<string, PendingChange>,
  serverTrips: KanbanTrip[]
): string | undefined {
  if (newDriverId === undefined) return undefined;
  const serverStatus =
    serverTrips.find((t) => t.id === tripId)?.status ?? 'pending';
  const currentStatus = pendingChanges[tripId]?.status ?? serverStatus;
  return (
    getStatusWhenDriverChanges(currentStatus, newDriverId) ?? currentStatus
  );
}
```

### Recurring trip generation

`src/lib/recurring-trip-generator.ts` materializes recurring-rule Fremdfirma settings into trips:

```ts
const hasFremdfirma = !!rule.fremdfirma_id;

const payload: TripInsert = {
  company_id: client.company_id,
  client_id: client.id,
  client_name: clientName || '',
  client_phone: client.phone || '',
  payer_id: rule.payer_id,
  billing_variant_id: rule.billing_variant_id,
  kts_document_applies: rule.kts_document_applies ?? false,
  reha_schein: rule.reha_schein ?? false,
  kts_source: rule.kts_source ?? null,
  no_invoice_required: rule.no_invoice_required ?? false,
  no_invoice_source: rule.no_invoice_source ?? null,
  fremdfirma_id: rule.fremdfirma_id ?? null,
  fremdfirma_payment_mode: rule.fremdfirma_payment_mode ?? null,
  fremdfirma_cost: rule.fremdfirma_cost ?? null,
  ...(hasFremdfirma
    ? {
        driver_id: null,
        needs_driver_assignment: false,
        status: 'assigned' as const
      }
    : { status: 'pending' as const }),
  // ...
};
```

### No assignee resolver exists

No helper/hook currently returns a canonical assigned entity like:

```ts
{ kind: 'driver'; id; label } | { kind: 'fremdfirma'; id; label } | { kind: 'unassigned' }
```

Each consumer decides locally:

- Detail sheet disables driver select when `!!trip.fremdfirma_id`.
- `TripFremdfirmaSection` clears `driver_id` when assigning a Fremdfirma.
- Table `DriverSelectCell` renders `Extern · ...` if `trip.fremdfirma_id`.
- Table server filtering and dashboard widgets still use `driver_id` null checks.
- Kanban grouping still uses `trip.driver_id ?? 'unassigned'`.
- Controlling receives pre-aggregated `driver_id` and separate `fremdfirma_*` metrics from RPCs, then renders driver charts by `driver_id`.

## 4. Fahrten Table — Current State

### Columns for assignment display

`src/features/trips/components/trips-tables/columns.tsx` has assignment-related columns:

- `driver_id`, title `Fahrer`, renders `DriverSelectCell`.
- `fremdfirma`, title `Fremdfirma`, renders joined `row.original.fremdfirma.name` or `—`.
- `fremdfirma_abrechnung`, title `Abrechnung Fremdfirma`, renders a badge from `fremdfirma_payment_mode` when `fremdfirma_id` is set.

Relevant column definitions:

```tsx
{
  id: 'driver_id',
  accessorKey: 'driver.name',
  header: ({ column }) => (
    <DataTableColumnHeader column={column} title='Fahrer' />
  ),
  cell: ({ row }) => (
    <div className='flex justify-center px-1'>
      <DriverSelectCell trip={row.original} />
    </div>
  ),
  enableColumnFilter: false,
  meta: { label: 'Fahrer' }
},
{
  id: 'fremdfirma',
  accessorFn: (row) =>
    (
      row.fremdfirma as { name?: string | null } | null | undefined
    )?.name?.trim() ?? '',
  header: ({ column }) => (
    <DataTableColumnHeader column={column} title='Fremdfirma' />
  ),
  cell: ({ row }) => {
    const name = (
      row.original.fremdfirma as { name?: string | null } | null | undefined
    )?.name?.trim();
    return (
      <div className='flex justify-center px-1'>
        {!name ? (
          <span className='text-muted-foreground'>—</span>
        ) : (
          <span
            className='max-w-[160px] truncate text-center text-sm font-medium'
            title={name}
          >
            {name}
          </span>
        )}
      </div>
    );
  },
  meta: { label: 'Fremdfirma', variant: 'text' },
  enableColumnFilter: false,
  enableSorting: false
},
{
  id: 'fremdfirma_abrechnung',
  accessorFn: (row) => row.fremdfirma_payment_mode ?? '',
  header: ({ column }) => (
    <DataTableColumnHeader column={column} title='Abrechnung Fremdfirma' />
  ),
  cell: ({ row }) => {
    if (!row.original.fremdfirma_id) {
      return (
        <div className='flex justify-center px-1'>
          <span className='text-muted-foreground'>—</span>
        </div>
      );
    }
    const label = fremdfirmaPaymentModeLabel(
      row.original.fremdfirma_payment_mode as string | null | undefined
    );
    return (
      <div className='flex justify-center px-1'>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant='secondary'
                className='h-5 w-fit max-w-full truncate px-1.5 py-0 text-[10px] font-normal'
              >
                {label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side='top' className='text-xs'>
              Abrechnung Fremdfirma: {label}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  },
  meta: { label: 'Abrechnung Fremdfirma', variant: 'text' },
  enableColumnFilter: false,
  enableSorting: false
}
```

`src/features/trips/components/ansichten-sheet.tsx` and `src/features/trips/components/ansichten-dropdown.tsx` both know about `fremdfirma` and `fremdfirma_abrechnung` as configurable columns.

### Server query

`src/features/trips/components/trips-listing.tsx` selects both joins:

```ts
const tripsListSelect = `
  *,
  payer:payers(name, reha_schein_enabled),
  billing_variant:billing_variants(name, code, billing_types(name, color)),
  driver:accounts!trips_driver_id_fkey(name),
  fremdfirma:fremdfirmen(id, name, default_payment_mode)
`;
```

The Kanban query also selects `fremdfirma`.

### Current filters

There is no Fremdfirma filter in `src/lib/searchparams.ts`, `src/features/trips/components/trips-filters-bar.tsx`, or `src/features/trips/components/trips-listing.tsx`.

The `/fahrten` filters currently support:

- `search`
- `scheduled_at`
- `driver_id`, including `all` and `unassigned`
- `status`
- `payer_id` multi-select
- `billing_variant_id` multi-select
- `invoice_status`
- `kts_filter`
- pagination and sort params
- `view`

Driver filter UI:

```ts
const driverOptions = useMemo(
  () => [
    { label: 'Alle Fahrer', value: 'all' },
    { label: 'Nicht zugewiesen', value: 'unassigned' },
    ...drivers.map((d) => ({ label: d.name, value: d.id }))
  ],
  [drivers]
);
```

Server driver filter:

```ts
if (driverId && driverId !== 'all') {
  if (driverId === 'unassigned') {
    query = query.is('driver_id', null);
  } else {
    query = query.eq('driver_id', driverId);
  }
}
```

This means `driver_id=unassigned` currently includes Fremdfirma trips, because those trips intentionally have `driver_id = null`.

### Row behavior when `driver_id` is null but `fremdfirma_id` is set

In the table, this does not render blank or error. `DriverSelectCell` detects `trip.fremdfirma_id` and renders:

```tsx
Extern · {trip.fremdfirma?.name ?? 'Fremdfirma'}
```

The separate `Fremdfirma` column shows the company name, and `Abrechnung Fremdfirma` shows the payment mode label. So display is partially correct, but filtering/grouping still treats the row as unassigned because `driver_id` is null.

## 5. Dashboard Widgets — Current State

### `pending-tours-widget.tsx`

`src/features/dashboard/components/pending-tours-widget.tsx` uses `useUnplannedTrips(filter)`.

The query is in `src/features/dashboard/hooks/use-unplanned-trips.ts`:

```ts
const { data: unplannedRows, error: fetchError } = await supabase
  .from('trips')
  .select('*, requested_date')
  .or('scheduled_at.is.null,driver_id.is.null')
  .not('status', 'in', '("cancelled","completed")')
  .order('created_at', { ascending: false });
```

This query treats every trip with `driver_id IS NULL` as unplanned, regardless of `fremdfirma_id`. Because Fremdfirma assignment clears `driver_id`, externally assigned trips with a time will show as "without driver" unless excluded by status/date tab filtering.

The widget description counts no-driver trips by `driver_id` only:

```ts
const noDriver = trips.filter(
  (t) => t.scheduled_at && !t.driver_id
).length;
```

The row default also uses only `driver_id`:

```ts
return {
  dateStr,
  time,
  driverId: trip.driver_id ?? null
};
```

When saving a row, it writes `driver_id` and passes `fremdfirmaId` only to status derivation:

```ts
const updatePayload: Parameters<typeof tripsService.updateTrip>[1] = {
  scheduled_at: scheduledAtIso,
  driver_id: driverId
};
const derivedStatus = getStatusWhenDriverChanges(trip.status, driverId, {
  fremdfirmaId: trip.fremdfirma_id
});
if (derivedStatus) updatePayload.status = derivedStatus;
```

There is no visual distinction for Fremdfirma trips in this widget: no badge, label, different color, Fremdfirma select, or exclusion.

Classification: incomplete/broken for Fremdfirma assignment. It will surface external trips as "Ohne Fahrer" because it defines unplanned as `driver_id IS NULL`.

### `timeless-rule-trips-widget.tsx`

`src/features/dashboard/components/timeless-rule-trips-widget.tsx` uses `useTimelessRuleTrips`.

`src/features/dashboard/hooks/use-timeless-rule-trips.ts` fetches rule-generated trips without `scheduled_at`:

```ts
const { data: rowsRaw, error } = await supabase
  .from('trips')
  .select(`*, requested_date, ${TIMELESS_TRIP_EMBEDS}`)
  .not('rule_id', 'is', null)
  .is('scheduled_at', null)
  .in('requested_date', [todayYmd, tomorrowYmd])
  .not('status', 'in', '("cancelled","completed")');
```

Partner rows include `driver_id`, but the widget only sets times:

```ts
// No driver assignment and no status mutation here: the widget only confirms a time.
await tripsService.updateTrip(e.trip.id, {
  scheduled_at: scheduledAtIso
});
```

It does not select or render `fremdfirma_id`, `fremdfirma`, or any assignee badge. For Fremdfirma recurring rules, this is likely acceptable if the widget's responsibility is only time confirmation, but it is incomplete for visual distinction.

### `expiring-rules-banner.tsx`

`src/features/dashboard/components/expiring-rules-banner.tsx` and `src/features/dashboard/hooks/use-expiring-recurring-rules.ts` do not reference trip assignment. They only list active recurring rules by `end_date`.

### Other dashboard assignment references

- `src/features/dashboard/hooks/use-unplanned-trips.ts`: broken/incomplete for Fremdfirma because `driver_id IS NULL` means both truly unassigned and externally assigned.
- `src/features/dashboard/hooks/use-timeless-rule-trips.ts`: incomplete if assignment display is required; no distinction.
- `src/features/dashboard/components/pending-tours-widget.tsx`: broken/incomplete for Fremdfirma as described above.
- `src/features/dashboard/components/timeless-rule-trips-widget.tsx`: incomplete display only; not directly wrong for save behavior.

## 6. Other Consumers — Per-File Findings

### `src/features/driver-planning`

No `fremdfirma`, `fremdfirmen`, `fremdfirma_id`, or `assignee` references were found.

References to `driver_id` are planning-domain references to `driver_day_plans`, not trip assignment:

```ts
.eq('driver_id', driverId)
.order('driver_id', { ascending: true })
```

`src/features/driver-planning/types.ts` defines `DriverDayPlanRow`, `PlanningDriverListItem`, and `UpsertDayPlanPayload` around drivers only. Classification: correct/irrelevant for TripAssignee. This feature plans internal driver work days and does not consume trip assignment.

### `src/features/controlling/components/OperationalFlags.tsx`

Relevant lines:

```ts
if (totals.unassigned_trips > 0) {
  flags.push(`Fahrten ohne Fahrer: ${totals.unassigned_trips}`);
}
if (totals.fremdfirma_trips > 0) {
  flags.push(
    `Fremdfirma-Fahrten: ${totals.fremdfirma_trips} (Kosten: ${formatEuro(totals.fremdfirma_cost)})`
  );
}
```

Classification: ambiguous/incomplete. It has separate Fremdfirma counts, but correctness depends on the RPC definition of `unassigned_trips`. If the RPC counts `driver_id IS NULL` without excluding `fremdfirma_id IS NOT NULL`, the UI will report Fremdfirma trips as "Fahrten ohne Fahrer" and also as Fremdfirma trips.

### `src/features/controlling/api/controlling.service.ts`

Relevant mapping:

```ts
unassigned_trips: Number(row.unassigned_trips),
fremdfirma_trips: Number(row.fremdfirma_trips),
fremdfirma_cost: Number(row.fremdfirma_cost)
```

Breakdown mapping only has driver identity:

```ts
driver_id: row.driver_id == null ? null : String(row.driver_id),
driver_name: row.driver_name == null ? null : String(row.driver_name),
```

Classification: incomplete at the TS layer for assignee abstraction. It preserves the RPC shape but has no way to represent external assignees in driver breakdowns.

### `src/features/controlling/lib/controlling-utils.ts`

Driver aggregation:

```ts
const key = row.driver_id ?? '__unassigned__';
// ...
driver_name:
  row.driver_id == null ? 'Nicht zugewiesen' : (row.driver_name ?? '—'),
```

Operational aggregation:

```ts
acc.unassigned_trips += row.unassigned_trips;
acc.fremdfirma_trips += row.fremdfirma_trips;
acc.fremdfirma_cost += Number(row.fremdfirma_cost);
```

Classification: incomplete/broken for driver revenue views if Fremdfirma revenue rows arrive with `driver_id = null`; those rows are grouped into `Nicht zugewiesen`.

### `src/features/controlling/components/DriverRevenueChart.tsx`

Relevant lines:

```ts
const key = driver.driver_id ?? '__unassigned__';
// ...
name: driver.driver_name ?? 'Nicht zugewiesen',
```

Classification: incomplete. It can only visualize drivers vs unassigned, not Fremdfirma assignees.

### `src/features/controlling/components/DriverTable.tsx`

Relevant lines:

```tsx
<TableRow key={row.driver_id ?? 'unassigned'}>
  <TableCell className='font-medium'>
    {row.driver_name}
  </TableCell>
```

Classification: incomplete. It renders aggregated driver rows from `aggregateDrivers`, which collapses `driver_id = null` to `Nicht zugewiesen`.

### `src/features/shift-reconciliations`

No matches for `fremdfirma`, `fremdfirmen`, or `fremdfirma_id` were found.

Classification: no direct Fremdfirma consumer found. The feature is driver/shift reconciliation-oriented and may intentionally remain internal-driver-only.

### `src/features/overview`

No matches for `fremdfirma`, `fremdfirmen`, or `fremdfirma_id` were found.

Classification: no direct Fremdfirma awareness. If overview cards list upcoming trips by driver, they are likely incomplete for external assignments, but there were no direct Fremdfirma references in the requested search.

### Other relevant hits outside the requested consumer directories

`src/features/clients/components/recurring-rule-form-body.tsx` and `src/features/clients/lib/build-recurring-rule-payload.ts` already support Fremdfirma fields on recurring rules. This matters because `src/lib/recurring-trip-generator.ts` copies those fields to materialized trips and marks them `assigned`.

`src/features/trips/lib/build-return-trip-insert.ts` and `src/features/trips/lib/duplicate-trips.ts` explicitly set Fremdfirma fields to null on new one-off returns/duplicates:

```ts
fremdfirma_id: null,
fremdfirma_payment_mode: null,
fremdfirma_cost: null,
```

Classification: intentional for one-off returns/duplicates if external assignment should not carry over. This should be reviewed before adding a canonical assignee model because it encodes a product decision.

## 7. Existing Shared Infrastructure

### Shared directories

No `src/features/trips/shared/` directory exists.

No `src/features/shared/` directory exists.

The only glob hit resembling shared feature code was `src/features/driver-portal/components/shared/driver-trip-card.tsx`, which is not a general shared feature directory.

### Existing assignment constants

No constants like `ASSIGNMENT_TYPE_DRIVER`, `ASSIGNMENT_TYPE_FREMDFIRMA`, or equivalent were found.

Existing nearby constants are payment-mode-specific, not assignment-type-specific:

```ts
const LABELS: Record<FremdfirmaPaymentMode, string> = {
  cash_per_trip: 'Bar pro Fahrt',
  monthly_invoice: 'Monatsrechnung',
  self_payer: 'Selbstzahler',
  kts_to_fremdfirma: 'KTS an Fremdfirma'
};

export const FREMDFIRMA_PAYMENT_MODE_OPTIONS: {
  value: FremdfirmaPaymentMode;
  label: string;
}[] = [
  { value: 'cash_per_trip', label: LABELS.cash_per_trip },
  { value: 'monthly_invoice', label: LABELS.monthly_invoice },
  { value: 'self_payer', label: LABELS.self_payer },
  { value: 'kts_to_fremdfirma', label: LABELS.kts_to_fremdfirma }
];
```

### Existing reference infrastructure

`src/features/trips/api/trip-reference-data.ts` has shared reference fetchers:

```ts
export async function fetchActiveDrivers(): Promise<DriverOption[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('accounts')
    .select('id, name')
    .eq('role', 'driver')
    .eq('is_active', true)
    .order('name');

  if (error) throw toQueryError(error);
  return data ?? [];
}

export async function fetchActiveFremdfirmen(): Promise<FremdfirmaOption[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('fremdfirmen')
    .select('id, name, number, default_payment_mode')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name');

  if (error) throw toQueryError(error);
  return (data ?? []) as FremdfirmaOption[];
}
```

`src/query/keys/reference.ts` includes:

```ts
/** Active driver accounts (`accounts.role = driver`, `is_active = true`), ordered by name. */
drivers: () => [...referenceKeys.root, 'drivers'] as const,

/** Active Fremdfirmen (`is_active = true`) for trip + recurring forms. */
fremdfirmen: () => [...referenceKeys.root, 'fremdfirmen'] as const,
```

`src/features/trips/hooks/use-trip-reference-queries.ts` exposes:

```ts
export function useDriversQuery() {
  return useQuery({
    queryKey: referenceKeys.drivers(),
    queryFn: fetchActiveDrivers,
    staleTime: TRIP_REFERENCE_STALE_TIME_MS
  });
}

export function useFremdfirmenQuery() {
  return useQuery({
    queryKey: referenceKeys.fremdfirmen(),
    queryFn: fetchActiveFremdfirmen,
    staleTime: TRIP_REFERENCE_STALE_TIME_MS
  });
}
```

### Existing filter infrastructure

`src/lib/searchparams.ts` defines the URL params:

```ts
export const searchParams = {
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(50),
  search: parseAsString,
  name: parseAsString,
  gender: parseAsString,
  category: parseAsString,
  // trip filters
  status: parseAsString,
  driver_id: parseAsString,
  payer_id: parseAsArrayOf(parseAsString, ','),
  billing_variant_id: parseAsArrayOf(parseAsString, ','),
  /** Effective invoice status for trips list (see trip-invoice-status-badge + RPC). */
  invoice_status: parseAsString,
  /** KTS list filter: comma-separated combination of kts | kts_fehler | no_kts | no_reha | reha; absent = all trips. */
  kts_filter: parseAsArrayOf(parseAsString, ','),
  /** KTS queue filter: comma-separated kts_status enum values; absent = no status filter. */
  kts_status: parseAsArrayOf(parseAsString, ','),
  /** KTS queue: show only in_korrektur trips with open correction older than KTS_OVERDUE_DAYS. */
  overdue: parseAsBoolean.withDefault(false),
  scheduled_at: parseAsString, // for date filtering
  sort: parseAsString,
  view: parseAsString.withDefault('list'),
  /** Roster filter: all | driver | admin (driver-management table). */
  role: parseAsString.withDefault('all')
};
```

The main explicit trip filter utility is `src/features/trips/lib/kts-filter.ts`:

```ts
/**
 * Single source of truth for the `kts_filter` URL param contract.
 *
 * Shared between client (`trips-filters-bar.tsx`) and server (`trips-listing.tsx`).
 * Exposes only what is needed for the current feature; do not extend into a
 * generic filter DSL or larger abstract planner.
 *
 * ## Semantic combiner rule
 *
 * WHY a semantic plan instead of raw PostgREST strings: the negative-pair case
 * (`no_kts + no_reha`) must be an intersection — trips where BOTH KTS and
 * Reha-Schein are absent — not a union. Encoding this as PostgREST OR expressions
 * in-place made that intent invisible and led to the bug this module fixes.
 * Returning a discriminated-union plan lets `trips-listing.tsx` translate each
 * mode explicitly, making the AND vs OR decision traceable in one place.
 */

export const KTS_FILTER_VALUES = [
  'kts',
  'kts_fehler',
  'no_kts',
  'no_reha',
  'reha'
] as const;

export type KtsFilterValue = (typeof KTS_FILTER_VALUES)[number];

export const KTS_FILTER_OPTION_ROWS: ReadonlyArray<{
  value: KtsFilterValue;
  label: string;
}> = [
  { value: 'kts', label: 'Nur KTS' },
  { value: 'kts_fehler', label: 'Nur KTS-Fehler' },
  { value: 'reha', label: 'Nur Reha-Schein' },
  { value: 'no_kts', label: 'Kein KTS' },
  { value: 'no_reha', label: 'Kein Reha-Schein' }
] as const;

export function normalizeKtsFilterValues(
  raw: readonly string[] | null | undefined
): KtsFilterValue[] {
  if (!raw?.length) return [];
  const seen = new Set<KtsFilterValue>();
  const result: KtsFilterValue[] = [];
  for (const v of raw) {
    if (
      KTS_FILTER_VALUES.includes(v as KtsFilterValue) &&
      !seen.has(v as KtsFilterValue)
    ) {
      seen.add(v as KtsFilterValue);
      result.push(v as KtsFilterValue);
    }
  }
  return result;
}

export function parseKtsFilterParam(param: string | null): KtsFilterValue[] {
  if (!param) return [];
  return normalizeKtsFilterValues(param.split(',').filter(Boolean));
}

export function getKtsFilterTriggerLabel(
  values: readonly KtsFilterValue[]
): string {
  const n = values.length;
  if (n === 0) return 'KTS: Kein Filter';
  if (n === 1) {
    return (
      KTS_FILTER_OPTION_ROWS.find((o) => o.value === values[0])?.label ?? 'KTS'
    );
  }
  return `${n} KTS-Filter`;
}

export type KtsTripFilterPlan =
  | { mode: 'none' }
  | { mode: 'single'; token: KtsFilterValue }
  | { mode: 'missing-both' }
  | { mode: 'any-of'; tokens: KtsFilterValue[]; includeMissingBoth?: true };

export function buildKtsTripFilterPlan(
  values: readonly KtsFilterValue[]
): KtsTripFilterPlan {
  const dedupedTokens = normalizeKtsFilterValues(values);

  if (dedupedTokens.length === 0) {
    return { mode: 'none' };
  }

  if (dedupedTokens.length === 1) {
    return { mode: 'single', token: dedupedTokens[0]! };
  }

  const hasNoKts = dedupedTokens.includes('no_kts');
  const hasNoReha = dedupedTokens.includes('no_reha');

  if (hasNoKts && hasNoReha && dedupedTokens.length === 2) {
    return { mode: 'missing-both' };
  }

  if (hasNoKts && hasNoReha) {
    return { mode: 'any-of', tokens: dedupedTokens, includeMissingBoth: true };
  }

  return { mode: 'any-of', tokens: dedupedTokens };
}
```

There is no equivalent shared filter utility for driver/Fremdfirma assignment.

## 8. Senior Recommendation

### Cleanest location

Create the canonical abstraction under the trips feature, because assignment is a property of a trip and the primary consumers are trip table, Kanban, trip detail, dashboard trip widgets, recurring materialization, and reporting.

Recommended structure:

- `src/features/trips/lib/trip-assignee.ts` for pure types and helpers:
  - `TripAssignee`
  - `resolveTripAssignee(trip)`
  - `isTripAssigned(trip)`
  - `isTripExternallyAssigned(trip)`
  - `isTripInternallyAssigned(trip)`
  - `shouldNeedDriverAssignment(trip | patch)`
- `src/features/trips/components/trip-assignee-badge.tsx` or `src/features/trips/components/trip-assignee-cell.tsx` for reusable display.
- `src/features/trips/hooks/use-trip-assignee-options.ts` only if a combined driver/Fremdfirma selector is added later. Reuse `useDriversQuery()` and `useFremdfirmenQuery()`.

I would not put it under `src/lib` initially. `src/lib` is already a broad utility area, but this model depends on trip semantics, trip status, and trip UI behavior. Keep the domain invariant close to `src/features/trips`, then move outward only if non-trip features need a stable public API.

### Three riskiest files to touch

1. `src/features/trips/components/trips-listing.tsx`
   - This owns server-side filters for `/fahrten`, including `driver_id=unassigned`, pagination, date filtering, KTS filtering, invoice filtering, list vs Kanban selects, and sorting. A wrong assignment filter can silently change what dispatchers see.

2. `src/features/dashboard/hooks/use-unplanned-trips.ts` and `src/features/dashboard/components/pending-tours-widget.tsx`
   - The widget currently defines "open/unplanned" as `scheduled_at IS NULL OR driver_id IS NULL`. That is the clearest cross-app bug for Fremdfirma trips. Changing it affects dashboard operational workflow and quick assignment saves.

3. `src/features/trips/components/kanban/kanban-board.tsx` plus `src/features/trips/lib/kanban-columns.ts`
   - Kanban driver grouping, drag/drop assignment, staged localStorage changes, derived status, and save semantics all depend on `driver_id`. A naive TripAssignee change could break drag-to-driver assignment, group moves, or pending-change persistence.

Close runner-up: `src/features/fremdfirmen/components/trip-fremdfirma-section.tsx`, because it currently encodes the invariant "Fremdfirma clears driver and disables driver assignment needed."

### Code that conflicts with or must be reconciled

- `driver_id IS NULL` is used as a proxy for unassigned in `/fahrten`, dashboard unplanned trips, and Kanban grouping. This conflicts directly with the Fremdfirma invariant because external trips also have `driver_id = null`.
- `getStatusWhenDriverChanges` is a partial abstraction. It knows about `fremdfirmaId` only to avoid reverting `assigned` to `pending`, but it is not an assignee resolver and its name is driver-specific.
- `deriveStatusForPending` in `src/features/trips/lib/kanban-grouping.ts` calls `getStatusWhenDriverChanges` without passing `fremdfirmaId`, while the save path does pass it. This can make staged Kanban badges diverge from persisted behavior.
- Controlling driver aggregation collapses `driver_id = null` to `Nicht zugewiesen`. If RPC breakdown rows include Fremdfirma trips with null drivers, charts/tables will misclassify them.
- New return/duplicate helpers explicitly clear Fremdfirma fields. That may be intentional, but the product decision should be confirmed before a canonical abstraction makes assignment copying more systematic.

The clean migration path is to first add a pure resolver and update read/display/filter consumers to use it, then update mutation paths so every assignment write goes through one invariant-preserving helper. Avoid introducing a combined selector before the read model is consistent.
