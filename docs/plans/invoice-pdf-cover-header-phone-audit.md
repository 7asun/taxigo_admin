# Audit: Phone rendering in invoice PDF cover header (read-only)

**Scope:** `invoice-pdf-cover-header.tsx`, `invoice-pdf-cover-header-brief.tsx`, recipient/header construction in `AngebotPdfDocument.tsx`, and phone sourcing in `InvoicePdfDocument.tsx`. No code changes.

---

## 1. Phone number in `InvoicePdfRecipientBlock`

### Prop path and type

- The phone value is **not** a direct prop of `InvoicePdfRecipientBlock`. It is carried on **`recipient.phone`**.
- **`InvoicePdfCoverHeaderProps['recipient']`** declares **`phone: string | null`** (required key on the object; value may be `null`).
- Inside the block, the field is destructured as **`phone: rawPhone`**, then passed through **`normalizeInvoiceRecipientPhone(rawPhone)`** into **`recipientPhone`** (`string | null` after normalization).

### JSX (conditional guard + value)

```tsx
{recipientPhone ? (
  <Text style={styles.addressPhoneLine} wrap={false}>
    {recipientPhone}
  </Text>
) : null}
```

### Label vs raw value

- **No prefix label** (no `Tel.:`, `Telefon`, etc.). The normalized number is rendered **alone** in `styles.addressPhoneLine`.

---

## 2. Phone number in `InvoicePdfMetaGrid`

- **No dedicated phone row** is implemented in `InvoicePdfMetaGrid`. Fixed rows are: heading, document number, date, Kundennummer, optional St.-Nr. / USt-IdNr., period (or `periodValue`), then optional **`metaConfig.extraRows`**.
- **Standard invoice header** (`InvoicePdfDocument` digital/brief): **`metaConfig` is omitted**, so **`extraRows` is empty** — **no phone in the meta grid**.
- **Angebot header:** `metaConfig` sets heading/labels/period only — **no `extraRows`**, so **no phone row** there either.
- **Theoretical path:** `PdfCoverHeaderMetaConfig.extraRows` is documented (JSDoc on the interface) as supporting e.g. recipient **E-Mail / Telefon** as arbitrary `{ label, value }` pairs. Nothing in the current invoice or offer PDF composers passes phone through `extraRows`.

**Brief vs digital:** `InvoicePdfCoverHeaderBrief` uses the **same** `InvoicePdfMetaGrid` — same answer: no built-in phone row unless `extraRows` is populated by a caller.

---

## 3. Other phone-related text in `invoice-pdf-cover-header.tsx` and `invoice-pdf-cover-header-brief.tsx`

### `invoice-pdf-cover-header.tsx` (case-insensitive motifs: `phone`, `telefon`, `tel`, `fon`)

| Location | Context |
|----------|---------|
| Import | `normalizeInvoiceRecipientPhone` from `./lib/rechnungsempfaenger-pdf` |
| Destructuring | `phone: rawPhone` from `recipient` |
| Logic | `const recipientPhone = normalizeInvoiceRecipientPhone(rawPhone);` |
| Comment | Briefkopf sequence comment mentions **Phone** at end of line order |
| Comment | `{/* 6. Phone number (if exists) */}` above the conditional block |
| JSX | `styles.addressPhoneLine` and `{recipientPhone}` (see §1) |
| `InvoicePdfCoverHeaderProps` | `phone: string | null` on `recipient` |
| `PdfCoverHeaderMetaConfig` JSDoc | Example text: recipient **E-Mail / Telefon** via `extraRows` |

**Incidental grep noise:** a substring search for `fon` also hits unrelated identifiers such as **`fontSize`** (e.g. in `InvoicePdfBrandingBlock` / `senderFit`). Those are **not** phone-related.

**`tel`:** The same broad pattern can match substrings inside unrelated tokens (e.g. parts of prop names). Only the rows above are semantically about telephone rendering or normalization.

### `invoice-pdf-cover-header-brief.tsx`

- **No occurrences** of `phone`, `telefon`, `tel`, or `fon` in file content (confirmed with ripgrep). The file only imports `View` and composes `InvoicePdfBrandingBlock` + `InvoicePdfMetaGrid`; `recipient` is accepted as `_recipient` and unused.

