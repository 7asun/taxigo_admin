# Audit: `InvoicePdfCoverHeader` (read-only)

**Scope:** `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-header.tsx`, parents that render `<InvoicePdfCoverHeader />`, prop types, and data sources. No code changes.

---

## 1. Customer number rendering

### Where in `invoice-pdf-cover-header`

- **Component:** The number is **not** rendered on the root `InvoicePdfCoverHeader` JSX directly; it is rendered inside the extracted **`InvoicePdfMetaGrid`** sub-component (right column).
- **Prop:** `customerNumber` (`InvoicePdfCoverHeaderProps.customerNumber`, type `string | number`). It is passed from `InvoicePdfCoverHeader` into `InvoicePdfMetaGrid` unchanged.
- **JSX:** A meta row with label `Kundennummer` and value `{customerNumber || '—'}` — i.e. a `<Text style={styles.metaLabel}>` for the label and `<Text style={styles.metaValue}>` for the value (see `invoice-pdf-cover-header.tsx` in `InvoicePdfMetaGrid`).

### Elsewhere in the invoice PDF

- **Invoice PDF stack:** Grep across `src/features/invoices/components/invoice-pdf` shows **`Kundennummer` / `customerNumber` / `customer_number` only** in:
  - `invoice-pdf-cover-header.tsx` (`InvoicePdfMetaGrid`),
  - `invoice-pdf-cover-header-brief.tsx` (forwards the same prop into `InvoicePdfMetaGrid`),
  - `InvoicePdfDocument.tsx` (computes and passes `customerNumber` into the header components).
- **Cover body, appendix, footer:** No customer-number label or field in `invoice-pdf-cover-body.tsx`, `invoice-pdf-appendix.tsx`, or `invoice-pdf-footer.tsx` (verified via search).
- **Angebote PDF:** `AngebotPdfDocument.tsx` passes `customerNumber={angebot.customer_number ?? ''}` into the same header/meta grid; still only in that meta block, not in `AngebotPdfCoverBody` by this grep (offer body uses recipient salutation fields separately).

**Conclusion:** For standard invoice/offer PDFs in this repo, the customer number appears **only** in the **right-hand “Rechnungsdaten” / “Angebotsdaten” meta grid** (including Brief mode, where `InvoicePdfCoverHeaderBrief` renders the same grid without the in-flow recipient).

---

## 2. Anrede field

### Props interface

- **`InvoicePdfCoverHeaderProps` includes `anrede` nested under `recipient`**, not as a top-level prop.
- **Type:** `recipient.anrede?: string | null` (optional).
- **Usage in this file:** Used inside **`InvoicePdfRecipientBlock`**, which destructures `anrede: recipientAnrede` from `recipient`. It participates in the optional person line: if `recipientAnrede || recipientFirstName || recipientLastName`, a single `<Text style={styles.addressPersonName}>` renders `[recipientAnrede, recipientFirstName, recipientLastName].filter(Boolean).join(' ')`.

### If not on props — where it lives in parent data

- **Invoices:** Structured `anrede` on the cover recipient comes from the frozen snapshot when present: `InvoicePdfDocument` builds `snapshotWindowRecipient` with `anrede: snapPrimary.anrede`. That value originates from **`rechnungsempfaenger_snapshot`** parsing in `recipientFromRechnungsempfaengerSnapshot` (`lib/rechnungsempfaenger-pdf.ts`), where **`PdfCoverRecipient.anrede`** is typed as **`string | null`** (from JSON `anrede`). Live **`InvoiceDetail.client`** has **`greeting_style`** (e.g. `Herr` / `Frau`) but **`clientWindowRecipient` sets `anrede: null`** — the letter salutation in the body uses a separate `salutation` string computed in `InvoicePdfDocument`, not `recipient.anrede`.
- **Angebote:** **`AngebotRow.recipient_anrede`** is **`'Herr' | 'Frau' | null`**. The object passed as `recipient` to `InvoicePdfCoverHeader` **does not** include `anrede` / `firstName` / `lastName`; the PDF header address line uses **`personName`** (and `companyName`) built in `AngebotPdfDocument`, which can embed the salutation in that string when `recipient_last_name` is set. **`AngebotPdfCoverBody`** receives `recipientAnrede` as its own props for the offer letter text.

### First element at the very top of the header (`InvoicePdfCoverHeader`)

- The **first JSX node** returned by `InvoicePdfCoverHeader` is:

  `<View style={styles.headerRow}>`

- The first visual block inside the **left** column is from **`InvoicePdfBrandingBlock`**: its first real child is `<View style={styles.brandStack}>` (optional logo and slogan).

---

## 3. Component structure

### Visual hierarchy (top → bottom, as implemented)

1. **Root row** — `<View style={styles.headerRow}>`: two columns (`headerLeft` | `headerRight`).
2. **Left column (`headerLeft`):**
   - **Branding:** `InvoicePdfBrandingBlock` — logo (if `companyProfile.logo_url`), slogan (if non-empty), then optional sender one-line + horizontal rule (if `senderFit.line`).
   - **Recipient:** `InvoicePdfRecipientBlock` — window addressee (company line, person line, Abteilung, street, address line 2, zip+city, phone), then optional **secondary legal** block (`secondaryLegalRecipient`).
