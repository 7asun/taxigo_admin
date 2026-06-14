# PR4 — Accountant CSV import audit

**Date:** 2026-06-10  
**Scope:** Read-only audit before implementing CSV import of accountant invoice data into the KTS module.  
**Product goal:** Parse semicolon-delimited accountant CSV, match rows to trips, persist `kts_belegnummer`, `kts_invoice_amount`, `kts_eigenanteil` per trip. UI: **"CSV importieren"** button in `kts-header.tsx` → Sheet with file input → parse preview → matched/unmatched table → confirm commit.

**Files read:**

- `src/app/dashboard/kts/kts-header.tsx`
- `src/app/dashboard/kts/kts-page-shell.tsx`
- `src/app/dashboard/kts/page.tsx`
- `src/features/kts/components/kts-listing-page.tsx`
- `src/features/kts/kts.service.ts`
- `src/features/kts/types/kts-trip-row.ts`
- `src/features/kts/hooks/use-kts-status.ts`
- `src/types/database.types.ts` (clients, trips, kts_* sections)
- `supabase/migrations/20260610130000_kts_patient_id.sql`
- `supabase/migrations/20260610140000_kts_status.sql`
- `docs/kts-architecture.md`
- Prior art: `bulk-upload-dialog.tsx`, `parse-bank-csv.ts`, `zahlungsabgleich-dialog.tsx`, `file-uploader.tsx`, `company-settings.api.ts`
- `src/components/ui/sheet.tsx`, `dialog.tsx`
- `src/lib/supabase/*` (no storage/upload modules)

---

## 1. clients table — name fields

**Column names:** `first_name` and `last_name` (nullable `string`). Not `vorname`/`nachname` or `name`/`surname`.

`database.types.ts` — `clients.Row` (lines 190–203 excerpt):

```typescript
      clients: {
        Row: {
          birthdate: string | null;
          city: string;
          company_id: string;
          company_name: string | null;
          created_at: string;
          email: string | null;
          first_name: string | null;
          greeting_style: string | null;
          id: string;
          is_company: boolean;
          is_wheelchair: boolean;
          kts_patient_id: string | null;
          last_name: string | null;
          // ...
        };
```

**trips → clients join:** Direct FK on `trips.client_id` → `clients.id`. No intermediate table.

`database.types.ts` — `trips.Relationships` (lines 1718–1723):

```typescript
          {
            foreignKeyName: 'trips_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
```

**Note:** KTS listing does not embed `clients` — it uses trip snapshot fields (`client_name`, `kts_patient_id`) via `SELECT *` on `trips`.

---

## 2. trips transport date — exact column and type

**There is no `trip_date`, `transport_date`, `fahrtdatum`, or `date` column on `trips`.**

Relevant date columns on `trips.Row`:

| Column | TS type | Role |
| ------ | ------- | ---- |
| `scheduled_at` | `string \| null` | Primary trip datetime (stored as timestamptz ISO string in generated types) |
| `requested_date` | `string \| null` | Fallback when trip is unscheduled |

Quote from `database.types.ts` (lines 1542–1545):

```typescript
          requested_date: string | null;
          return_status: string | null;
          rule_id: string | null;
          scheduled_at: string | null;
```

**Postgres usage (business date):** Controlling/shift migrations consistently derive the transport **calendar date** in Berlin as:

```sql
(t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date
```

(e.g. `supabase/migrations/20260530120000_controlling_rpcs.sql`).

KTS queue listing orders by `scheduled_at` (`kts-listing-page.tsx` line 89) — not `requested_date`.

**PR4 implication:** Match CSV `Transportdatum` (DD.MM.YYYY) against **Berlin local date of `scheduled_at`**, with explicit product decision on whether unscheduled trips (`scheduled_at` null, `requested_date` set) participate in import.

---

## 3. kts_patient_id — location and join path

**Both tables** — migration `20260610130000_kts_patient_id.sql`:

```sql
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS kts_patient_id text;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS kts_patient_id text;

COMMENT ON COLUMN public.clients.kts_patient_id IS
  'External KTS patient ID from the accountant billing system; master value for client profile.';

COMMENT ON COLUMN public.trips.kts_patient_id IS
  'Snapshot of patient ID at KTS enable / client link time — stable for PR4 CSV matching; not cleared when KTS is turned off.';
```

