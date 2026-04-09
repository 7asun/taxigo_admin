# Angebote Module

## Architecture overview

The Angebote (Offers) feature is scoped entirely under `src/features/angebote/` and mirrors the invoice builder architecture. Offers are **free-text pricing documents** — they have no link to trips, no tax totals, and no SEPA QR block.

### Folder layout

```
src/features/angebote/
├── api/
│   └── angebote.api.ts          # CRUD + status update functions
├── components/
│   ├── angebot-builder/
│   │   ├── index.tsx            # Builder shell (left/right split)
│   │   ├── step-1-empfaenger.tsx
│   │   ├── step-2-positionen.tsx
│   │   ├── step-3-details.tsx # subject, dates, Tiptap intro/outro, vorlage
│   │   ├── angebot-tiptap-field.tsx
│   │   └── use-angebot-builder-pdf-preview.tsx
│   ├── angebot-pdf/
│   │   ├── angebot-pdf-columns.ts
│   │   ├── AngebotPdfCoverBody.tsx
│   │   └── AngebotPdfDocument.tsx
│   ├── angebote-list-view.tsx   # List page client component
│   └── angebot-detail-view.tsx  # Detail page client component
├── hooks/
│   ├── use-angebote.ts          # useAngeboteList, useAngebotDetail
│   └── use-angebot-builder.ts   # line items state + create/update mutations
├── lib/
│   └── angebot-number.ts        # AG-YYYY-MM-NNNN generation
└── types/
    └── angebot.types.ts         # AngebotRow, AngebotLineItemRow, etc.
```

### Data flow

```
app/dashboard/angebote/new
  → AngebotBuilder (shell)
      → Step1Empfaenger (recipient fields)
      → Step2Positionen (line items, dnd-kit reorder)
      → Step3Details (subject, dates, intro/outro as HTML via Tiptap, vorlage)
      → useAngebotBuilderPdfPreview → AngebotPdfDocument → usePDF
      → InvoiceBuilderPdfPanel (reused, shows iframe)
      → useAngebotBuilder → createAngebot() / update on edit → DB
```

---

## DB schema reference

### `public.angebote`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | **FK → `public.companies(id)`** — same target as `invoices.company_id` and the value in `accounts.company_id`. **Not** `company_profiles(id)`. |
| `angebot_number` | `text` | Unique, format `AG-YYYY-MM-NNNN` |
| `status` | `angebot_status` | `draft \| sent \| accepted \| declined` |
| `recipient_company` | `text?` | Free-text company name |
| `recipient_name` | `text?` | Ansprechperson full name |
| `recipient_anrede` | `text?` | `'Herr' \| 'Frau'` |
| `recipient_street` | `text?` | |
| `recipient_street_number` | `text?` | |
| `recipient_zip` | `text?` | |
| `recipient_city` | `text?` | |
| `recipient_email` | `text?` | Stored for CRM / builder; not shown on offer PDF |
| `recipient_phone` | `text?` | Stored for CRM / builder; not shown on offer PDF |
| `customer_number` | `text?` | Shown in PDF meta grid |
| `subject` | `text?` | Subject line in PDF body |
| `valid_until` | `date?` | Offer expiry date |
| `offer_date` | `date` | Default: today |
| `intro_text` | `text?` | **HTML** (Tiptap) — rendered in PDF via `react-pdf-html` `<Html>` |
| `outro_text` | `text?` | **HTML** (Tiptap) — same as intro |
| `pdf_column_override` | `jsonb?` | `AngebotColumnProfile` snapshot |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

### `public.angebot_line_items`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `angebot_id` | `uuid` | FK → `angebote(id)` ON DELETE CASCADE |
| `position` | `integer` | Display order, 1-based |
| `leistung` | `text` | Service description |
| `anfahrtkosten` | `numeric(10,2)?` | Approach cost (€) |
| `price_first_5km` | `numeric(10,2)?` | Flat price for first 5 km (€) |
| `price_per_km_after_5` | `numeric(10,2)?` | Price per km after 5 km (€/km) |
| `notes` | `text?` | Optional row notes |
| `created_at` | `timestamptz` | |

### RLS policy summary

Both tables use `public.current_user_is_admin()` + `public.current_user_company_id()` for company isolation. Only admin users can SELECT/INSERT/UPDATE/DELETE their own company's Angebote and line items.

### Known issues & fixes

> **Phase 1 FK correction (migration `20260409160000`):** An early revision of `20260409150000_create_angebote.sql` incorrectly targeted `company_profiles(id)` for `angebote.company_id`. The app correctly passes `accounts.company_id` (= `companies.id`), matching invoices. Corrective migration **`20260409160000_fix_angebote_company_fk.sql`** drops and recreates `angebote_company_id_fkey` to reference **`public.companies(id)`**. **Fresh installs are unaffected** — the checked-in `20260409150000` already defines `REFERENCES public.companies(id)`.

