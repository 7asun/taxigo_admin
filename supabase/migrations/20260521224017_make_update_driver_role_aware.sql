-- Migration: make update_driver() role-aware
-- Reason: the prior implementation always upserted driver_profiles regardless
-- of accounts.role. Admins should never have profile rows — this caused silent
-- data creation when an admin was edited via PATCH /api/drivers/[id].
-- Approach: read the effective role after the accounts UPDATE and skip the
-- profile block entirely when role = 'admin'.
-- Safe to deploy before API changes: API always passes null for profile fields
-- on admin edits; the RPC simply stops acting on those nulls.
-- See: docs/plans/update-driver-rpc-audit.md, docs/plans/approach-b-audit.md

-- ── Step 1: replace the function body (same signature — preserves GRANTs) ──

CREATE OR REPLACE FUNCTION public.update_driver(
  p_driver_id        uuid,
  p_name             text    DEFAULT NULL,
  p_first_name       text    DEFAULT NULL,
  p_last_name        text    DEFAULT NULL,
  p_phone            text    DEFAULT NULL,
  p_role             text    DEFAULT NULL,
  p_license_number   text    DEFAULT NULL,
  p_default_vehicle_id uuid  DEFAULT NULL,
  p_street           text    DEFAULT NULL,
  p_street_number    text    DEFAULT NULL,
  p_zip_code         text    DEFAULT NULL,
  p_city             text    DEFAULT NULL,
  p_lat              double precision DEFAULT NULL,
  p_lng              double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account      jsonb;
  v_profiles     jsonb;
  v_effective_role text;
BEGIN
  -- Update the account row first so we can read the effective role below.
  -- COALESCE preserves the existing role when p_role is not supplied.
  UPDATE accounts SET
    name       = COALESCE(p_name, name),
    first_name = p_first_name,
    last_name  = p_last_name,
    phone      = p_phone,
    role       = COALESCE(p_role, role)
  WHERE id = p_driver_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Driver not found: %', p_driver_id;
  END IF;

  -- Read the effective role *after* the UPDATE so a role-change in the same
  -- call (driver → admin) immediately suppresses profile writes.
  SELECT role INTO v_effective_role
  FROM accounts
  WHERE id = p_driver_id;

  -- Only touch driver_profiles when the account is a driver.
  -- Admins must never have profile rows created or modified by this RPC.
  IF v_effective_role = 'driver' THEN
    UPDATE driver_profiles SET
      license_number      = p_license_number,
      default_vehicle_id  = p_default_vehicle_id,
      street              = p_street,
      street_number       = p_street_number,
      zip_code            = p_zip_code,
      city                = p_city,
      lat                 = p_lat,
      lng                 = p_lng
    WHERE user_id = p_driver_id;

    IF NOT FOUND THEN
      INSERT INTO driver_profiles (
        user_id, license_number, default_vehicle_id,
        street, street_number, zip_code, city, lat, lng
      )
      VALUES (
        p_driver_id, p_license_number, p_default_vehicle_id,
        p_street, p_street_number, p_zip_code, p_city, p_lat, p_lng
      );
    END IF;
  END IF;
  -- When v_effective_role = 'admin': profile block is skipped entirely.
  -- Any pre-existing orphan rows are left in place (cleaned by Step 2 below).

  -- Build and return the composite JSON (same shape as before).
  SELECT to_jsonb(a.*) INTO v_account
  FROM accounts a
  WHERE a.id = p_driver_id;

  SELECT COALESCE(jsonb_agg(p.*), '[]'::jsonb) INTO v_profiles
  FROM driver_profiles p
  WHERE p.user_id = p_driver_id;

  RETURN v_account || jsonb_build_object('driver_profiles', v_profiles);
END;
$$;

-- ── Step 2: clean up orphan driver_profiles rows for admin accounts ──
-- These rows were created by the previous unconditional RPC or manual ops.
-- Deleting them aligns DB state with the new invariant: only drivers have
-- profile rows. Run in same transaction as the RPC replacement so cleanup
-- is atomic with the fix.
-- IMPORTANT: verify row count on staging before deploying to production.
-- If your business has admins who legitimately need profile data for another
-- reason, pause here and confirm the product decision first.

DELETE FROM driver_profiles
WHERE user_id IN (
  SELECT id FROM accounts WHERE role = 'admin'
);