**Type:** `text` (nullable) on both.

`database.types.ts`:

- `clients.Row.kts_patient_id: string | null` (line 202)
- `trips.Row.kts_patient_id: string | null` (line 1479)

**Join path for matching:**

- **Preferred (PR3 design):** use `trips.kts_patient_id` snapshot directly — no live join required (`docs/kts-architecture.md` §3.0).
- **Optional enrichment:** `trips.client_id` → `clients.kts_patient_id` when trip snapshot is null but client is linked.

`kts.service.ts` explicitly preserves snapshot on KTS OFF (line 95):

```typescript
    // why: PR4 CSV matching — patient ID snapshot must survive KTS OFF; do not clear kts_patient_id here.
```

---

## 4. Existing new columns check

Grep across `database.types.ts` and repo for:

- `kts_belegnummer`
- `kts_invoice_amount`
- `kts_eigenanteil`

**Result: all three are absent** from `trips` (and everywhere else in schema/types).

Current KTS-related trip columns in `trips.Row`: `kts_document_applies`, `kts_fehler`, `kts_fehler_beschreibung`, `kts_handover_id`, `kts_patient_id`, `kts_source`, `kts_status`.

Roadmap doc references **`kts_external_invoices`** satellite table (PR4), not columns on `trips` — see §10 below.

---

## 5. kts-header.tsx — available slot

**Location:** `src/app/dashboard/kts/kts-header.tsx` (not under `src/features/kts/components/`).

**Props:** None — `export function KtsHeader()` takes no parameters.

**Full JSX return:**

```tsx
export function KtsHeader() {
  const [kpiOpen, setKpiOpen] = useState(true);

  return (
    <div className='flex shrink-0 flex-col gap-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-xl font-semibold'>KTS</h1>
          <p className='text-muted-foreground text-sm'>
            Belegprüfung und Korrekturverwaltung
          </p>
        </div>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='text-muted-foreground h-7 gap-1 text-xs'
          onClick={() => setKpiOpen((v) => !v)}
        >
          {kpiOpen ? (
            <>
              <ChevronUp className='h-3.5 w-3.5' />
              Ausblenden
            </>
          ) : (
            <>
              <ChevronDown className='h-3.5 w-3.5' />
              Übersicht anzeigen
            </>
          )}
        </Button>
      </div>
      <KtsKpiSection open={kpiOpen} onOpenChange={setKpiOpen} />
    </div>
  );
}
```

**Actions area:** The header row is `justify-between` with title/subtitle on the **left** and a **single ghost button** (KPI collapse toggle) on the **right**. There is **no** dedicated import/actions slot today — but the right side of the title row is the natural place to add **"CSV importieren"** (e.g. button group: `[CSV importieren] [KPI toggle]` or replace layout with `gap-2` actions cluster).

Header is **`shrink-0`** — fixed height in page flex column, not sticky by itself.

---

## 6. Existing file upload / CSV import patterns

### Prior art exists — not zero.

| Feature | Files | Library | Where parsing happens | Storage upload? |
| ------- | ----- | ------- | --------------------- | --------------- |
| **Fahrten bulk CSV import** | `bulk-upload-dialog.tsx`, `bulk-upload/*` | **Papa Parse** (`papaparse`) | **Client** — `Papa.parse(file, { header: true, ... })` | No — parsed rows → `tripsService` inserts |
| **Bank Zahlungsabgleich** | `parse-bank-csv.ts`, `zahlungsabgleich-dialog.tsx`, `use-zahlungsabgleich.ts` | **Papa Parse** (`delimiter: ';'`) | **Client** — `parseBankCsv(file)` | No |
| **Fahrten CSV export** | `csv-export/*`, `app/api/trips/export/route.ts` | Server generates CSV | **Server** for download | N/A |
| **Company logo** | `company-settings.api.ts`, `file-uploader.tsx` | `react-dropzone` | N/A | **Yes** — `supabase.storage.from('company-assets').upload(...)` |
| **Shared file UI** | `src/components/file-uploader.tsx` | `react-dropzone` | Consumer parses file | Optional `onUpload` callback |

