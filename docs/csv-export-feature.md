# CSV Export Feature for Fahrten

Feature to export trips data to CSV format with customizable filters, column selection, and live data preview.

---

## Overview

The CSV Export feature allows administrators to download trip data from the Fahrten page as a CSV file. The export supports filtering by payer, billing family/type, and date range, with full control over which columns are included in the output. A live preview step shows actual sample data rows before confirming the download.

---

## Usage

1. Navigate to the Fahrten page (`/dashboard/trips`)
2. Click the **"CSV Export"** button next to the Bulk Upload button
3. Follow the 4-step wizard:
   - **Step 1**: Select a payer and optionally filter by billing family/type
   - **Step 2**: Choose date range with quick presets (defaults to current month)
   - **Step 3**: Select which columns to export
   - **Step 4**: Preview the export (shows live data table with first 5 rows)
4. Click "Exportieren" to download the CSV file

---

## File Structure

```
src/features/trips/components/csv-export/
├── download-csv-button.tsx           # Main button component
├── csv-export-dialog.tsx             # Multi-step dialog wizard
├── payer-billing-step.tsx            # Step 1: Combined payer + billing selection
├── date-range-step.tsx               # Step 2: Date range picker with presets
├── column-selector-step.tsx          # Step 3: Column selection UI
├── preview-step.tsx                  # Step 4: Live data preview with table
├── csv-export-constants.ts           # Available columns configuration

src/features/trips/types/
└── csv-export.types.ts               # TypeScript type definitions

src/app/api/trips/export/
├── route.ts                          # Server-side CSV generation API
└── preview/
    └── route.ts                      # Preview API (returns count + sample rows)
```

---

## 4-Step Wizard

### Step 1: Kostenträger & Abrechnung

Combined payer and billing selection step:

- **Kostenträger**: Select "Alle Kostenträger" or a specific payer
- **Abrechnungsfamilie**: Appears when a specific payer is selected with billing families
  - Shows "Alle Abrechnungsfamilien" as default option
  - Lists all billing families for the selected payer
- **Abrechnungsart**: Only appears when a specific billing family is selected
  - Shows "Alle Abrechnungsarten" as default option
  - Lists all billing variants within the selected family

### Step 2: Zeitraum

Date range selection with project Calendar component in range mode:

**Quick Select Presets:**
- **Diesen Monat** - Current month (1st to last day)
- **Letzten Monat** - Previous month (1st to last day)
- **Diese Woche** - Current week (Monday to Sunday)
- **Letzte Woche** - Previous week (Monday to Sunday)

Dates are formatted as `DD.MM.YYYY` for display and `yyyy-MM-dd` for API.

### Step 3: Spalten

Column selection interface with categorized columns:

- All 45+ exportable columns organized by category
- Toggle individual columns or select all/none
- Categories: Trip Information, Passenger, Pickup Address, Dropoff Address, Billing, Driver, Metadata, Driving Metrics, Technical

### Step 4: Vorschau

Live data preview before export:

- Shows first 5 rows of actual data with selected columns
- Displays total trip count
- Horizontal scrolling for many columns
- Table header stays fixed when scrolling
- Buttons fixed at bottom (Zurück / Exportieren)
- Shows "... und X weitere Zeilen" when more than 5 rows

---

## API Endpoints

### POST /api/trips/export

Generates and downloads the CSV file.

#### Request Body

```typescript
{
  payerId?: string | null;      // Filter by payer ID, null for all
  billingTypeId?: string | null; // Filter by billing variant ID
  dateFrom: string;              // Start date (YYYY-MM-DD)
  dateTo: string;                // End date (YYYY-MM-DD)
  columns: string[];             // Array of column keys to include
  includeHeaders?: boolean;      // Include header row (default: true)
}
```

#### Response

- **Success**: `text/csv` stream with `Content-Disposition: attachment`
- **Error**: JSON with `error` message and appropriate HTTP status code

#### Error Codes

- `400`: Invalid request parameters
- `401`: Not authenticated
- `403`: No company assigned
- `404`: No trips found for filters
- `500`: Server error (including missing `SUPABASE_SERVICE_ROLE_KEY`)

### GET /api/trips/export/preview

Returns a count of trips matching the filters without generating CSV.

#### Query Parameters

- `payer_id`: Optional payer filter
- `billing_variant_id`: Optional billing variant filter
- `date_from`: Start date (YYYY-MM-DD)
- `date_to`: End date (YYYY-MM-DD)

#### Response

```typescript
{
  count: number;        // Number of trips matching the filters
  sampleTrips: Array<Record<string, unknown>>;  // First 5 rows for preview
}
```

---

## Available Columns

The export supports all 45+ columns from the trips table and joined tables:

