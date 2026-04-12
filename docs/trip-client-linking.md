# Trip passenger linking (`client_id` vs `client_name`)

Trips store passenger identity in two places:

| Field         | Meaning |
|---------------|---------|
| `client_id`   | Optional FK to `clients` (Stammdaten). When set, the trip is tied to a registered passenger. |
| `client_name` | Denormalized display string (first + last or CSV text). Used for lists, PDFs, and search even when `client_id` is null. |

## Three passenger situations

1. **Stammdaten-linked** — `client_id` is set (and `client_name` usually matches the client record). Invoice **per_client** mode, Fahrgast filters, and combination discovery use this FK.
2. **Named but not registered** — `client_name` is non-empty, `client_id` is null. Valid for occasional passengers not in Stammdaten. Such trips **do not** appear when the invoice builder filters with `eq('client_id', …)` for a specific Fahrgast.
3. **Anonymous** — both `client_id` and `client_name` are null (e.g. manual form without passenger requirement).

## Best-effort enrichment at creation

The system tries to set `client_id` when the display name **unambiguously** matches exactly one client in the same **company**:

- **SQL backfill** — migration `20260412120000_backfill_trip_client_ids.sql` updates historical trips where `client_id` was null.
- **RPC** — `resolve_client_id_by_name(p_company_id, p_full_name)` returns a UUID only when the normalized full name (`lower(trim(concat_ws(' ', first_name, last_name)))`) matches exactly one row in `clients` for that company.
- **Manual create-trip form** — debounced, silent: after Kostenträger is chosen, free-text first/last names trigger the RPC; no toast or blocking.
- **CSV bulk upload** — `matchClient` runs first (phone / first+last / last+ZIP rules). If it does not resolve, `resolveClientByName` runs with the CSV full name as a second chance, using the same normalization as the RPC.

Ambiguous names (multiple clients) or no match leave `client_id` null; behaviour stays non-blocking.

## Invoice builder note

`fetchTripsForBuilder` in `src/features/invoices/api/invoice-line-items.api.ts` scopes **per_client** trips with `.eq('client_id', params.client_id)`. Trips with only `client_name` remain excluded until linked or backfilled.

The same fetch returns **`client_price_tags`** for all distinct trip clients so invoice line pricing can apply **scoped** Kunden-Preise before billing rules — see [client-price-tags.md](client-price-tags.md).
