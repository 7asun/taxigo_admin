-- Add logo_path to company_profiles and backfill from existing logo_url.
--
-- Why logo_path?
-- - Stable identifier (bucket-relative path) that does not depend on bucket public/private.
-- - Lets the app generate signed URLs on demand (best practice for private buckets).

ALTER TABLE public.company_profiles
  ADD COLUMN IF NOT EXISTS logo_path text;

COMMENT ON COLUMN public.company_profiles.logo_path IS
$$Bucket-relative path of the company logo in Supabase Storage (company-assets).
Example: "<company_id>/logo.png". The app generates signed URLs from this path.$$;

-- Backfill existing rows that still have logo_url but no logo_path.
-- Supports:
--   /storage/v1/object/public/company-assets/<path>
--   /storage/v1/object/company-assets/<path>
UPDATE public.company_profiles
SET logo_path = regexp_replace(
  logo_url,
  '^.*?/storage/v1/object/(public/)?company-assets/',
  '',
  'i'
)
WHERE logo_path IS NULL
  AND logo_url IS NOT NULL
  AND logo_url ~* '/storage/v1/object/(public/)?company-assets/';

