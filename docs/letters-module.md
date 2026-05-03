# Letters module (`letters` / `/dashboard/letters`)

## Purpose and scope

Admins compose **table-free business letters** (subject, recipient block, Tiptap HTML body) and download them as **DIN Brief layout** PDFs. Letters are **not** tied to trips, invoices, or offers.

**In scope:** CRUD on `public.letters`, list + composer UI, client-side PDF via `@react-pdf/renderer`.

**Deferred:** letter templates table, auto-number RPC, email draft/sending, status beyond `draft` / `sent`, regenerating `src/types/database.types.ts` (run `bun run db:types` after migration is applied in every environment).

## Feature layout

```
src/features/letters/
├── api/letters.api.ts          # Supabase CRUD + snake_case ↔ camelCase
├── hooks/use-letters.ts        # TanStack Query + mutations
├── lib/
│   └── build-draft-letter.ts   # Single `Letter` assembly for preview + PDF + save
├── types.ts                    # Letter types (no database.types import)
├── components/
│   ├── letter-builder/
│   │   ├── index.tsx                      # LetterBuilder — split shell + preview wiring
│   │   ├── letter-step-1-recipient.tsx    # 1. Empfänger (AddressAutocomplete + manual address)
│   │   ├── letter-step-2-details.tsx      # 2. Betreff & Datum
│   │   ├── letter-step-3-body.tsx         # 3. Brieftext (AngebotTiptapField)
│   │   └── use-letter-builder-pdf-preview.tsx
│   ├── letter-list.tsx
│   └── letter-pdf/
│       ├── letter-pdf-document.tsx
│       └── letter-pdf-cover-body.tsx
└── index.ts                    # Barrel exports
```

## Builder architecture

Create/edit routes render **`LetterBuilder`**. The shell matches **`AngebotBuilder`**: flex row, left column `lg:w-[480px]` with scroll, right column hidden below `lg` with live PDF.

- **State:** `LetterFormValues` and TanStack mutations live in `LetterBuilder`. Three **`BuilderSectionCard`** steps (**1. Empfänger**, **2. Betreff & Datum**, **3. Brieftext**) each receive `values` + `onChange` patches. One `draftLetter` (from [`build-draft-letter.ts`](src/features/letters/lib/build-draft-letter.ts)) feeds the PDF download button and the preview hook.
- **Empfänger autocomplete:** [`AddressAutocomplete`](src/features/trips/components/trip-address-passenger/address-autocomplete.tsx) — same import as Angebot step 1; Google `street` + `street_number` are merged into `recipientStreet`.
- **Preview:** [`use-letter-builder-pdf-preview.tsx`](src/features/letters/components/letter-builder/use-letter-builder-pdf-preview.tsx) uses `usePDF` from `@react-pdf/renderer`, debounced by **`PDF_PREVIEW_DEBOUNCE_MS` (600)**, and passes the blob URL to the shared [`InvoiceBuilderPdfPanel`](src/features/invoices/components/invoice-builder/invoice-builder-pdf-panel.tsx) (same iframe chrome as invoice/angebot builders; **do not fork** that component).
- **Logo / `resolveCompanyAssetUrl`:** The hook resolves `company_profiles.logo_path` / `logo_url` through [`resolveCompanyAssetUrl`](src/features/storage/resolve-company-asset-url.ts) before calling `updatePdf`, mirroring the Angebot builder preview. Private-bucket logos would otherwise fail or diverge from download behaviour.
- **Synthetic panel props:** Letters have no trip line items. The panel gates on `lineItemCount > 0`; the builder passes **`lineItemCount={1}`** when preview is active (non-zero stand-in), plus `section2Complete` and a placeholder `draftInvoice` object, same adapter idea as [`angebot-builder/index.tsx`](src/features/angebote/components/angebot-builder/index.tsx).

**Deferred:** Extract a shared `BuilderSplitShell` for invoice + angebot + letter; mobile preview **Sheet** (Vorschau button) like the other builders; `bun run db:types` regeneration.

Routes:

- [`/dashboard/letters`](src/app/dashboard/letters/page.tsx) — list
- [`/dashboard/letters/new`](src/app/dashboard/letters/new/page.tsx) — create
- [`/dashboard/letters/[id]`](src/app/dashboard/letters/[id]/page.tsx) — edit

## Database

**Table:** `public.letters` (migration `supabase/migrations/20260503140000_create_letters.sql`).

Columns: `id`, `company_id`, `letter_number`, `status` (`draft` | `sent`), recipient text fields (`recipient_company`, `recipient_salutation`, `recipient_first_name`, `recipient_last_name`, `recipient_street`, `recipient_zip`, `recipient_city`, `recipient_country`), `subject`, `body_html`, `letter_date`, `created_by` (text, optional), `created_at`, `updated_at`.

**RLS:** Same pattern as `angebote` — `FOR … TO authenticated` with `current_user_is_admin()` **and** `company_id = current_user_company_id()` on SELECT/INSERT/UPDATE/DELETE.

**`updated_at`:** Updated in the app on PATCH (no DB trigger).

## PDF architecture

| Piece | Source |
|-------|--------|
| Fold marks + absolute address window | Mirrored from [`AngebotPdfDocument`](src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx) brief branch (not imported — structural copy only). |
| `InvoicePdfCoverHeaderBrief`, `InvoicePdfRecipientBlock`, `InvoicePdfFooter`, `pdf-styles`, `pdf-layout-constants` | Imported from invoices PDF module; **not modified**. |
| `LetterPdfCoverBody` | Owned by letters — subject, salutation, `react-pdf-html` body, closing. |

**Recipient mapping:** `recipient_salutation` maps to PDF `anrede` when it is `Herr` / `Frau`; free text is passed as `anrede` for a single line when needed. `recipient_country` is appended to the city line for the window block (no separate country line in the shared recipient component).

## Data flow

Server pages load `company_profiles` for the signed-in user’s `company_id` and pass it into **`LetterBuilder`** for live preview + PDF download. Client hooks call `letters.api.ts` → Supabase client; mutations invalidate `letterKeys.all` and the relevant `letterKeys.detail(id)`.

## Query keys

[`src/query/keys/letters.ts`](src/query/keys/letters.ts) — export `letterKeys` from [`src/query/keys/index.ts`](src/query/keys/index.ts).

## Navigation

Letters appear under **Account** in [`src/config/nav-config.ts`](src/config/nav-config.ts) (operational correspondence; Abrechnung stays billing-focused).
