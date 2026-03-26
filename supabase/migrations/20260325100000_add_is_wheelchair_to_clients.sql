-- Rollstuhl preference on client profile; prefills trip passenger wheelchair when linking client.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_wheelchair BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clients.is_wheelchair IS 'Passenger typically requires wheelchair-capable vehicle; prefills Rollstuhl when creating trips from this client.';