**Bulk upload parse quote** (`bulk-upload-dialog.tsx` lines 606–609):

```typescript
    Papa.parse<ParsedCsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (papaResults) => {
```

**Bank CSV parse quote** (`parse-bank-csv.ts` lines 103–108):

```typescript
export function parseBankCsv(file: File): Promise<BankRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      delimiter: ';',
      header: false,
```

**Bank reconciliation UX pattern** (`zahlungsabgleich-dialog.tsx`): `FileUploader` → client parse → `ReviewTable` with ready/warning buckets → confirm batch write. Closest product analog to PR4 matched/unmatched preview.

**Trips components with CSV/import relevance** (scan under `src/features/trips/components/`):

- `bulk-upload-dialog.tsx`
- `bulk-upload/bulk-upload-types.ts`
- `bulk-upload/match-client.ts`
- `bulk-upload/resolve-clients-step.tsx`
- `bulk-upload/resolve-billing-variants-step.tsx`
- `csv-export/csv-export-dialog.tsx`
- `csv-export/download-csv-button.tsx`
- `csv-export/preview-step.tsx`
- (export-only: `csv-export-constants.ts`, `column-selector-step.tsx`, etc.)

**Supabase storage in `src/lib/supabase/`:** Only `admin.ts`, `client.ts`, `server.ts`, `service-factory.ts`, `to-query-error.ts` — **no** storage helper. Storage upload lives in `src/features/company-settings/api/company-settings.api.ts`.

**No Papa Parse usage in KTS feature yet.**

---

## 7. Sheet component availability

**Yes** — `src/components/ui/sheet.tsx` exists.

Exports (lines 130–138):

```typescript
export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription
};
```

All requested names present except user listed `SheetClose` (exists). **`file-input.tsx`, `dropzone.tsx`, `file-upload.tsx` do not exist** under `src/components/ui/` — use `input.tsx` + `FileUploader` (`src/components/file-uploader.tsx`) or native `<input type="file">`.

**Dialog** also available (`dialog.tsx`): `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose`, etc. Bulk upload and Zahlungsabgleich use **Dialog**, not Sheet.

---

## 8. kts-listing-page.tsx — RSC select shape

`ktsListSelect` (`kts-listing-page.tsx` lines 33–36):

```typescript
  const ktsListSelect = `
    *,
    kts_corrections(id, sent_at, received_at, sent_to)
  `;
```

| Field | Included? |
| ----- | --------- |
| `kts_patient_id` | **Yes** — via `*` on `trips` |
| `client_name` | **Yes** — via `*` (denormalized snapshot string) |
| `client_id` | **Yes** — via `*` |
| `scheduled_at` | **Yes** — via `*` |
| `clients.first_name` / `clients.last_name` | **No** — no `clients(...)` embed |

Search filter already uses snapshot fields (lines 81–85):

```typescript
      query = query.or(
        `client_name.ilike.%${term}%,kts_patient_id.ilike.%${term}%`
      );
```

**Import preview:** For display, `client_name` + `kts_patient_id` from trip rows are available without extra query. For **name fallback matching**, prefer parsing `client_name` or a dedicated import-time query joining `clients` on `client_id` — listing RSC does not fetch structured names.

---

## 9. KtsPageShell / page layout

**`kts-page-shell.tsx`** — thin client wrapper:

```tsx
export function KtsPageShell({ children }: { children: ReactNode }) {
  return <TripsRscRefreshProvider>{children}</TripsRscRefreshProvider>;
}
```

**`page.tsx` composition** (lines 24–44):

```tsx
  return (
    <KtsPageShell>
      <PageContainer scrollable={false}>
        <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-hidden'>
          <KtsHeader />
          <Suspense fallback={...}>
            <KtsListingPage searchParams={searchParams} />
          </Suspense>
        </div>
        <TripsRealtimeSync />
      </PageContainer>
    </KtsPageShell>
  );
```

| Aspect | Finding |
| ------ | ------- |
| **KtsHeader props** | None passed |
| **Layout** | Inline in page flow — first child of flex column above listing |
| **Sticky/fixed** | `PageContainer scrollable={false}` + inner `overflow-hidden`; header is `shrink-0` but not `sticky top-0` |
| **Shell role** | Only provides `TripsRscRefreshProvider` for RSC refresh after mutations |

