-- Best-effort backfill: for trips with client_name but no client_id,
-- attempt to resolve a unique client match within the same company.
-- Only updates rows where exactly ONE client matches by normalized full name — ambiguous
-- or no-match rows are left unchanged.
--
-- Normalization matches resolve_client_id_by_name() (lower(trim(...)), concat_ws for names).

UPDATE trips t
SET client_id = c.id
FROM clients c
WHERE t.client_id IS NULL
  AND t.client_name IS NOT NULL
  AND trim(t.client_name) <> ''
  AND t.company_id = c.company_id
  AND lower(trim(t.client_name)) =
      lower(trim(concat_ws(' ', c.first_name, c.last_name)))
  AND (
    SELECT COUNT(*)::int
    FROM clients c2
    WHERE c2.company_id = t.company_id
      AND lower(trim(concat_ws(' ', c2.first_name, c2.last_name)))
          = lower(trim(t.client_name))
  ) = 1;

-- Runtime helper for manual trip form / TS: single round-trip, same semantics as backfill.
CREATE OR REPLACE FUNCTION public.resolve_client_id_by_name(
  p_company_id uuid,
  p_full_name text
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.id
  FROM clients c
  WHERE p_company_id IS NOT NULL
    AND trim(COALESCE(p_full_name, '')) <> ''
    AND c.company_id = p_company_id
    AND lower(trim(concat_ws(' ', c.first_name, c.last_name))) =
        lower(trim(p_full_name))
    AND (
      SELECT COUNT(*)::int
      FROM clients c2
      WHERE c2.company_id = p_company_id
        AND lower(trim(concat_ws(' ', c2.first_name, c2.last_name))) =
            lower(trim(p_full_name))
    ) = 1
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.resolve_client_id_by_name(uuid, text) IS
$$Best-effort: returns clients.id when exactly one Stammdaten row in the company has the same normalized display name as p_full_name; otherwise NULL.$$;

GRANT EXECUTE ON FUNCTION public.resolve_client_id_by_name(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_client_id_by_name(uuid, text) TO service_role;