---

## Offer number format

**Format:** `AG-{YYYY}-{MM}-{NNNN}`

**Examples:** `AG-2026-04-0001`, `AG-2026-04-0042`, `AG-2026-05-0001`

**Per-month reset:** The sequence counter resets to `0001` on the first offer created in a new calendar month. In April: `AG-2026-04-0001 → 0002 → …`. In May: sequence starts over at `AG-2026-05-0001`.

**RPC:** `angebot_numbers_max_for_prefix(p_prefix text)` — a `SECURITY DEFINER` function that returns the lexicographically greatest `angebot_number` matching `p_prefix || '%'`. It bypasses RLS to find the global MAX without leaking other companies' data (enforces `current_user_is_admin()` internally).

**Retry on conflict:** The DB has a `UNIQUE` constraint on `angebot_number`. If two concurrent inserts generate the same number (rare race condition), the second will fail with a unique-violation error. Callers should retry `createAngebot` once on this error.

---

## Status lifecycle

```
draft  ──→  sent  ──→  accepted
                  └──→  declined
```

| Status | Label | Description |
|---|---|---|
| `draft` | Entwurf | Created but not yet sent to the recipient |
| `sent` | Gesendet | PDF has been sent to the recipient |
| `accepted` | Angenommen | Recipient accepted the offer |
| `declined` | Abgelehnt | Recipient declined the offer |

**Allowed transitions from detail page:**
- `draft → sent` via "Als gesendet markieren" button
- `sent → accepted` via "Angenommen" button
- `sent → declined` via "Abgelehnt" button

There is no `accepted → declined` or reverse transition in the UI. For corrections, delete and recreate.

---

## PDF structure

**Page style:** Angebot PDFs use **`styles.angebotPage`** (not **`styles.page`**) — identical typography to the invoice page but **`paddingBottom: 80pt`** instead of **`148pt`**. The invoice footer needs **148pt** reserved for three dense legal columns; the Angebot reuses the same footer component but typical content is shorter, so **80pt** is enough. **Do not merge** these styles back into one — invoice and Angebot bottom padding must stay independent.

The offer PDF is a single A4 page composed of three sections:

1. **Header** — `InvoicePdfCoverHeader` (reused from invoices module, with `metaConfig`)
   - Left: company logo, slogan, sender line, recipient window address (postal only — DIN 5008)
   - Right: meta grid with relabeled fields:
     - "Angebotsdaten" (instead of "Rechnungsdaten")
     - "Angebotsnr." (instead of "Rechnungsnr.")
     - "Angebotsdatum" (instead of "Rechnungsdatum")
     - "Gültig bis" (instead of "Leistungszeitraum") — single date, not range
     - Tax ID rows (St.-Nr. / USt-IdNr.) are **hidden** (`showTaxIds: false`)

## Logo im PDF-Header
### Struktur
Das Logo wird über `companyProfile.logo_url` als `<Image>` in `brandStack` gerendert,
direkt im `headerLeft`-Block oberhalb von Slogan, Senderzeile und Empfängeradresse.

### Bekanntes react-pdf Verhalten
- Feste `height` auf `<Image>` + `objectFit: 'contain'` erzeugt toten Leerraum
  (die Box behält die volle Höhe, auch wenn das Bild nur einen Bruchteil davon ausfüllt)
- `objectFit: 'contain'` zentriert das Bild vertikal → Lücke ÜBER dem Logo

### Lösung (aktuell implementiert)
| Property | Wert | Warum |
|---|---|---|
| `width` | `220` | Horizontale Breite des Logos |
| `maxHeight` | `70` | Begrenzt Höhe ohne toten Raum |
| `objectFit` | `'contain'` | Seitenverhältnis bleibt erhalten |
| `alignSelf` | `'flex-start'` | Kein vertikales Dehnen im Flex-Container |
| `objectPositionY` | `0` | Bild beginnt oben, Leerraum fällt nach unten |

### Größe anpassen
`maxHeight = width / erwartetes_Seitenverhältnis`

Beispiel: Breites Logo (4:1) → `width: 220, maxHeight: 65`

### Kein Logo vorhanden
Wenn `companyProfile.logo_url` null ist, rendert `brandStack` leer und der Briefkopf
(Senderzeile + Empfängeradresse) beginnt direkt am oberen Rand von `headerLeft`.
Das Layout ist identisch — kein Extra-Padding nötig.