3. **Right column (`headerRight`):**
   - **Meta grid:** `InvoicePdfMetaGrid` — heading, document number, date, Kundennummer, optional tax ID rows, period (or `metaConfig.periodValue`), optional `metaConfig.extraRows`.

### Conditional renders (relevant to header behavior)

- **`InvoicePdfCoverHeader` itself:** No `condition && …` — layout is fixed; behavior differs via subcomponents.
- **`InvoicePdfBrandingBlock`:** Logo if URL; slogan if trimmed non-empty; sender block if `senderFit.line`.
- **`InvoicePdfMetaGrid`:** Tax ID rows if `metaConfig.showTaxIds !== false`; period row uses `metaConfig.periodValue` or date range; `extraRows` filtered to non-empty values; last-row styling depends on `extraRows`.
- **`InvoicePdfRecipientBlock`:** Company name; person line (structured anrede+names **or** legacy `personName` branch); Abteilung; street line (with malformed-address branch); address line 2; zip+city; phone; **secondary legal** block if `secondaryLegalRecipient` is truthy.

---

## 4. Data availability

### `anrede` on `recipient`

- **Not guaranteed:** On `InvoicePdfCoverHeaderProps.recipient`, **`anrede` is optional** (`?`), so callers may omit it (TypeScript) or pass `null` / `undefined`.
- **Invoice PDF:** Often **`null`** for `clientWindowRecipient` and `payerWindowRecipient`; **populated** when the legal addressee is built from **`rechnungsempfaenger_snapshot`** (`snapPrimary.anrede` after `str(snap.anrede) || null` in the parser — empty string becomes `null`).
- **Offer PDF:** Header `recipient` object **typically has no `anrede` field**; salutation is folded into `personName` or handled in the body.

### If `anrede` is empty or null

- In **`InvoicePdfRecipientBlock`**, the structured person line renders only if `recipientAnrede || recipientFirstName || recipientLastName`. If all are falsy, that line is skipped and the component may still show **`personName`** when it differs from **`companyName`** (fallback path for a single display name).
- **Join behavior:** When the structured branch runs, `filter(Boolean)` drops empty `anrede`, so missing salutation still allows “First Last” if those fields exist.

### `customerNumber` / Kundennummer

- **Computed in parents:** `InvoicePdfDocument` sets `customerNumber` to `client?.customer_number ?? ''` when `per_client` and billed to client; else `payer?.number ?? ''`. Falsy values display as **`—`** in the meta grid (`customerNumber || '—'`).
- **Optional source data:** `InvoiceDetail.client.customer_number` is `string | number | null`; payer `number` is `string` on the type but may be empty in practice.

---

## Parent components and data flow (summary)

| Parent | Renders | Props source |
|--------|---------|----------------|
| `InvoicePdfDocument.tsx` | `<InvoicePdfCoverHeader />` (digital) or `<InvoicePdfCoverHeaderBrief />` (brief) | **`invoice: InvoiceDetail`** — `getInvoiceDetail` selects `clients(..., customer_number, ...)` and `payers(..., number, ...)`; recipient/snapshot logic inline; **`useInvoiceDetail`** wraps `getInvoiceDetail` + `enrichInvoiceDetailWithColumnProfile`. Builder: **`buildDraftInvoiceDetailForPdf`** → same `InvoicePdfDocument`. |
| `AngebotPdfDocument.tsx` | Same header / brief pattern | **`angebot: AngebotWithLineItems`**, **`companyProfile`**, `customer_number` and recipient fields from angebot row. |

**Primary data-fetching hook for issued invoice PDFs:** `useInvoiceDetail` in `src/features/invoices/hooks/use-invoice.ts` (React Query, `getInvoiceDetail` + column profile enrichment). **Builder preview:** `useInvoiceBuilderPdfPreview` feeds `InvoicePdfDocument` with a draft from `buildDraftInvoiceDetailForPdf`.

---

## File references (for navigation)

- Header implementation: `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-header.tsx`
- Invoice parent: `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx`
- Offer parent: `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx`
- Snapshot / `PdfCoverRecipient`: `src/features/invoices/components/invoice-pdf/lib/rechnungsempfaenger-pdf.ts`
- Types: `InvoicePdfCoverHeaderProps` in `invoice-pdf-cover-header.tsx`; `InvoiceDetail` in `src/features/invoices/types/invoice.types.ts`

---

## Changes Applied

**Date:** 2026-05-02

- **Added** a **standalone `recipient.anrede` line** as the **first** child inside `InvoicePdfRecipientBlock`’s `recipientBlock` `<View>` (before company name and before the existing structured person line). It renders only when `anrede` is truthy and `String(anrede).trim()` is non-empty, using `styles.addressPersonName` (same typography as the person line below — intentional for visual consistency).
- **Renamed** destructuring from `anrede: recipientAnrede` to **`anrede`**; the existing join line **`[anrede, firstName, lastName]`** is unchanged in behavior aside from the variable name.
- Inline comment at the site: *Anrede rendered as first standalone line in recipient block, above company/person name*.

Earlier sections of this document remain **historical** where they describe recipient order before this change (e.g. no standalone Anrede line, or references to phone in the block).
