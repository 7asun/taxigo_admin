-- Rückfahrt semantics aligned with Neue Fahrt / billing returnPolicy.
ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS return_mode text;

UPDATE public.recurring_rules
SET return_mode = CASE
  WHEN COALESCE(return_trip, false) IS NOT TRUE THEN 'none'
  WHEN return_time IS NOT NULL AND btrim(return_time::text) <> '' THEN 'exact'
  ELSE 'time_tbd'
END
WHERE return_mode IS NULL;

ALTER TABLE public.recurring_rules
  ALTER COLUMN return_mode SET NOT NULL,
  ADD CONSTRAINT recurring_rules_return_mode_check CHECK (
    return_mode = ANY (ARRAY['none'::text, 'time_tbd'::text, 'exact'::text])
  );

COMMENT ON COLUMN public.recurring_rules.return_mode IS
  'Rückfahrt mode: none | time_tbd (Zeitabsprache, no return_time) | exact (return_time required). Keeps return_trip in sync on save from the app.';
