-- Trips list "Rechnungsstatus" filter — matches client resolution in
-- trip-invoice-status-badge.tsx: paid > sent > draft > uninvoiced;
-- cancelled / corrected invoices are ignored.

CREATE OR REPLACE FUNCTION public.trip_ids_matching_invoice_effective_status(
  p_effective text
)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT t.id
  FROM public.trips t
  WHERE
    CASE trim(p_effective)
      WHEN 'uninvoiced' THEN NOT EXISTS (
        SELECT 1
        FROM public.invoice_line_items li
        JOIN public.invoices i ON i.id = li.invoice_id
        WHERE li.trip_id = t.id
          AND i.status IN ('draft', 'sent', 'paid')
      )
      WHEN 'paid' THEN EXISTS (
        SELECT 1
        FROM public.invoice_line_items li
        JOIN public.invoices i ON i.id = li.invoice_id
        WHERE li.trip_id = t.id
          AND i.status = 'paid'
      )
      WHEN 'sent' THEN EXISTS (
        SELECT 1
        FROM public.invoice_line_items li
        JOIN public.invoices i ON i.id = li.invoice_id
        WHERE li.trip_id = t.id
          AND i.status = 'sent'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.invoice_line_items li
        JOIN public.invoices i ON i.id = li.invoice_id
        WHERE li.trip_id = t.id
          AND i.status = 'paid'
      )
      WHEN 'draft' THEN EXISTS (
        SELECT 1
        FROM public.invoice_line_items li
        JOIN public.invoices i ON i.id = li.invoice_id
        WHERE li.trip_id = t.id
          AND i.status = 'draft'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.invoice_line_items li
        JOIN public.invoices i ON i.id = li.invoice_id
        WHERE li.trip_id = t.id
          AND i.status IN ('sent', 'paid')
      )
      ELSE FALSE
    END;
$$;

COMMENT ON FUNCTION public.trip_ids_matching_invoice_effective_status(text) IS
$$Fahrtenliste filter by effective Rechnungsstatus (same rules as TripInvoiceStatusBadge).$$;

GRANT EXECUTE ON FUNCTION public.trip_ids_matching_invoice_effective_status(text)
  TO authenticated;
