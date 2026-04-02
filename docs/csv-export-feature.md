# CSV Export Feature for Fahrten

Feature to export trips data to CSV format with customizable filters, column selection, and export preview.

---

## Overview

The CSV Export feature allows administrators to download trip data from the Fahrten page as a CSV file. The export supports filtering by payer, billing type, and date range, with full control over which columns are included in the output. A preview step shows the user exactly how many trips will be exported before confirming the download.

---

## Usage

1. Navigate to the Fahrten page (`/dashboard/trips`)
2. Click the **"CSV Export"** button next to the Bulk Upload button
3. Follow the 5-step wizard:
   - **Step 1**: Select a payer (or "All payers")
   - **Step 2**: Select a billing type (only shown if a specific payer was selected)
   - **Step 3**: Choose date range (defaults to last 30 days)
   - **Step 4**: Select which columns to export
   - **Step 5**: Preview the export (shows trip count, filters, and selected columns)
4. Click "Export" to download the CSV file

---

## File Structure

```
src/features/trips/components/csv-export/
├── download-csv-button.tsx           # Main button component
├── csv-export-dialog.tsx             # Multi-step dialog wizard
├── payer-selection-step.tsx          # Step 1: Payer selection UI
├── billing-type-selection-step.tsx   # Step 2: Billing type selection UI
├── date-range-step.tsx               # Step 3: Date range picker UI
├── column-selector-step.tsx          # Step 4: Column selection UI
├── preview-step.tsx                  # Step 5: Export preview UI
├── csv-export-constants.ts           # Available columns configuration

src/features/trips/types/
└── csv-export.types.ts               # TypeScript type definitions

src/app/api/trips/export/
├── route.ts                          # Server-side CSV generation API
└── preview/
    └── route.ts                      # Preview count API (counts matching trips)
```

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
  count: number  // Number of trips matching the filters
}
```

---

## Available Columns

The export supports all 45+ columns from the trips table and joined tables:

### Trip Information
- `id`, `scheduled_at`, `requested_date`, `status`, `is_wheelchair`
- `return_status`, `link_type`, `created_at`

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
- Date format: German format (`DD.MM.YYYY HH:mm`)
- Boolean values: "Ja" / "Nein"
- Empty values: Empty string (not NULL)

### Security

- Uses Supabase service role key to bypass RLS for bulk export
- Validates company ownership on all exports
- All filters are scoped to the user's company

### Performance

- Server-side CSV generation to handle large datasets
- No pagination limits - exports ALL matching trips
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
1. Export with "All payers" and broad date range
2. Export with specific payer only
3. Export with payer + billing type
4. Export with no columns selected (should show validation error)
5. Export with date range where start > end (should show validation error)
6. Export with filters that match 0 trips (should show "not found" error)

---

## Future Enhancements

Potential improvements:
- Preset column selections (e.g., "Standard", "Billing", "Addresses only")
- Export scheduling / recurring exports
- Email delivery option for large exports
- Saved export configurations per user
- Export history log
