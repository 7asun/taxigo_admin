> See [access-control.md](access-control.md) for the full role-based access control architecture.

## Company logo upload (Supabase Storage) — how it works

This project stores the company logo in **Supabase Storage** in the `company-assets` bucket.

- **Bucket**: `company-assets`
- **Path**: `{company_id}/logo.{ext}`
- **DB column**: `company_profiles.logo_path` (preferred)

### Why uploads failed previously

The client upload uses `upsert: true` (overwrite existing logo). In Supabase Storage that means the client needs RLS policies that allow:

- **INSERT** (new object)
- **SELECT** and **UPDATE** (required by “upsert/overwrite” flow)

If only an INSERT policy exists, uploads can fail with:

```text
StorageApiError: new row violates row-level security policy
```

### The fix implemented in this repo

Migration: `supabase/migrations/20260402120000_company_assets_storage_rls.sql`

It does three things:

- Creates a `SECURITY DEFINER` helper `public.user_can_access_company_storage_folder(folder text)` which checks that `folder` equals the current user’s `accounts.company_id`. This avoids fragile cross-table RLS evaluation inside `storage.objects` policies.
- (Optionally) inserts the bucket if it doesn’t exist (no-op if it already exists).
- Creates **SELECT/INSERT/UPDATE/DELETE** policies on `storage.objects` for `bucket_id = 'company-assets'` scoped to the first path segment.

### Applying the fix

Run your normal Supabase migration workflow, for example:

```bash
supabase db push
```

After that, the logo upload should work again.

### Refactor: store `logo_path` (recommended)

Migration: `supabase/migrations/20260402150000_company_profiles_logo_path.sql`

- New column: `company_profiles.logo_path`
- Existing `logo_url` values are backfilled into `logo_path` when possible
- The UI/PDF resolves a **signed URL** from `logo_path` at render time

### Notes about displaying the logo

The app generates **signed URLs** at render time from `logo_path`.

- This works whether the bucket is **public or private**.
- A legacy `logo_url` may still exist in older rows; it is backfilled to `logo_path` via migration.

## Logo im PDF-Header
### Struktur
Das Logo wird über `companyProfile.logo_url` (Legacy) bzw. den aus `logo_path` aufgelösten signed URL als `<Image>`
im PDF-Header gerendert (`InvoicePdfCoverHeader` → `brandStack` → `<Image>`).

### Bekanntes react-pdf Verhalten
- Feste `height` auf `<Image>` + `objectFit: 'contain'` erzeugt toten Leerraum
  (die Box behält die volle Höhe, auch wenn das Bild nur einen Bruchteil davon ausfüllt)
- `objectFit: 'contain'` zentriert das Bild vertikal → Lücke ÜBER dem Logo

### Lösung (aktuell implementiert)
Die relevante Style-Definition ist `styles.logoLeft` in `src/features/invoices/components/invoice-pdf/pdf-styles.ts`.

| Property | Wert | Warum |
|---|---|---|
| `width` | `220` | Horizontale Breite des Logos |
| `maxHeight` | `70` | Begrenzt Höhe ohne toten Raum |
| `objectFit` | `'contain'` | Seitenverhältnis bleibt erhalten |
| `alignSelf` | `'flex-start'` | Kein vertikales Dehnen im Flex-Container |
| `objectPositionY` | `0` | Bild beginnt oben, Leerraum fällt nach unten |

### Größe anpassen
`maxHeight = width / erwartetes_Seitenverhältnis`

Beispiel: Breites Logo (4:1) → `width: 220, maxHeight: 65`

