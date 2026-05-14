# Trips list performance

## Deferred invoice status (list view)

The main RSC query for `/dashboard/trips` in **list** view intentionally **does not** embed `invoice_line_items → invoices`. That join enlarged the PostgREST payload and work on every page load even though Rechnungsstatus is secondary to row layout.

**Two-phase load**

1. **RSC** returns trip rows with payer, billing variant, driver, and Fremdfirma embeds only (`trips-listing.tsx`).
2. **Client** (`TripInvoiceStatusesProvider` + `useTripInvoiceStatuses`) fetches `invoice_line_items` for the **visible trip IDs only**, via `fetchTripInvoiceStatuses` in `trips.service.ts`.

Badges render one frame later: while `useQuery` is pending, cells show a neutral skeleton; once data arrives, `TripInvoiceStatusBadge` uses the same `resolveEffectiveTripInvoiceStatus` rules as before.

**React Query key**

`tripKeys.invoiceStatuses(tripIds)` sorts IDs so the key is stable regardless of server row order. **`staleTime`** is `TRIP_REFERENCE_STALE_TIME_MS` (10 minutes), shared with trip reference queries — invoice status on this screen does not need to be more fresh than the list itself.

**Invalidation**

`TripsRscRefreshProvider.refreshTripsPage()` calls `invalidateQueries({ queryKey: tripKeys.all })`, which also invalidates keys under the `trips` prefix, including invoice-status queries.

**Kanban**

Kanban still uses the previous select shape (including `invoice_line_items`) until decoupled in a separate change.
