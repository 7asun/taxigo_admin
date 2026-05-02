# Audit: Anrede in invoice PDF cover header / recipient data (read-only)

**Scope:** `invoice-pdf-cover-header.tsx`, `InvoicePdfDocument.tsx`, `lib/rechnungsempfaenger-pdf.ts`. No code changes in this task.

---

## 1. Was the fix applied?

### Standalone `<Text>` for `anrede` (first child of `recipientBlock` `<View>`)

**Yes.** Inside `InvoicePdfRecipientBlock`, the first children of `<View style={styles.recipientBlock}>` are comments, then the conditional Anrede line, then the company-name block. The **exact JSX as of this audit:**

```tsx
      <View style={styles.recipientBlock}>
        {/* Briefkopf: optional standalone Anrede → Firmenname → First + Lastname → Abteilung → Street → Zip + City */}

        {/* Anrede rendered as first standalone line in recipient block, above company/person name */}
        {anrede && String(anrede).trim() ? (
          <Text style={styles.addressPersonName}>{anrede}</Text>
        ) : null}

        {/* 1. Firmenname (if exists) */}
```

### Destructuring `anrede` from `recipient`

**Yes.** Current destructuring block:

```tsx
  const {
    companyName: recipientCompanyName,
    personName: recipientPersonName,
    street: recipientStreet,
    streetNumber: recipientStreetNumber,
    zipCode: recipientZipCode,
    city: recipientCity,
    addressLine2: recipientAddressLine2,
    abteilung: recipientAbteilung,
    firstName: recipientFirstName,
    lastName: recipientLastName,
    anrede
  } = recipient;
```

### Structured person line

The join line uses **`anrede`** in the condition and in `[anrede, recipientFirstName, recipientLastName]` (same binding as destructured from `recipient`). A brief regression used the old alias `recipientAnrede` without defining it — **fixed** under **Changes Applied**.

---

## 2. Is `anrede` reaching the component?

`InvoicePdfDocument` does **not** inline a fresh object literal at each `<InvoicePdfCoverHeader />` / `<InvoicePdfRecipientBlock />` call site. It passes a single value: **`recipient={coverRecipient}`**.

There are **three** JSX passes of `coverRecipient` into header-related components:

1. **Brief mode — page-level address window**

```tsx
              <InvoicePdfRecipientBlock
                recipient={coverRecipient}
                secondaryLegalRecipient={secondaryLegal}
              />
```

2. **Brief mode — `InvoicePdfCoverHeaderBrief`**

```tsx
          <InvoicePdfCoverHeaderBrief
            companyProfile={cp}
            senderFit={senderFit}
            recipient={coverRecipient}
            ...
```

3. **Digital mode — `InvoicePdfCoverHeader`**

```tsx
          <InvoicePdfCoverHeader
            companyProfile={cp}
            senderFit={senderFit}
            recipient={coverRecipient}
            ...
```

### Where `coverRecipient` is built

`coverRecipient` is chosen from snapshot vs live shapes:

```tsx
  let coverRecipient;
  if (isPerClientBilled) {
    coverRecipient = snapPrimary ? snapPrimary : clientWindowRecipient;
  } else {
    coverRecipient = snapshotWindowRecipient ?? payerWindowRecipient;
  }
```

**Full object literals** that feed into that:

**`payerWindowRecipient`** — `anrede` **explicitly set** to `null`:

```tsx
  const payerWindowRecipient = {
    companyName: '',
    personName: payer?.name ?? '—',
    displayName: payer?.name ?? '—',
    street: payer?.street ?? '',
    streetNumber: payer?.street_number ?? '',
    zipCode: payer?.zip_code ?? '',
    city: payer?.city ?? '',
    phone: null as string | null,
    addressLine2: null as string | null,
    anrede: null as string | null,
    abteilung: null as string | null,
    firstName: null as string | null,
    lastName: null as string | null
  };
```

**`clientWindowRecipient`** (live Fahrgast when no snapshot wins) — `anrede` **forwarded** from **`client.greeting_style`** (see **Changes Applied**):

```tsx
  const clientWindowRecipient = {
    companyName: recipientCompanyName,
    personName: recipientPersonName,
    displayName: recipientName,
    street: client?.street ?? '',
    streetNumber: client?.street_number ?? '',
    zipCode: client?.zip_code ?? '',
    city: client?.city ?? '',
    phone: recipientPhone,
    addressLine2: null as string | null,
    // Forward client salutation so Anrede renders in the header recipient block
    anrede: client?.greeting_style ?? null,
    abteilung: null as string | null,
    firstName: null as string | null,
    lastName: null as string | null
  };
```

**`snapshotWindowRecipient`** (when `snapPrimary` exists) — `anrede` **forwarded** from the snapshot parse result:

