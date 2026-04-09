# Rechnungsempfänger (invoice recipient catalog)

> See [access-control.md](access-control.md) for the full role-based access control architecture.


Catalog table `rechnungsempfaenger` holds optional **legal invoice addressees** distinct from the Kostenträger (payer) or Fahrgast (client). Assignments cascade: **billing variant → billing type → payer** (same idea as KTS defaults). See `src/features/invoices/lib/resolve-rechnungsempfaenger.ts`.

## Admin UI

- List / CRUD: **Dashboard → Rechnungsempfänger** (`/dashboard/rechnungsempfaenger`).
- Assignment: recipient select on payer sheet and on billing family / variant dialogs (`rechnungsempfaenger_id` FKs).

## Builder integration

The catalog cascade (**variant → billing type → payer**) is implemented in `resolve-rechnungsempfaenger.ts` as a **pure** function: callers pass the three optional FK targets from loaded catalog rows; there is no DB access inside the resolver.

### Step 2 — recipient preview (before trips)

After Kostenträger (and optional Abrechnungsfamilie) are chosen, the UI shows a **non-binding preview** using `resolveRechnungsempfaenger` with **only** `billingTypeRechnungsempfaengerId` and `payerRechnungsempfaengerId` ( **`billingVariantRechnungsempfaengerId` is omitted / null** ).

**Intentional deviation:** the wizard has **no Unterart (billing variant) picker** in step 2. Variant-level `rechnungsempfaenger_id` is unknown until trips are loaded; each trip carries its `billing_variant_id` and joined recipient FKs. The preview therefore implements **billing type → payer** only, with a short hint that the first trip’s Unterart may still change the resolved recipient after **Fahrten laden**.

### Step 3 — catalog default for the invoice

When trips load, `useInvoiceBuilder` resolves the recipient from the **first trip’s** joined variant / type / payer FKs and stores `catalogRecipientId`. That value drives step 4 defaults and the **Automatisch (Katalog — erste Fahrt)** behaviour unless the user overrides.

### Step 4 — confirmation block and override

Step 4 shows a read-only **Rechnungsempfänger** block: resolved **name** and **full address** from the catalog row for the effective recipient. The dropdown **Rechnungsempfänger (Anpassung)** only changes **`invoices.rechnungsempfaenger_id`** (and the frozen snapshot) for **this** invoice; it does **not** mutate payer / family / variant assignments.

**„Manuell überschrieben“** appears when the selected UUID in the dropdown is **not** equal to `catalogRecipientId` (the cascade from the first trip). Choosing a different catalog row is an explicit per-invoice override; keeping the pre-selected UUID is not labelled as override.

### Persistence (§14 UStG)

At creation, `createInvoice` sets `rechnungsempfaenger_id` and `rechnungsempfaenger_snapshot` once; both are immutable on issued invoices.

## Invoice builder (legacy summary)

- **Automatisch** uses `catalogRecipientId` from the first loaded trip when the user leaves the recipient select on the automatic option.
- A specific recipient overrides that default for this invoice only.

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
