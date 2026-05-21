-- WHY: drivers using browser-based tracking stop sending updates when
-- the screen locks or the tab is closed. Without cleanup, stale rows
-- remain in live_locations indefinitely and appear as online on the
-- fleet map. pg_cron removes rows that haven't updated in 10 minutes,
-- keeping the map accurate without manual intervention.

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to postgres role (required by Supabase)
GRANT USAGE ON SCHEMA cron TO postgres;

-- Schedule cleanup job: runs every 5 minutes
-- Deletes rows not updated in the last 10 minutes
SELECT cron.schedule(
  'clean-stale-live-locations',           -- job name (unique)
  '*/5 * * * *',                          -- every 5 minutes
  $$
    DELETE FROM public.live_locations
    WHERE updated_at < now() - interval '10 minutes';
  $$
);
