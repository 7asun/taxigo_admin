-- RLS for company logo uploads (bucket: company-assets).
--
-- 1) The client upload uses { upsert: true } (overwrite existing file).
--    For Storage, "upsert/overwrite" requires RLS policies for:
--      - INSERT  (create new object row)
--      - SELECT  (the overwrite flow needs visibility)
--      - UPDATE  (overwrite existing object row)
--    If only INSERT exists, uploads can still fail with:
--      StorageApiError: new row violates row-level security policy
--    Reference: https://supabase.com/docs/reference/javascript/storage-from-upload
--
-- 2) Policies use a SECURITY DEFINER helper so authorization does not depend on
--    cross-table RLS evaluation against public.accounts from within storage policies.

CREATE OR REPLACE FUNCTION public.user_can_access_company_storage_folder(p_folder text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.accounts a
    -- Wrap auth.uid() in SELECT so Postgres can initPlan/cache it within policy evaluation.
    WHERE a.id = (SELECT auth.uid())
      AND a.company_id IS NOT NULL
      AND a.company_id::text = p_folder
  );
$$;

REVOKE ALL ON FUNCTION public.user_can_access_company_storage_folder(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_access_company_storage_folder(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_company_storage_folder(text) TO service_role;

COMMENT ON FUNCTION public.user_can_access_company_storage_folder(text) IS
  'Storage RLS helper: first path segment must equal accounts.company_id for auth.uid().';

-- Optional: create the bucket if missing.
-- If the bucket already exists (created via Dashboard), this does not change its settings
-- (e.g. public/private), because it is ON CONFLICT DO NOTHING.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-assets',
  'company-assets',
  true,
  5242880,
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/svg+xml',
    'image/webp'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Replace dashboard / older policy names so this migration is idempotent in spirit.
DROP POLICY IF EXISTS "company_assets_upload" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_upload_own" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_read_own" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_update_own" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_delete_own" ON storage.objects;

DROP POLICY IF EXISTS "company_assets_authenticated_select" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_authenticated_insert" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "company_assets_authenticated_delete" ON storage.objects;

-- CREATE POLICY has no IF NOT EXISTS, so we guard with pg_policies checks.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'company_assets_authenticated_select'
  ) THEN
    CREATE POLICY "company_assets_authenticated_select"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'company-assets'
        AND public.user_can_access_company_storage_folder((storage.foldername(name))[1])
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'company_assets_authenticated_insert'
  ) THEN
    CREATE POLICY "company_assets_authenticated_insert"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'company-assets'
        AND public.user_can_access_company_storage_folder((storage.foldername(name))[1])
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'company_assets_authenticated_update'
  ) THEN
    CREATE POLICY "company_assets_authenticated_update"
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'company-assets'
        AND public.user_can_access_company_storage_folder((storage.foldername(name))[1])
      )
      WITH CHECK (
        bucket_id = 'company-assets'
        AND public.user_can_access_company_storage_folder((storage.foldername(name))[1])
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'company_assets_authenticated_delete'
  ) THEN
    CREATE POLICY "company_assets_authenticated_delete"
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'company-assets'
        AND public.user_can_access_company_storage_folder((storage.foldername(name))[1])
      );
  END IF;
END $$;
