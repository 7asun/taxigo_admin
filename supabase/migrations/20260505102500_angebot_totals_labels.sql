-- Stores per-quote custom labels for the PDF totals block rows.
-- Defaults match the German standard labels used in Phase 4.
-- NULL means "use the default label" — the app falls back to the
-- default string when null, so existing quotes are unaffected.
ALTER TABLE public.angebote
  ADD COLUMN totals_label_net   text,
  ADD COLUMN totals_label_tax   text,
  ADD COLUMN totals_label_gross text;

