-- Harden account triggers: run as postgres (SECURITY DEFINER) so auth.users
-- updates succeed regardless of the invoking role (e.g. service_role insert).
-- Bodies unchanged from live DB — only SECURITY DEFINER + search_path added.
-- See docs/plans/driver-create-permission-audit.md

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data = jsonb_set(
    coalesce(raw_app_meta_data, '{}'),
    '{company_id}',
    to_jsonb(new.company_id)
  )
  WHERE id = new.id;

  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_user_company_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data = jsonb_set(
    coalesce(raw_app_meta_data, '{}'::jsonb),
    '{company_id}',
    to_jsonb(new.company_id)
  )
  WHERE id = new.id;

  RETURN new;
END;
$$;

-- ============================================================
-- set_company_id trigger (dashboard-created, not in repo)
-- Discovered during driver-create permission audit 2026-05-24.
-- Hardened to SECURITY DEFINER in this migration (applied via
-- supabase db query --linked). Documented here so local reset
-- and new environments reproduce the trigger correctly.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_company_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data = jsonb_set(
    coalesce(raw_app_meta_data, '{}'),
    '{company_id}',
    to_jsonb(new.company_id)
  )
  WHERE id = new.id;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS set_company_id ON public.accounts;
CREATE TRIGGER set_company_id
  AFTER INSERT ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_company_id();
