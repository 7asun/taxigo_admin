-- Quote-level input mode for the Angebot builder.
-- 'net'  (default): dispatcher enters net prices; engine computes tax + gross.
-- 'gross': dispatcher enters gross prices; engine interprets price inputs as gross
--         and converts them to net-equivalents using tax_rate before computing.
-- Default 'net' preserves existing behaviour for all current quotes.
ALTER TABLE public.angebote
  ADD COLUMN input_mode text NOT NULL DEFAULT 'net';

ALTER TABLE public.angebote
  ADD CONSTRAINT angebote_input_mode_check
  CHECK (input_mode IN ('net', 'gross'));

