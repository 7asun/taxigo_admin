-- Phase 4: Admin shift entry on behalf of drivers (payroll actuals).
-- WHY entered_by: audit trail when admin creates/overwrites shift records (D1).
-- WHY unique index on Berlin calendar date: one shift per driver per business day (DB enforced).
-- WHY admin RLS only (not driver policy changes): driver self-entry path unchanged.

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS entered_by uuid
    REFERENCES public.accounts(id) ON DELETE SET NULL DEFAULT NULL;

COMMENT ON COLUMN public.shifts.entered_by IS
  'Account that created this shift record. NULL = driver self-entered via app. '
  'Set to admin account id when created by an admin on behalf of a driver. '
  'Used for audit and dispute resolution.';

-- Remove duplicate shifts keeping the most recently created row per
-- driver per Berlin calendar date. Earlier rows are less likely to be
-- the intended payroll record; admin can re-enter if needed.
-- WHY keep latest: created_at DESC is the safest heuristic for
-- accidental duplicates created by the driver form's delete-then-insert
-- overwrite path. If two rows exist, the second insert was the intended one.
-- shift_events has no ON DELETE CASCADE in app code (events deleted explicitly
-- in shifts.service.ts deleteShift) — delete events before duplicate shifts.

DELETE FROM public.shift_events
WHERE shift_id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY
          driver_id,
          (started_at AT TIME ZONE 'Europe/Berlin')::date
        ORDER BY created_at DESC
      ) AS rn
    FROM public.shifts
  ) ranked
  WHERE rn > 1
);

DELETE FROM public.shifts
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY
          driver_id,
          (started_at AT TIME ZONE 'Europe/Berlin')::date
        ORDER BY created_at DESC
      ) AS rn
    FROM public.shifts
  ) ranked
  WHERE rn > 1
);

-- One row per driver per Berlin calendar date (matches getZonedDayBoundsIso / unique index logic).
CREATE UNIQUE INDEX IF NOT EXISTS shifts_driver_berlin_date_unique
  ON public.shifts (
    driver_id,
    ((started_at AT TIME ZONE 'Europe/Berlin')::date)
  );

-- Admin INSERT: same company, driver must belong to company and have role driver.
CREATE POLICY shifts_insert_company_admin
  ON public.shifts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
    AND EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = driver_id
        AND a.company_id = public.current_user_company_id()
        AND a.role = 'driver'
    )
  );

CREATE POLICY shifts_update_company_admin
  ON public.shifts
  FOR UPDATE
  TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

CREATE POLICY shifts_delete_company_admin
  ON public.shifts
  FOR DELETE
  TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

CREATE POLICY shift_events_insert_company_admin
  ON public.shift_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = shift_events.shift_id
        AND s.company_id = public.current_user_company_id()
    )
  );

CREATE POLICY shift_events_delete_company_admin
  ON public.shift_events
  FOR DELETE
  TO authenticated
  USING (
    public.current_user_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = shift_events.shift_id
        AND s.company_id = public.current_user_company_id()
    )
  );