Import Sheet can live entirely inside `KtsHeader` (client component) without shell changes.

---

## 10. docs/kts-architecture.md — import / PR4 sections

### §6 CSV import (trip bulk upload — not accountant invoice CSV)

```markdown
## 6. CSV import

Optional Spalten **`kts_document_applies`**, **`kts`**, **`kts_document`** (gleiche Semantik). ...
Vollständige Kopfzeile und Spaltenbeschreibung: [bulk-trip-upload.md](bulk-trip-upload.md).
```

This documents **Fahrten bulk trip creation**, not accountant Beleg CSV.

### §3.0 / §7.2 PR4 roadmap

§3.0 documents `kts_patient_id` snapshot for **PR4 CSV matching**.

§7.2 roadmap row (line 354):

```markdown
| **PR4** (next) | `kts_external_invoices` + CSV matching on `trips.kts_patient_id` |
```

§9 status (line 410):

```markdown
**PR3.3 (2026-06):** ... **PR4** (CSV matching) is next.
```

**No dedicated section** yet for accountant CSV column mapping, Belegnummer, `kts_belegnummer`/`kts_invoice_amount`/`kts_eigenanteil`, or import Sheet UX. `docs/plans/kts-module-b-audit.md` discusses PR4 schema concept (`kts_external_invoices` + link table) — not implemented.

---

## 11. Senior recommendation

### Safest matching strategy (given schema)

**Primary match (step 1):**

```
CSV Transportdatum (DD.MM.YYYY → date)
  + Schein-ID parsed from Patient trailing "(NNNNN)" (skip when 0)
  ↔ trips.kts_patient_id (text, trimmed)
  + (scheduled_at AT TIME ZONE 'Europe/Berlin')::date
```

Filter candidates: `company_id`, `kts_document_applies = true` (and product decision: only `kts_status = 'uebergeben'`?).

Use **`trips.kts_patient_id` snapshot** — not live `clients.kts_patient_id` — per §3.0 invariant.

**Fallback (step 2):** When Schein-ID is `(0)` or step 1 returns 0 rows:

- Parse CSV Patient display name → last_name + first_name (CSV format: `"Kunz, Waltraud 19.11.1930 - Addr (54861)"`).
- Match against:
  - `clients.last_name` + `clients.first_name` via `trips.client_id`, **or**
  - heuristic parse of `trips.client_name` when `client_id` is null.

Same Berlin date constraint on `scheduled_at`.

**Step 3 — unmatched:** No auto-write; show in preview table for manual trip picker (pattern: Zahlungsabgleich warning rows + bulk-upload wizard resolve steps).

**Ambiguity rule:** If step 1 or 2 returns **>1** trip, treat as unmatched/ambiguous — do not auto-commit (outbound + return share date + patient ID).

### Client-side vs server-side parsing

**Recommend: client-side parse + preview; server-side atomic commit.**

| Phase | Where | Why |
| ----- | ----- | --- |
| File read + Papa Parse | **Client** | Matches `bulk-upload-dialog.tsx` and `parse-bank-csv.ts`; instant preview; no file retention |
| Match preview | **Client** (fetch candidate trips via API/RPC) or **Server Action** | Needs company-scoped trip query — consider one RPC `match_kts_invoice_csv_rows` to avoid shipping entire trip table |
| Commit | **Server** — Postgres RPC or API route | Multi-row updates + optional `kts_external_invoices` insert must be **transactional**; admin guard + company guard like `create_kts_handover` |

**Do not use Edge Function** unless file sizes exceed browser limits — accountant CSVs are small; Papa Parse is already a dependency.

**Do not upload CSV to Supabase Storage** for V1 — parse in memory; only persist matched results (bank reconciliation does not store CSV either).

### Minimum new schema

Architecture doc points to **`kts_external_invoices`** satellite (PR4), not only three columns on `trips`. Minimum viable options:

**Option A (doc-aligned):**

- Table `kts_external_invoices` — one row per import batch or per Belegnummer (product decision)
- Link table or columns on trips for the three fields
- RLS via `accounts.company_id` pattern

