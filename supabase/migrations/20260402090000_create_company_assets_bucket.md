# Create Storage Bucket: company-assets

Supabase Storage buckets **cannot be created via SQL** — they require superuser privileges or the Supabase API.

## Option 1: Dashboard (Recommended)

**Step 1: Create the bucket**
1. Go to Supabase Dashboard → Storage
2. Click **"New bucket"**
3. **Bucket name:** `company-assets`
4. Check **"Make bucket public"** — leave this **OFF** (bucket should be private)
5. Click **"Create bucket"**

**Step 2: Configure file limits**
1. Click on the `company-assets` bucket
2. Go to **"Policies"** tab
3. Click **"Add Policy"** for each operation below:

### Upload Policy (INSERT)
- **Name:** `company_assets_upload_own`
- **Allowed operations:** INSERT
- **Target roles:** `authenticated`
- **WITH CHECK expression:**
```sql
(storage.foldername(name))[1] = public.current_user_company_id()::text
```

### Read Policy (SELECT)
- **Name:** `company_assets_read_own`
- **Allowed operations:** SELECT
- **Target roles:** `authenticated`
- **USING expression:**
```sql
(storage.foldername(name))[1] = public.current_user_company_id()::text
```

### Update Policy
- **Name:** `company_assets_update_own`
- **Allowed operations:** UPDATE
- **Target roles:** `authenticated`
- **USING expression:**
```sql
(storage.foldername(name))[1] = public.current_user_company_id()::text
```

### Delete Policy
- **Name:** `company_assets_delete_own`
- **Allowed operations:** DELETE
- **Target roles:** `authenticated`
- **USING expression:**
```sql
(storage.foldername(name))[1] = public.current_user_company_id()::text
```

**Step 3: Configure bucket limits (optional)**
- Go to bucket Settings
- **File size limit:** 5242880 (5MB)
- **Allowed MIME types:**
  - `image/png`
  - `image/jpeg`
  - `image/jpg`
  - `image/svg+xml`
  - `image/webp`

## Option 2: Supabase CLI

If you have the Supabase CLI installed with admin privileges:

```bash
# Create the bucket
supabase storage create company-assets --project-ref etwluibddvljuhkxjkxs

# Note: Policies still need to be configured via Dashboard
```

## Option 3: Management API

You can create the bucket via the [Supabase Management API](https://supabase.com/docs/guides/api/management-api-beta) using your service role key.

## What the RLS policies do

The policies above restrict users so they can only access files in their own company's folder. The path structure is `{company_id}/logo.{ext}`, so:

- `(storage.foldername(name))[1]` extracts the first folder name (the company_id)
- `SELECT company_id::text FROM public.accounts WHERE id = auth.uid()` gets the current user's company_id
- The policy only allows access if the file's company folder matches the user's company

## Column Documentation

| Column | Value | Description |
|--------|-------|-------------|
| `id` | `company-assets` | Unique bucket identifier |
| `name` | `company-assets` | Human-readable bucket name |
| `public` | `false` | Private bucket (RLS required) |
| `file_size_limit` | `5242880` | 5MB max file size per logo |
| `allowed_mime_types` | `['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp']` | Image formats only |
| `avif_autodetection` | `false` | AVIF auto-detection disabled |