```tsx
  const snapshotWindowRecipient = snapPrimary
    ? {
        companyName: snapPrimary.companyName || '',
        personName:
          [snapPrimary.firstName, snapPrimary.lastName]
            .filter(Boolean)
            .join(' ') || snapPrimary.displayName,
        displayName: snapPrimary.displayName,
        street: snapPrimary.street,
        streetNumber: snapPrimary.streetNumber,
        zipCode: snapPrimary.zipCode,
        city: snapPrimary.city,
        phone: snapPrimary.phone,
        addressLine2: snapPrimary.addressLine2,
        anrede: snapPrimary.anrede,
        abteilung: snapPrimary.abteilung,
        firstName: snapPrimary.firstName,
        lastName: snapPrimary.lastName
      }
    : null;
```

When **`snapPrimary`** is used directly as `coverRecipient` (`per_client` and snapshot wins), `coverRecipient` **is** the `PdfCoverRecipient` from `recipientFromRechnungsempfaengerSnapshot`, which includes **`anrede`** from JSON (see §3).

**Summary:** `anrede` **reaches** the header when the addressee is **`snapPrimary`** / **`snapshotWindowRecipient`** (snapshot JSON `anrede`), or when **`clientWindowRecipient`** is used and **`client.greeting_style`** is set. **Payer fallback** keeps **`anrede: null`**.

---

## 3. Snapshot source (`rechnungsempfaenger-pdf.ts`)

### Mapping in `recipientFromRechnungsempfaengerSnapshot`

**Yes** — `anrede` is read from the snapshot and forwarded on `PdfCoverRecipient`.

Extraction from JSON:

```ts
  const anrede = str(snap.anrede) || null;
```

Returned on the recipient object:

```ts
  return {
    ...
    anrede,
    firstName,
    lastName,
    abteilung
  };
```

### Raw JSON field name

- **Field name:** **`anrede`** (snake_case key on the snapshot object: `snap.anrede`).
- **Behavior:** Read via `str(snap.anrede)` (whitespace normalization via `collapseWhitespaceForPdf` for string values). Empty string after processing becomes **`null`** (`|| null`).
- **Not dropped** in this function — it is stored on `PdfCoverRecipient` and used in `displayName` logic when there is no `companyName`.

There is **no** alternate key such as `salutation` or `greeting` in this parser for the window recipient; only **`anrede`** is used for this structured field.

---

## 4. Live client path

For **`clientWindowRecipient`** (per-client invoice, **no** `snapPrimary`), **`anrede`** is set from **`client?.greeting_style ?? null`** so the Fensteranschrift can show the same Herr/Frau-style token as structured data. The **letter body** still uses the separate **`salutation`** string (`salutationFromSnapshot` + `greeting_style` fallback).

---

## 5. Type definition (`InvoicePdfCoverHeaderProps.recipient`)

Current `recipient` shape on `InvoicePdfCoverHeaderProps`:

```tsx
  recipient: {
    companyName: string;
    personName: string;
    displayName: string;
    street: string;
    streetNumber: string;
    zipCode: string;
    city: string;
    phone: string | null;
    addressLine2?: string | null;
    /** Structured fields for proper Briefkopf formatting */
    anrede?: string | null;
    abteilung?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  };
```

- **`anrede`** is **`anrede?: string | null`** — optional property, so **`undefined`** is allowed by TypeScript when omitted; **`null`** is explicit in the union for the value type.

---

## Changes Applied

**Date:** 2026-05-02

1. **`invoice-pdf-cover-header.tsx` — `InvoicePdfRecipientBlock`:** Replaced the stale identifier **`recipientAnrede`** with **`anrede`** on the structured person line (condition and array). Rename only; restores a passing TypeScript build.
2. **`InvoicePdfDocument.tsx` — `clientWindowRecipient`:** Set **`anrede: client?.greeting_style ?? null`** (with inline comment: *Forward client salutation so Anrede renders in the header recipient block*). `InvoiceDetail.client` has **`greeting_style`**, not **`anrede`**. **`payerWindowRecipient`** and **`snapshotWindowRecipient`** were left unchanged.
3. **`invoice-pdf-cover-header.tsx` — structured person line (2026-05-02):** Guard tightened from **`anrede || firstName || lastName`** to **`firstName || lastName`** only, so **`anrede` alone** (e.g. from **`greeting_style`**) does not duplicate the standalone Anrede line; the join **`[anrede, firstName, lastName].filter(Boolean)`** is unchanged when a name is present.

---

## File references

- `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-header.tsx`
- `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx`
- `src/features/invoices/components/invoice-pdf/lib/rechnungsempfaenger-pdf.ts`