**Option B (user spec — columns on trips):**

```sql
ALTER TABLE trips ADD COLUMN kts_belegnummer text;      -- or integer
ALTER TABLE trips ADD COLUMN kts_invoice_amount numeric;
ALTER TABLE trips ADD COLUMN kts_eigenanteil numeric;
```

Plus indexes for matching/commit:

```sql
CREATE INDEX idx_trips_company_kts_patient_id
  ON trips (company_id, kts_patient_id)
  WHERE kts_document_applies = true AND kts_patient_id IS NOT NULL;

-- Optional: Berlin date expression index if match RPC is hot
-- (scheduled_at AT TIME ZONE 'Europe/Berlin')::date
```

**Recommend reconciling Option A vs B in PR4 design** — roadmap says satellite table; user spec says trip columns. Could store amounts on trips and Beleg metadata on satellite.

**Commit RPC:** `apply_kts_invoice_csv_matches(p_company_id, p_rows jsonb)` — validates admin, updates only matched trip IDs, records import audit row.

### Name fallback — data quality risks

| Risk | Detail |
| ---- | ------ |
| **`client_name` is unstructured** | Snapshot string; may not match `"Nachname, Vorname"` CSV format; splitting on comma is fragile (double names, firms) |
| **Duplicate names same day** | Two patients same last/first name on same Transportdatum → false match without Schein-ID |
| **Schein-ID `(0)`** | Forces fallback; highest false-positive rate |
| **`kts_patient_id` mismatch** | Trip snapshot stale vs accountant CSV if admin never set ID on trip/client |
| **Date timezone** | Must use Berlin date from `scheduled_at`, not raw UTC date — wrong day near midnight |
| **Multi-trip per Belegnummer** | One Belegnummer spans outbound + return — commit must allow **same Belegnummer on N trips**; preview should group by Belegnummer |
| **Re-import** | Overwriting `kts_belegnummer`/amounts on second import — need idempotency or conflict UI |
| **Trips not yet `uebergeben`** | Product should define whether import applies only post-handover |

### Unmatched row UX (fit existing KTS patterns)

Mirror **Zahlungsabgleich** + **bulk-upload resolve** patterns:

1. **Sheet** (wide preview) — not full-page Dialog; keeps queue visible context
2. **Steps:** upload → parsing spinner → preview table split **Matched** / **Unmatched** / **Ambiguous** (tabs or sections like warning/ready buckets)
3. **Preview columns:** CSV Patient, Transportdatum, Belegnummer, Gesamtpreis, matched trip (Termin, Fahrgast, kts_patient_id, status badge via `ktsStatusBadge`)
4. **Unmatched row actions:** manual trip search/select (combobox against company trips on that date) — similar to `resolve-clients-step.tsx`
5. **Errors inline** in Sheet — not toast-only (PR3.3 handover pattern for batch failures)
6. **Commit:** primary button disabled until 0 ambiguous rows or user explicitly skips unmatched; `toast.success` on commit + `refreshTripsPage()` via existing KTS mutation side effects

Place **"CSV importieren"** in `kts-header.tsx` right header cluster (`justify-between` row), `variant='outline'` or `default`, `Icons.post` or upload icon.

---

## Summary table

| # | Question | Answer |
| - | -------- | ------ |
| 1 | Client name columns | `first_name`, `last_name`; trips → clients direct FK |
| 2 | Transport date | No `trip_date`; use `scheduled_at` (timestamptz) → Berlin `::date`; also `requested_date` |
| 3 | `kts_patient_id` | Both `clients` and `trips`, type `text`; match on trip snapshot |
| 4 | New columns | All three absent — migration required |
| 5 | Header slot | Title + KPI toggle only; add import button right cluster |
| 6 | CSV prior art | Papa Parse client-side (bulk upload, bank CSV); logo storage upload only |
| 7 | Sheet | Exists with full export set |
| 8 | List select | `*, kts_corrections(...)` — has `kts_patient_id`, `client_name`; no client embed |
| 9 | Page layout | `KtsHeader` inline, no props, inside `PageContainer` flex column |
| 10 | Arch doc PR4 | Roadmap + patient ID notes; no accountant CSV import section yet |

*Audit only — no code or schema changes.*
