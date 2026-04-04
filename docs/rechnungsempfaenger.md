# Rechnungsempfänger (invoice recipient catalog)

Catalog table `rechnungsempfaenger` holds optional **legal invoice addressees** distinct from the Kostenträger (payer) or Fahrgast (client). Assignments cascade: **billing variant → billing type → payer** (same idea as KTS defaults). See `src/features/invoices/lib/resolve-rechnungsempfaenger.ts`.

## Admin UI

- List / CRUD: **Dashboard → Rechnungsempfänger** (`/dashboard/rechnungsempfaenger`).
- Assignment: recipient select on payer sheet and on billing family / variant dialogs (`rechnungsempfaenger_id` FKs).

## Invoice builder (step 4)

- **Automatisch (Katalog — erste Fahrt)** uses the cascade from the **first loaded trip** after step 2.
- A specific recipient overrides that default. The chosen row is stored as `invoices.rechnungsempfaenger_id` and a frozen JSON snapshot in `invoices.rechnungsempfaenger_snapshot` at creation (§14 UStG immutability).

## PDF layout

- **`per_client`**: Fahrgast remains the primary window addressee and salutation; if a snapshot exists, a second block **„Rechnungsempfänger / Zahlungspflichtiger“** shows the frozen address (`InvoicePdfDocument` + `invoice-pdf-cover-header.tsx`).
- **`monthly` / `single_trip`**: If a snapshot exists, it is the **only** legal addressee in the window; otherwise the legacy payer address is used.

Snapshot parsing for the PDF lives in `src/features/invoices/components/invoice-pdf/lib/rechnungsempfaenger-pdf.ts`.

## API / service

- `src/features/rechnungsempfaenger/api/rechnungsempfaenger.service.ts` — list, `getById`, CRUD; `rechnungsempfaengerRowToSnapshot()` for invoice insert.

TanStack Query key: `referenceKeys.rechnungsempfaenger()` (see `src/query/README.md`).

## Legacy PDF fallback (monthly / single_trip, no snapshot)

When `invoices.rechnungsempfaenger_snapshot` is missing or empty, the cover window uses the joined **Kostenträger** row with these columns (see `payerWindowRecipient` in `InvoicePdfDocument.tsx`):

- `payers.name`
- `payers.street`
- `payers.street_number`
- `payers.zip_code`
- `payers.city`

## V2 (planned)

- **`clients.rechnungsempfaenger_id`** — optional FK so a Fahrgast-level Rechnungsempfänger can participate in the cascade (e.g. after variant / type / payer). Not implemented in V1; resolver and PDF would be extended when this ships.