2. **Body** — `AngebotPdfCoverBody` (new, offer-specific)
   - Subject line
   - Salutation (see "Salutation logic" below)
   - Intro and outro: Tiptap HTML rendered with **`react-pdf-html`** (`<Html>`). Supports **bold, italic, underline, bullet and ordered lists**. List/paragraph spacing is defined in `ANGEBOT_HTML_STYLESHEET` (`p.marginBottom: 8`, `li.marginBottom: 4`, etc.). There is **no** npm package `@react-pdf/html`; the maintained bridge for `@react-pdf/renderer` is **`react-pdf-html`**.
   - Line items table (no totals row — offers are not tax invoices)

3. **Footer** — `InvoicePdfFooter` (reused as-is)
   - Company legal info, bank details, contact

### PDF typography

All prose text (salutation, intro, outro) uses **`PDF_FONT_SIZES.base` (9pt)** and **`lineHeight: 1.6`** — identical to **`styles.bodyText`** in `pdf-styles.ts`. **`HTML_PROSE`** sources **`fontSize`** and **`color`** directly from **`PDF_FONT_SIZES`** and **`PDF_COLORS`** tokens — no hardcoded font size or text color. Table headers and cells use **`PDF_FONT_SIZES.xs`** / **`PDF_FONT_SIZES.sm`** as on the invoice PDF.

---

## Salutation logic

The body salutation is derived from `recipient_anrede` + `recipient_name`:

| `recipient_anrede` | `recipient_name` | Output |
|---|---|---|
| `'Herr'` | `"Max Muster"` | `"Sehr geehrter Herr Max Muster,"` |
| `'Frau'` | `"Anna Muster"` | `"Sehr geehrte Frau Anna Muster,"` |
| `null` | `"Chris Muster"` | `"Sehr geehrte/r Chris Muster,"` |
| any | `null` / `""` | `"Sehr geehrte Damen und Herren,"` |

Implementation: `buildSalutation()` in `AngebotPdfCoverBody.tsx`.

---

## Column profile system

The offer PDF table currently uses a **hardcoded "Standard" 5-column preset**:

| Key | Label | Width |
|---|---|---|
| `position` | Pos. | 28 pt |
| `leistung` | Leistung | 220 pt |
| `anfahrtkosten` | Anfahrt | 70 pt |
| `price_first_5km` | erste 5 km | 70 pt |
| `price_per_km_after_5` | ab 5 km (je km) | 80 pt |

Defined in `ANGEBOT_STANDARD_COLUMN_PROFILE` (`angebot.types.ts`). The column catalog lives in `angebot-pdf-columns.ts` and also includes an optional `notes` column.

There is no per-payer or per-company Vorlagen system yet — see "Future: Angebotsvorlagen" section below.

---

## Shared infrastructure

The following components and tables are **borrowed from the invoices module**. Angebote is a **consumer**, not an owner.

| Asset | Location | Usage |
|---|---|---|
| `InvoicePdfCoverHeader` | `src/features/invoices/components/invoice-pdf/` | PDF header; `metaConfig` for offer labels (optional `extraRows` exists for invoices; offers omit it) |
| `InvoicePdfFooter` | `src/features/invoices/components/invoice-pdf/` | PDF footer, reused as-is |
| `InvoiceBuilderPdfPanel` | `src/features/invoices/components/invoice-builder/` | Right-panel iframe preview, reused as-is |
| `invoice_text_blocks` table | DB | Intro/outro template management — offers reuse the same table |
| `BuilderSectionCard` | `src/components/ui/builder-section-card.tsx` | Collapsible section card, extracted from invoice builder |

**Ownership rule:** Any modification to a shared component must be **backward-compatible** and must **not break existing invoice behavior**. When in doubt, prefer extending via props (as done with `metaConfig`, including optional `extraRows` for invoices) over forking.

---

## Future: Angebotsvorlagen

The column profile is currently hardcoded to the "Standard" 5-column preset. The planned next step is a full **Angebotsvorlagen settings page** mirroring `/dashboard/settings/pdf-vorlagen`.

When implemented, it should follow the **exact same 4-tier cascade pattern** as `resolvePdfColumnProfile`:

```
1. Per-recipient override (not applicable to offers — no payer FK)
2. Per-offer override (pdf_column_override JSONB snapshot on angebote row)
3. Company default Vorlage
4. System fallback (ANGEBOT_STANDARD_COLUMN_PROFILE)
```

The `AngebotColumnProfile` type is already defined in `angebot.types.ts` and the `pdf_column_override` JSONB column exists on the `angebote` table, so adding a Vorlagen system requires only a settings UI + resolver function — no DB migration needed.
