-- ============================================================
-- Migration: 05_kundennummer_system
--
-- Purpose:   Implements a fully isolated, robust auto-increment
--            system for Client and Payer numbers.
--
-- Storage:   Both numbers are natively stored as INTEGER in the
--            database to guarantee lightning-fast indexing and 
--            error-free sorting.
--
-- Formatting: Prefixing (e.g. 'KND-NR-') is intentionally skipped
--            in the database and visually handled on the UI.
--
-- Run once in: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- 1. FAHRGÄSTE (CLIENTS)
-- ════════════════════════════════════════════════════════════

-- Step 1.1: Add the integer column explicitly
ALTER TABLE public.clients
ADD COLUMN IF NOT EXISTS customer_number INTEGER;

-- Step 1.2: Enforce uniqueness per taxi company
ALTER TABLE public.clients
DROP CONSTRAINT IF EXISTS clients_customer_number_company_id_key;

ALTER TABLE public.clients
ADD CONSTRAINT clients_customer_number_company_id_key UNIQUE (company_id, customer_number);

-- Step 1.3: Define the isolated trigger function.
CREATE OR REPLACE FUNCTION public.assign_client_number()
RETURNS TRIGGER AS $$
DECLARE
  next_num INTEGER;
BEGIN
  -- Only physically assign a new number if the UI sends "null" (meaning "please auto-assign")
  IF NEW.customer_number IS NULL THEN
    -- COALESCE gracefully defaults to 9999 for the very first client ever created in a company.
    -- The + 1 increments it perfectly to precisely 10000.
    SELECT COALESCE(MAX(customer_number), 9999) + 1 
    INTO next_num
    FROM public.clients
    WHERE company_id = NEW.company_id;

    NEW.customer_number := next_num;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 1.4: Attach the trigger to intercept purely BEFORE insertions
DROP TRIGGER IF EXISTS ensure_client_number ON public.clients;
CREATE TRIGGER ensure_client_number
BEFORE INSERT ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.assign_client_number();


-- ════════════════════════════════════════════════════════════
-- 2. KOSTENTRÄGER (PAYERS)
-- ════════════════════════════════════════════════════════════

-- Step 2.1: Gracefully convert existing strings.
-- If the column has a default value like `''` (empty string), Postgres will refuse
-- to cast it to INTEGER. We must drop the default first.
ALTER TABLE public.payers 
ALTER COLUMN number DROP DEFAULT;

-- Since empty strings `''` will become perfectly clean `NULL` integers, 
-- we must temporarily drop the `NOT NULL` constraint so Postgres doesn't panic on existing rows.
ALTER TABLE public.payers
ALTER COLUMN number DROP NOT NULL;

-- Now safely alter the type. If any existing payer has a string like "5A", 
-- the regexp_replace strips out the letters ('A') leaving strictly the digits.
ALTER TABLE public.payers 
ALTER COLUMN number TYPE INTEGER 
USING (NULLIF(regexp_replace(number, '\D', '', 'g'), '')::INTEGER);

-- Step 2.2: Enforce uniqueness per taxi company
ALTER TABLE public.payers
DROP CONSTRAINT IF EXISTS payers_number_company_id_key;

ALTER TABLE public.payers
ADD CONSTRAINT payers_number_company_id_key UNIQUE (company_id, number);

-- Step 2.3: Define the Kostenträger trigger function
CREATE OR REPLACE FUNCTION public.assign_payer_number()
RETURNS TRIGGER AS $$
DECLARE
  next_num INTEGER;
BEGIN
  -- Safely auto-assign starting at 50000.
  IF NEW.number IS NULL THEN
    -- COALESCE strictly defaults to `49999`. 
    -- The + 1 creates the perfectly sequential `50000` for the first Payer.
    SELECT COALESCE(MAX(number), 49999) + 1 
    INTO next_num
    FROM public.payers
    WHERE company_id = NEW.company_id;

    NEW.number := next_num;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 2.4: Attach the trigger
DROP TRIGGER IF EXISTS ensure_payer_number ON public.payers;
CREATE TRIGGER ensure_payer_number
BEFORE INSERT ON public.payers
FOR EACH ROW
EXECUTE FUNCTION public.assign_payer_number();


-- ════════════════════════════════════════════════════════════
-- Column comments — METADATA
-- ════════════════════════════════════════════════════════════

COMMENT ON COLUMN public.clients.customer_number IS
$$Pure sequential integer identifying a passenger (Fahrgast).
Auto-incremented starting at 10000 via assign_client_number() trigger.
Unique per company_id. Stored as integer for sorting efficiency.
Visually formatted as 'KND-NR-[number]' on the Frontend.$$;

COMMENT ON COLUMN public.payers.number IS
$$Pure sequential integer identifying a payer (Kostenträger).
Auto-incremented starting at 50000 via assign_payer_number() trigger.
Unique per company_id. Converted from legacy TEXT into INTEGER.
Visually formatted as 'KTR-NR-[number]' on the Frontend.$$;

-- ════════════════════════════════════════════════════════════
-- 3. POST-MIGRATION SEQUENCE OVERRIDE
-- ════════════════════════════════════════════════════════════

-- This block forcefully sanitizes the entire database. If you imported legacy 
-- string numbers (e.g. "643232") this script aggressively overrides them 
-- with the strict perfectly partitioned 50000+ (for Payers) and 10000+ (for Clients) 
-- Enterprise sequence using an advanced Window Function.

-- 3.1 Force-Sequence all Clients
WITH numbered_clients AS (
  SELECT id, company_id,
         row_number() OVER (PARTITION BY company_id ORDER BY created_at ASC) as rn
  FROM public.clients
)
UPDATE public.clients c
SET customer_number = 9999 + nc.rn
FROM numbered_clients nc
WHERE c.id = nc.id;

-- 3.2 Force-Sequence all Payers
WITH numbered_payers AS (
  SELECT id, company_id,
         row_number() OVER (PARTITION BY company_id ORDER BY created_at ASC) as rn
  FROM public.payers
)
UPDATE public.payers p
SET number = 49999 + np.rn
FROM numbered_payers np
WHERE p.id = np.id;

-- ════════════════════════════════════════════════════════════
-- 4. FINAL CONSTRAINT LOCKING
-- ════════════════════════════════════════════════════════════

-- Now that every single historical row has successfully been assigned an integer,
-- we strictly lock the schema down by enforcing NOT NULL. No future row will ever dynamically be empty.

ALTER TABLE public.clients
ALTER COLUMN customer_number SET NOT NULL;

ALTER TABLE public.payers
ALTER COLUMN number SET NOT NULL;