---

## 4. Prop source

### `InvoicePdfDocument.tsx`

Phone on the object passed into `InvoicePdfRecipientBlock` / header as **`coverRecipient.phone`** comes from whichever branch wins for **`coverRecipient`**:

| Scenario | Source of `phone` |
|----------|-------------------|
| **`per_client` and frozen snapshot is used** (`snapPrimary`) | **`snapPrimary.phone`** — from **`recipientFromRechnungsempfaengerSnapshot(invoice.rechnungsempfaenger_snapshot)`**, which reads JSON **`snap.phone`**, normalizes via **`normalizeInvoiceRecipientPhone`**, and stores **`phone: phone \|\| null`** on **`PdfCoverRecipient`**. |
| **`per_client` and no snapshot** (client window) | **`recipientPhone`** = **`normalizeInvoiceRecipientPhone(client?.phone ?? null)`** — i.e. **`InvoiceDetail.client.phone`** (joined clients row), or `null` if not per-client or missing. |
| **`monthly` / `single_trip` with snapshot** | **`snapPrimary.phone`** (same snapshot `phone` field). |
| **Legacy payer fallback** (`payerWindowRecipient`) | **`phone: null`** — payer object is not used for a window phone in this shape. |

**Summary:** For invoices, the PDF header phone is either from **`rechnungsempfaenger_snapshot.phone`** (frozen JSON) or **`invoice.client.phone`** (live client, only when per-client and snapshot does not replace the window). Payer-only fallback has **no** phone on the recipient object.

### `AngebotPdfDocument.tsx` (recipient / header props)

- The **`recipient`** object sets **`phone: null as string | null`** explicitly (lines 124–134). **`angebot.recipient_phone`** (present on DB/types for offers) is **not** mapped into `recipient.phone`.
- Therefore the **header recipient block never shows a phone** for offers with the current mapping, unless that behavior is changed elsewhere.

---

## 5. Brief header (`invoice-pdf-cover-header-brief.tsx`)

- **`InvoicePdfCoverHeaderBrief` does not render `InvoicePdfRecipientBlock`.** It renders only **`InvoicePdfBrandingBlock`** (left) and **`InvoicePdfMetaGrid`** (right); `recipient` and `secondaryLegalRecipient` are intentionally unused (`_recipient`, `_secondaryLegalRecipient`).
- **Phone in the address window** in Brief mode is **not** part of this component: **`InvoicePdfDocument` / `AngebotPdfDocument`** place **`InvoicePdfRecipientBlock`** in a **page-level absolute `View`** at `PDF_DIN5008.addressWindowTop`, using the same **`coverRecipient` / `recipient`** data as digital mode.
- So: **Brief header shell** = branding + meta grid **only**; **phone (if any) appears only in the separate page-level recipient block**, not inside `InvoicePdfCoverHeaderBrief`.

---

## Reference paths

- `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-header.tsx`
- `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-header-brief.tsx`
- `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx` (recipient construction)
- `src/features/invoices/components/invoice-pdf/lib/rechnungsempfaenger-pdf.ts` (`recipientFromRechnungsempfaengerSnapshot` → `phone`)
- `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx` (`recipient` object)

---

## Changes Applied

**Date:** 2026-05-02

- **Removed** the phone number line from `InvoicePdfRecipientBlock` in `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-header.tsx`: no `rawPhone` / `recipientPhone` handling and no `<Text style={styles.addressPhoneLine}>` (replaced with an inline comment: *Phone number intentionally not rendered in the header recipient block*).
- **Removed** the `normalizeInvoiceRecipientPhone` import from that file (only used by the deleted logic in this module).
- **Removed** `styles.addressPhoneLine` from `src/features/invoices/components/invoice-pdf/pdf-styles.ts` — it had no remaining references after the JSX removal.
- **`recipient.phone`** stays on `InvoicePdfCoverHeaderProps` so parent object literals (`InvoicePdfDocument`, `AngebotPdfDocument`, etc.) remain unchanged; the value is no longer shown in the window address.

Sections 1–3 above describe the **pre-change** behavior for historical context; the header recipient block **no longer renders** a telephone line.
