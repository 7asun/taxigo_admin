# Security Audit A5 — Storage, Headers & Client-Side Exposure

**Audit date:** 2026-06-17  
**Scope (read-only):**

- All `supabase/migrations/*.sql` referencing `storage` or `storage.objects`
- `next.config.ts`, `__CLEANUP__/sentry/next.config.ts`, `vercel.json`
- `src/app/layout.tsx` (meta / CSP)
- `src/proxy.ts` (no `middleware.ts` in repo)
- All `supabase.storage.*` usage in `src/`
- `docs/access-control.md` (no storage section present)
- `env.example.txt`

Cross-references: [A2 RLS audit](security-audit-a2-rls.md), [A4 secrets audit](security-audit-a4-secrets.md).

---

## Executive summary

| Area | Risk | Summary |
| --- | --- | --- |
| **Storage** | **Medium** | One bucket (`company-assets`) in repo. Migration creates it **`public: true`** (`20260402120000_company_assets_storage_rls.sql:46`) with tenant-scoped RLS for **authenticated** API access, but **public URLs bypass RLS** for unauthenticated GET. Paths are predictable: `{company_id}/logo.{ext}`. |
| **Signed URLs** | **Low–Medium** | Generated **client-side** via browser Supabase session (`resolve-company-asset-url.ts:70-73`). Default TTL **3600 s** (1 h). RLS gates signing to own `company_id` folder; signed URLs are **shareable until expiry**. |
| **HTTP security headers** | **High (missing)** | **No** CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`, or `Permissions-Policy` in `next.config.ts`, `vercel.json`, `layout.tsx`, or `proxy.ts`. Root layout includes an **inline script** (`layout.tsx:39-49`) — any future strict CSP will need `nonce` or hash. |
| **Client data exposure** | **Medium (by design)** | App architecture uses **browser `createClient()`** + RLS for most reads/writes (trips, invoices, payers, driver portal). No `password_hash` in API responses; financial/PII fields are intentionally loaded into Client Components for admin workflows. RLS gaps from A2 amplify exposure. |
| **PDF / documents** | **Low (storage)** | `@react-pdf/renderer` runs **in the browser** (`usePDF`, `PDFDownloadLink`, `pdf()`). PDFs are **not** uploaded to Supabase Storage — generated as blobs/downloads. Only **logos** pull from Storage (signed URL for private bucket compatibility). |
| **Realtime** | **Low–Medium** | Seven client modules subscribe to `postgres_changes` on **`trips`** and/or **`live_locations`**. Most `trips` channels have **no `filter`** (rely on RLS). `live_locations` has RLS + repo migration adds table to `supabase_realtime`. **`trips` is not added to `supabase_realtime` in any repo migration** — production may depend on dashboard config. |

---

## Q1 — Storage bucket inventory

Only **one** bucket is defined or referenced in migrations and `src/`.

| Bucket | Public? | RLS on `storage.objects` | Operations & roles | Path tenancy |
| --- | --- | --- | --- | --- |
| **`company-assets`** | **Yes** in migration (`20260402120000_company_assets_storage_rls.sql:42-46`, `public: true`). Comment notes `ON CONFLICT DO NOTHING` — **dashboard may differ** if bucket pre-existed. | **Yes** — four policies on `storage.objects` (`:80-152`), all `TO authenticated`, bucket `company-assets`, first path segment checked via `user_can_access_company_storage_folder((storage.foldername(name))[1])` (`:15-29`, `:86`, `:106`, `:126-130`, `:150`). | **SELECT** (`company_assets_authenticated_select`, `:80-87`), **INSERT** (`:100-107`), **UPDATE** (`:120-131`), **DELETE** (`:144-151`). **No `anon` policies** — anonymous Storage API blocked; **public bucket HTTP GET still works** without auth. | **`{company_id}/logo.{ext}`** — e.g. `company-settings.api.ts:176`, migration comment `20260402150000_company_profiles_logo_path.sql:12`. Tenancy enforced for authenticated ops; **public URL is guessable if `company_id` is known**. |

### Helper function

| Object | Purpose | Lines |
| --- | --- | --- |
| `public.user_can_access_company_storage_folder(text)` | `SECURITY DEFINER`; true when `auth.uid()`'s `accounts.company_id::text = p_folder` | `20260402120000_company_assets_storage_rls.sql:15-29` |

### Source references (non-migration)

| File | Usage |
| --- | --- |
| `src/features/company-settings/api/company-settings.api.ts` | `upload` (`:178-183`), `remove` (`:272`), bucket constant `LOGO_BUCKET = 'company-assets'` (`:23`) |
| `src/features/storage/resolve-company-asset-url.ts` | `createSignedUrl` (`:71-73`), bucket constant (`:3`) |

### `docs/access-control.md`

**No storage section** — bucket policy is documented only in `docs/storage-upload-troubleshooting.md` and inline migration comments.

---

## Q2 — Signed URL usage

| Location | Lines | Context | Expiry | Server vs client | Cross-tenant risk |
| --- | --- | --- | --- | --- | --- |
| `src/features/storage/resolve-company-asset-url.ts` | 52-76 | `createSignedUrl(objectPath, expiresInSeconds)` via **browser** `createClient()` | Default **`60 * 60`** (3600 s) (`:55`) | **Client-side** — callable from `'use client'` components (e.g. `company-settings-form.tsx:136`) | **Signing** gated by Storage RLS + `user_can_access_company_storage_folder`. **After issuance**, anyone with the URL can fetch until expiry — **URL sharing leaks asset** (logos: low sensitivity). |
| `src/features/invoices/components/invoice-pdf/lib/resolve-pdf-logo-url.ts` | 12-23 | Wraps `resolveCompanyAssetUrl` for `@react-pdf` image fetch | Default **3600 s** (`:14`) | **Client-side** (PDF preview/download in browser) | Same as above |
| `src/features/letters/lib/company-profile-for-letter-pdf.ts` | 26-30 | Letter PDF header logo | **3600 s** (`:29`) | **Client-side** | Same as above |

**Not used:** `getPublicUrl()` — only mentioned in comment (`resolve-pdf-logo-url.ts:6-7`). Upload path returns **bucket-relative `logo_path`**, not a public URL (`company-settings.api.ts:192-193`).

**Server-side signed URLs:** None found in API routes or Server Actions.

---

## Q3 — Public bucket risk (`company-assets`)

| Question | Finding |
| --- | --- |
| **Data type** | Company **logo images** only (PNG/JPEG/SVG/WebP; `allowed_mime_types` `:48-54`, **5 MB** limit `:47`). |
| **Path guessability** | **High** if attacker knows target `company_id` (UUID): fixed pattern `{company_id}/logo.{ext}` (`company-settings.api.ts:176`). `company_id` may appear in URLs, JWT-adjacent flows, or leaked rows. |
| **Cross-tenant enumeration** | **No sequential IDs** — UUID folders resist brute enumeration. **Targeted access**: knowing another tenant's `company_id` + extension (png/webp/jpeg/svg) allows **unauthenticated GET** via `/storage/v1/object/public/company-assets/{company_id}/logo.{ext}` when bucket is public. |
| **RLS vs public** | Storage RLS policies apply to **authenticated** Storage API. **Public bucket flag** serves objects on the public endpoint **without** evaluating those policies (Supabase documented behavior). Migration comment at `20260402150000_company_profiles_logo_path.sql:4-5` recommends signed URLs for **private** buckets — **at odds** with migration `public: true`. |

**Sensitivity:** Logos are low confidentiality; risk is **branding disclosure**, not financial/PII documents. No invoices or PDFs are stored in this bucket.

---

## Q4 — Security headers

### `next.config.ts`

| Mechanism | Present? | Reference |
| --- | --- | --- |
| `headers()` async export | **No** | `next.config.ts:5-60` — only `turbopack`, `images`, Sentry wrapper |
| `env:` / `publicRuntimeConfig` | **No** | Same file |

### `vercel.json`

Cron config only (`vercel.json:1-10`) — **no `headers` block**.

### `src/proxy.ts`

Cookie refresh + role redirects (`:18-89`) — **no security headers** set on `NextResponse`.

### `src/app/layout.tsx`

| Item | Finding |
| --- | --- |
| CSP meta / headers | **None** |
| Inline script | **Yes** — theme-color script (`:39-49`, `dangerouslySetInnerHTML`) → would conflict with strict `script-src` without nonce/hash |
| Other security meta | **None** |

### Header checklist

| Header | Set? | Value |
| --- | --- | --- |
| **Content-Security-Policy** | **No** | — |
| **X-Frame-Options** | **No** | — |
| **X-Content-Type-Options** | **No** | — |
| **Strict-Transport-Security** | **No** | — (may be added by Vercel platform defaults — **not defined in app config**) |
| **Referrer-Policy** | **No** | — |
| **Permissions-Policy** | **No** | — |

**CSP note:** Not applicable today. A future CSP must account for: Supabase (`connect-src`), Sentry (`connect-src` + tunnel `/monitoring` per `next.config.ts:49`), Google Maps links (client navigation, not API), inline theme script (`layout.tsx:39-49`), and `@react-pdf` blob/data URLs.

---

## Q5 — Client component data exposure

### Architecture

The app uses **direct browser Supabase** (anon key + session JWT) as the primary data layer. RLS is the intended security boundary (`docs/access-control.md:9-17`, A2). This is **not** a BFF-only pattern.

### Client Components that fetch via Supabase (representative)

| Pattern | Example files | Lines | Data |
| --- | --- | --- | --- |
| Hook + `createClient()` | `use-trips.ts` | 39-47, 65-68 | `tripsService.getTrips()` → `select('*')` (`trips.service.ts:65-68`) |
| Hook + realtime + fetch | `use-unplanned-trips.ts` | 46-53, 147-157 | Full trip rows, unfiltered subscription |
| Hook + invoice API | `use-invoice.ts` / `invoices.api.ts` | `getInvoiceDetail` `:140-180` | Invoice `*`, payer address/email, client PII, line items `*`, company bank/IBAN |
| `'use client'` form + storage | `company-settings-form.tsx` | `:1`, logo resolve `:136` | Company profile + signed logo URL |
| Driver portal | `shifts.service.ts`, `driver-trips.service.ts` | browser `createClient()` throughout | Shifts, trips (driver-scoped by RLS) |
| Fleet map | `use-fleet-map.ts` | 132-171, 214-273 | `live_locations` + `trips` |

**Full inventory:** 80+ files import `@/lib/supabase/client` (see A4 grep). Most `*.api.ts` / `*.service.ts` under `src/features/` are invoked from Client Components or client hooks.

### Server Components → Client props

| Pattern | Example | Notes |
| --- | --- | --- |
| RSC fetches trips, passes to table | `trips-listing.tsx` | Server `createClient()` (`:8`); serializes `TripListRow[]` to client table/kanban |
| RSC roster | `driver-table-listing.tsx` | `getRoster()` after `requireAdmin()` — emails merged server-side |

Serialized props contain **business PII** (client names, addresses, prices) appropriate for authenticated admin UI — not hidden from the browser.

### Sensitive field scan

| Field class | In client fetches? | Notes |
| --- | --- | --- |
| `password_hash` / Auth secrets | **No** | Passwords only in sign-in/sign-up forms → GoTrue; admin password changes via API route |
| `SUPABASE_SERVICE_ROLE_KEY` | **No** in normal UI | See A4 (`debug-queries.ts` exception) |
| Financial (`net_price`, `gross_price`, `tax_rate`, invoice `total`) | **Yes** | `trips.service.ts:67`, `invoices.api.ts:149`, `getInvoiceDetail` |
| Bank (`bank_iban`, `bank_bic`) | **Yes** | `invoices.api.ts:174-175` (company profile for PDF) |
| Internal UUIDs | **Yes** | All tables — required for UI actions |

**Risk coupling:** Client exposure is **acceptable for admin** only if RLS is complete. A2 found gaps (`billing_variants`, `recurring_rules`, etc.) that could widen what the browser can read/write.

---

## Q6 — PDF and document generation

### Where PDFs are generated

| Feature | Mechanism | Client vs server | Key files |
| --- | --- | --- | --- |
| Invoices (detail download) | `PDFDownloadLink` + `InvoicePdfDocument` | **Client** (`'use client'`) | `invoice-detail/index.tsx:22`, `:453-500` |
| Invoices (builder preview) | `usePDF()` hook | **Client** | `use-invoice-builder-pdf-preview.tsx:1`, `:40`, `:166` |
| Angebote | `PDFDownloadLink`, `usePDF` | **Client** | `angebot-detail-view.tsx:24`, `use-angebot-builder-pdf-preview.tsx:15` |
| Letters | `pdf()` → blob download | **Client** | `letter-list.tsx:17`, `letter-builder/index.tsx:13` |
| Example / dev | `PDFViewer` | **Client** | `app/dashboard/invoices/example/page.tsx:3` |

**No server-side PDF rendering** (no API route generates PDF bytes).

### Storage of PDFs

| Question | Answer |
| --- | --- |
| Stored in Supabase Storage? | **No** — no `upload` of PDF MIME types; only `company-assets` image uploads exist (`company-settings.api.ts:178-183`) |
| Persisted elsewhere? | Invoice/letter **metadata in Postgres** (`invoices`, `letters` tables); PDF is generated on demand |
| Cross-tenant PDF via Storage URL? | **N/A** — PDFs not in Storage |
| Cross-tenant PDF via ID guess? | Mitigated by **invoice RLS** (repo: `20260401180000_invoices_invoice_line_items_rls.sql`). Client `getInvoiceDetail` (`invoices.api.ts:162`) returns error if RLS blocks row. UUID invoice IDs resist enumeration. |

### Logo fetch in PDFs

`@react-pdf` fetches logo images in the **browser**. Private-bucket-safe path uses **signed URL** (`resolve-pdf-logo-url.ts:4-23`, `company-profile-for-letter-pdf.ts:4-35`).

---

## Q7 — Real-time subscriptions

### Inventory

| File | Channel / table | Events | Filter | Client filter after receive |
| --- | --- | --- | --- | --- |
| `trips-realtime-sync.tsx` | `trips` | INSERT, UPDATE | **None** | Debounced RSC refresh (`:33-44`) |
| `use-trips.ts` | `trips` | `*` | **None** | Invalidate query (`:40-48`) |
| `use-trips.ts` (`useTripQuery`) | `trips` | UPDATE | **`id=eq.{id}`** (`:119`) | Per-trip invalidation |
| `use-unplanned-trips.ts` | `trips` | `*` | **None** | Invalidate (`:148-156`) |
| `use-timeless-rule-trips.ts` | `trips` | `*` | **None** | Invalidate (`:245-253`) |
| `use-upcoming-trips.ts` | `trips` | `*` | **None** | Refetch (`:105-117`) |
| `use-fleet-map.ts` | `live_locations` | INSERT, UPDATE | **None** (`:218-245`) | Updates local map state |
| `use-fleet-map.ts` | `trips` | UPDATE | **`company_id=eq.{companyId}`** (`:256`) | Checks `trip.company_id` (`:260`) |

**Not found:** `supabase.channel()` usage outside the above + `query/realtime-bridge.ts` (debounce helper only).

### RLS on subscribed tables

| Table | RLS in repo | Realtime publication in repo | Subscription risk |
| --- | --- | --- | --- |
| **`trips`** | **Yes** — `20260409170000_add_missing_rls.sql:15-56` (see A2) | **Not in repo** — only `live_locations` added (`20260520120000_live_locations.sql:71-77`) | Events should be **filtered by RLS** for the subscriber's JWT. Unfiltered channels are OK **if RLS is correct**. Broad `event: '*'` still notifies on any visible row change (no cross-tenant payload if RLS holds). **Fresh deploy risk:** if `trips` not in `supabase_realtime`, subscriptions silently fail (no leak, broken UX). |
| **`live_locations`** | **Yes** — `20260520120000_live_locations.sql:46-66` (driver ALL own row; admin SELECT company) | **Yes** — `ALTER PUBLICATION supabase_realtime ADD TABLE` (`:73`) | Admin fleet map: INSERT/UPDATE subscriptions without filter (`use-fleet-map.ts:218-245`) — **RLS must limit** which location rows generate events. Policies scope admin SELECT to `company_id = current_user_company_id()` (`:61-66`). |

### `auth.uid()` / `company_id` in subscriptions

- **Explicit `filter`:** only `useTripQuery` (trip id) and fleet map trips channel (`company_id`).
- **All other `trips` channels:** rely entirely on **Postgres RLS** + Realtime authorization — no `company_id` filter in the subscription config.

---

## Quick wins

Shippable in **under one hour**, **no business-logic changes**:

1. **Add baseline security headers** in `next.config.ts` `headers()` (or `vercel.json`):

   ```ts
   // Example starter set — tune before production CSP
   { key: 'X-Frame-Options', value: 'DENY' },
   { key: 'X-Content-Type-Options', value: 'nosniff' },
   { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
   { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' }
   ```

   Add **HSTS** only on production HTTPS (`Strict-Transport-Security: max-age=31536000; includeSubDomains`). Defer full **CSP** until inline script in `layout.tsx:39-49` is refactored to nonce or external file.

2. **Set `company-assets` bucket to private** in Supabase Dashboard (or new migration `UPDATE storage.buckets SET public = false WHERE id = 'company-assets'`). App already supports signed URLs (`resolve-company-asset-url.ts`, `logo_path` migration). **Removes unauthenticated logo fetch** if `company_id` is known.

3. **Add `trips` to `supabase_realtime` publication** in a migration (mirror `live_locations` pattern) so realtime behavior is reproducible from repo:

   ```sql
   ALTER PUBLICATION supabase_realtime ADD TABLE public.trips;
   ```

4. **Document storage in `docs/access-control.md`** — bucket name, public/private expectation, path convention `{company_id}/logo.*`, pointer to `20260402120000_company_assets_storage_rls.sql`.

5. **Optional subscription hardening** (still low logic change): add `filter: 'company_id=eq.' + companyId` to broad `trips` channels after reading `company_id` once from `accounts` — defense-in-depth if RLS ever regresses (pattern already in `use-fleet-map.ts:256`).

---

## References

| Topic | Path |
| --- | --- |
| Storage RLS migration | `supabase/migrations/20260402120000_company_assets_storage_rls.sql` |
| Logo path column | `supabase/migrations/20260402150000_company_profiles_logo_path.sql` |
| Upload troubleshooting | `docs/storage-upload-troubleshooting.md` |
| Proxy (no headers) | `src/proxy.ts` |
| Root layout | `src/app/layout.tsx` |
| Env template | `env.example.txt` (no storage-specific vars — bucket is project-level) |
