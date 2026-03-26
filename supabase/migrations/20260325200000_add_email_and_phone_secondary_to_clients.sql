-- Optional contact fields for clients.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS phone_secondary TEXT;

COMMENT ON COLUMN public.clients.email IS 'Optional contact email.';
COMMENT ON COLUMN public.clients.phone_secondary IS 'Optional second phone number.';
