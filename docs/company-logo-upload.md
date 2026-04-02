## Company logo upload (Supabase Storage) — how it works

This project stores the company logo in **Supabase Storage** in the `company-assets` bucket.

- **Bucket**: `company-assets`
- **Path**: `{company_id}/logo.{ext}`
- **DB column**: `company_profiles.logo_url`

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

### Notes about displaying the logo

The code currently uses `getPublicUrl()` for `logo_url`.

- If your bucket is **private**, anonymous viewers cannot fetch the URL.
- If you need private buckets, switch to **signed URLs** instead of `getPublicUrl()`.

