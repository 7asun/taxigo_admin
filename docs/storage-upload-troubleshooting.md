# Storage Upload Troubleshooting: company-assets bucket

## Current Status

**Problem:** Logo upload to Supabase Storage fails with:
```
StorageApiError: new row violates row-level security policy
POST https://etwluibddvljuhkxjkxs.supabase.co/storage/v1/object/company-assets/8df83726-cd59-4fd0-87df-0bd905915fec/logo.png 400 (Bad Request)
```

**Data Verified:**
| Check | Result |
|-------|--------|
| Bucket exists | ✅ `company-assets` |
| User auth.uid() | ✅ `9e5fcb90-26ce-4cbc-bd9a-d1283885eac4` |
| User company_id | ✅ `8df83726-cd59-4fd0-87df-0bd905915fec` |
| Upload path | ✅ `8df83726-cd59-4fd0-87df-0bd905915fec/logo.png` |
| Account RLS policy | ✅ `accounts_select_own` exists |

## Root cause (confirmed)

The client upload uses `upsert: true` (overwrite). For Storage, **upsert requires RLS policies for**:

- **INSERT** (create new object row)
- **SELECT + UPDATE** (needed for the “overwrite/upsert” path)

If only an INSERT policy exists, uploads can still fail with the same RLS error even when the `WITH CHECK` expression looks correct.

Additionally, Storage policies that directly query `public.accounts` can be brittle depending on how nested RLS evaluation behaves. A `SECURITY DEFINER` helper avoids that fragility.

---

## What We've Tried

### 1. Bucket Creation ✅
- Created `company-assets` bucket via Dashboard
- Confirmed bucket ID matches exactly

### 2. Policy Expressions Tested ❌

**Attempt 1: Helper function**
```sql
(storage.foldername(name))[1] = public.current_user_company_id()::text
```
Result: RLS violation

**Attempt 2: Direct subquery with cast**
```sql
bucket_id = 'company-assets' 
AND (storage.foldername(name))[1] = (SELECT company_id::text FROM public.accounts WHERE id = auth.uid())
```
Result: RLS violation

**Attempt 3: EXISTS pattern**
```sql
bucket_id = 'company-assets' 
AND EXISTS (
  SELECT 1 FROM public.accounts 
  WHERE id = auth.uid() 
  AND company_id::text = (storage.foldername(name))[1]
)
```
Result: Not yet tested (recommended next try)

---

## Remaining Solutions (Try in order)

### Option A: EXISTS Pattern (Recommended First)
In Dashboard → Storage → Policies → `company_assets_upload` → Edit:

**WITH CHECK expression:**
```sql
bucket_id = 'company-assets' 
AND EXISTS (
  SELECT 1 FROM public.accounts 
  WHERE id = auth.uid() 
  AND company_id::text = (storage.foldername(name))[1]
)
```

### Option B: Simplified Bucket-Only Check (Test if A fails)
Temporarily remove company-scoped check to verify upload works at all:

**WITH CHECK expression:**
```sql
bucket_id = 'company-assets'
```

If this works, the issue is definitely cross-table RLS in Storage context. Then we can:
- Create a `SECURITY DEFINER` function that bypasses RLS
- Or use a different authorization approach

### Option C: SECURITY DEFINER Function (If A and B fail)
Create a function that bypasses RLS when called from Storage:

```sql
-- Run in SQL Editor
CREATE OR REPLACE FUNCTION public.user_can_access_company_storage(p_company_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER  -- Bypasses RLS
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.accounts 
    WHERE id = auth.uid() 
    AND company_id::text = p_company_id
  );
$$;
```

Then policy becomes:
```sql
bucket_id = 'company-assets' 
AND public.user_can_access_company_storage((storage.foldername(name))[1])
```

### Option D: Alternative Path Structure (Nuclear option)
If none of the above work, change upload path from `{companyId}/logo.png` to `{userId}/logo.png` and adjust the code accordingly. Then policy is simply:
```sql
bucket_id = 'company-assets' 
AND (storage.foldername(name))[1] = auth.uid()::text
```

---

## Solution implemented in this repo

Migration: `supabase/migrations/20260402120000_company_assets_storage_rls.sql`

- Adds a `SECURITY DEFINER` helper `public.user_can_access_company_storage_folder(folder text)`
- Creates Storage policies for **SELECT/INSERT/UPDATE/DELETE** for `bucket_id = 'company-assets'`
- Scopes access to `{company_id}/...` (first path segment)

If you’re reading this after the fix is applied, prefer the single source of truth doc:
`docs/company-logo-upload.md`

## Debugging Commands

Run these in Supabase SQL Editor to diagnose:

```sql
-- 1. Verify bucket exists
SELECT id, name, public FROM storage.buckets WHERE id = 'company-assets';

-- 2. Check current policies on storage.objects
SELECT policyname, cmd, with_check 
FROM pg_policies 
WHERE schemaname = 'storage' AND tablename = 'objects';

-- 3. Verify accounts row exists for user
SELECT id, company_id, role 
FROM public.accounts 
WHERE id = '9e5fcb90-26ce-4cbc-bd9a-d1283885eac4';

-- 4. Test if authenticated role can read accounts (simulates Storage context)
SET LOCAL ROLE authenticated;
SELECT company_id FROM public.accounts WHERE id = '9e5fcb90-26ce-4cbc-bd9a-d1283885eac4';
RESET ROLE;

-- 5. Check accounts table RLS policies
SELECT policyname, cmd, qual, with_check 
FROM pg_policies 
WHERE schemaname = 'public' AND tablename = 'accounts';
```

---

## Current Policy (Reference)

```sql
-- Current INSERT policy on storage.objects:
CREATE POLICY "company_assets_upload" 
ON storage.objects 
FOR INSERT TO authenticated 
WITH CHECK (
  (bucket_id = 'company-assets'::text) 
  AND ((storage.foldername(name))[1] = ( 
    SELECT (accounts.company_id)::text 
    FROM accounts 
    WHERE (accounts.id = auth.uid())
  )))
);
```

---

## Next Steps

1. **Try Option A (EXISTS pattern)** — most likely to work
2. If fails, **try Option B (bucket-only)** to confirm upload works at all
3. If B works, implement **Option C (SECURITY DEFINER function)**
4. If all fail, consider **Option D (path structure change)**

---

## Code Reference

Upload happens in:
- `src/features/company-settings/api/company-settings.api.ts:134-166`
- Path format: `${companyId}/logo.${ext}`
- Bucket: `company-assets`

Policy must allow authenticated users to INSERT into storage.objects where:
- `bucket_id = 'company-assets'`
- `name` starts with `{their_company_id}/`
