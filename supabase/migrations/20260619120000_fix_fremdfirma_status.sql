-- Backfill: Fremdfirma-assigned trips should be status 'assigned', not 'pending'/'open'.
-- driver_id IS NULL is intentional for Fremdfirma rows — only status was wrong on legacy writes.
UPDATE trips
SET status = 'assigned'
WHERE fremdfirma_id IS NOT NULL
  AND status IN ('pending', 'open')
  AND driver_id IS NULL;
