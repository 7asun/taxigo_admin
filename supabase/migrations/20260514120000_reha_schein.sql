-- Reha Schein: payer-level gate + trip flag + recurring_rules mirror.
--
-- why recurring_rules.reha_schein: Cron materialization copies rule → trip like
-- kts_document_applies so generated trips inherit the flag instead of always defaulting false.

-- Gate: only payers with this enabled show the trip-level Reha switch in admin UI.
ALTER TABLE public.payers
  ADD COLUMN IF NOT EXISTS reha_schein_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS reha_schein boolean NOT NULL DEFAULT false;

ALTER TABLE public.recurring_rules
  ADD COLUMN IF NOT EXISTS reha_schein boolean NOT NULL DEFAULT false;
