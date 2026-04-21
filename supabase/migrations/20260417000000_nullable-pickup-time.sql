ALTER TABLE recurring_rules
  ALTER COLUMN pickup_time DROP NOT NULL;

COMMENT ON COLUMN recurring_rules.pickup_time IS
  'NULL means daily-agreement (time confirmed day before).
   Non-null means fixed HH:MM:SS schedule.';