### Trip Information
- `id`, `requested_date`, `status`, `is_wheelchair`
- `return_status`, `link_type`, `created_at`
- `scheduled_date`, `scheduled_time` (split from scheduled_at)
- `canceled_reason_notes` - Stornierungsgrund

### Passenger Information
- `client_id`, `client_name`, `client_phone`, `greeting_style`

### Pickup Address
- `pickup_address`, `pickup_street`, `pickup_street_number`
- `pickup_zip_code`, `pickup_city`, `pickup_station`
- `pickup_lat`, `pickup_lng`

### Dropoff Address
- `dropoff_address`, `dropoff_street`, `dropoff_street_number`
- `dropoff_zip_code`, `dropoff_city`, `dropoff_station`
- `dropoff_lat`, `dropoff_lng`

### Billing
- `payer_id`, `payer_name` (joined from payers table)
- `billing_variant_id`, `billing_variant_name` (joined from billing_variants)
- `billing_family_name` (joined from billing_types)
- `billing_calling_station`, `billing_betreuer`, `price`

### Driver & Vehicle
- `driver_id`, `driver_name` (joined from accounts table)
- `vehicle_id`

### Metadata
- `group_id`, `stop_order`, `notes`

### Driving Metrics
- `driving_distance_km`, `driving_duration_seconds`
- `actual_pickup_at`, `actual_dropoff_at`

### Technical
- `company_id`, `ingestion_source`, `rule_id`
- `linked_trip_id`, `has_missing_geodata`, `needs_driver_assignment`

---

## Technical Notes

### Date Filtering

The export uses the same timezone-aware filtering as the main Fahrten page:
- Trips with `scheduled_at` in the date range
- Trips with `scheduled_at IS NULL` AND `requested_date` in the range
- This ensures no "stuck" trips appear in exports (see `docs/trips-date-filter.md`)

### CSV Format

- Encoding: UTF-8 with BOM for Excel compatibility
- Delimiter: Comma (`,`)
- Date format: German format (`DD.MM.YYYY`)
- Time format: German format (`HH:mm`)
- Boolean values: "Ja" / "Nein"
- Empty values: Empty string (not NULL)

---

## Filename Format

The exported CSV filename follows this pattern:

```
dd.mm.yy-dd.mm.yy_Fahrten_Kostenträger_Abrechnungs.csv
```

**Examples:**
- `01.04.26-15.04.26_Fahrten_Alle.csv`
- `01.03.26-31.03.26_Fahrten_Muster_Krankenkasse_Privat.csv`

Special characters in payer/billing names are sanitized or replaced with underscores.

### Security

- Uses Supabase service role key to bypass RLS for bulk export
- Validates company ownership on all exports
- All filters are scoped to the user's company

### Date/Time Split

The `scheduled_at` datetime field is split into two separate export columns:
- `scheduled_date`: German date format (DD.MM.YYYY)
- `scheduled_time`: German time format (HH:mm)

### Performance

- Server-side CSV generation to handle large datasets
- No pagination limits - exports ALL matching trips
- Preview API limits to 5 sample rows for performance
- Consider narrowing date ranges for large databases

---

## Adding New Columns

To add new columns to the export:

1. Add the column definition to `csv-export-constants.ts`
2. Add the accessor function to `EXPORT_COLUMNS` in `route.ts`
3. Update this documentation

Example:
```typescript
// In csv-export-constants.ts
{ key: 'new_field', label: 'Neues Feld', category: 'trip-info' }

// In route.ts
{ key: 'new_field', label: 'Neues Feld', accessor: (t) => t.new_field ?? '' }
```

---

## Testing

Test scenarios:
1. Export with "Alle Kostenträger" and broad date range
2. Export with specific payer only
3. Export with payer + billing family + billing variant
4. Export with "Alle Abrechnungsfamilien" (no specific variant)
5. Export with no columns selected (should show validation error)
6. Export with date range where start > end (should show validation error)
7. Export with filters that match 0 trips (should show "not found" error)
8. Preview step with many columns selected (dialog should expand and scroll)
9. Each date preset button (Diesen Monat, Letzten Monat, Diese Woche, Letzte Woche)

---

## Recent Changes

### April 2026 Updates

- **Combined Payer/Billing Step**: Merged payer and billing type selection into single step with conditional family/variant visibility
- **Date Range Presets**: Added 4 quick select buttons (Diesen Monat, Letzten Monat, Diese Woche, Letzte Woche)
- **Live Data Preview**: Changed from summary view to actual data table with first 5 rows
- **Dynamic Dialog Width**: Dialog expands to 90vw/1200px for preview step, compact 500px for other steps
- **Date/Time Split**: Replaced combined "Datum & Uhrzeit" with separate "Datum" and "Uhrzeit" columns
- **Added canceled_reason_notes**: New column "Stornierungsgrund" for export
- **Filename Format**: Updated to include payer and billing names with German date format
- **Removed separate billing-type step**: Now part of combined payer step
