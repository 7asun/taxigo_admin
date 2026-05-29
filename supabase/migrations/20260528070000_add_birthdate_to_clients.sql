-- Migration to add birthdate to clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS birthdate DATE;

COMMENT ON COLUMN public.clients.birthdate IS 'Optional client birthdate.';
