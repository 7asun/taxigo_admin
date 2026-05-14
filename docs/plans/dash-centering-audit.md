# AUDIT — Em-dash (`—`) placeholder cells (Fahrten table columns)

**Scope:** Read-only. Unicode **U+2014 em dash** (`—`) only — not ASCII hyphen-minus (`-`) used elsewhere (called out in notes).

**Files read:** `src/features/trips/components/trips-tables/columns.tsx`, `src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx`, `src/features/trips/components/trips-tables/inline-cells/reha-cells.tsx`, `inline-cells/index.ts`.  
**Cross-check:** `trip-invoice-status-badge-cell.tsx`, `driver-select-cell.tsx` — **no** `—` in those files.

---

## 1. Every column (by `id`) that can render `—` + exact JSX

| Column `id` | File | Condition (summary) | Exact JSX for the placeholder |
| --- | --- | --- | --- |
| `scheduled_at` | `columns.tsx` | Missing/empty/invalid `scheduled_at` | `<span className='text-muted-foreground'>—</span>` |
| `time` | `columns.tsx` | Same as above (same accessor) | `<span className='text-muted-foreground'>—</span>` |
| `gross_price` | `columns.tsx` | `gross_price == null` | `<span className='text-muted-foreground'>—</span>` |
| `fremdfirma` | `columns.tsx` | No trimmed Fremdfirma name | `<span className='text-muted-foreground'>—</span>` (inside centered wrapper — see §2) |
| `fremdfirma_abrechnung` | `columns.tsx` | No `fremdfirma_id` | `<span className='text-muted-foreground'>—</span>` (inside centered wrapper) |
| `billing_calling_station` | `columns.tsx` | Empty/whitespace `billing_calling_station` | `<span className='text-muted-foreground'>—</span>` |
| `billing_betreuer` | `columns.tsx` | Empty/whitespace `billing_betreuer` | `<span className='text-muted-foreground'>—</span>` |
| `net_price` | `columns.tsx` | `net_price == null` | `<span className='text-muted-foreground'>—</span>` |
| `tax_rate` | `columns.tsx` | `tax_rate == null` | `<span className='text-muted-foreground'>—</span>` |
| *(via `kts_fehler` column)* | `kts-cells.tsx` | **`KtsFehlerSwitchCell`:** `!ktsActive` | `<span className='text-muted-foreground'>—</span>` |
| *(via `kts_fehler_beschreibung` column)* | `kts-cells.tsx` | **`KtsFehlerTextCell`:** `(!ktsActive \|\| !ktsFehlerActive) && !trimmed text` | `<span className='text-muted-foreground'>—</span>` |
| *(via `reha_schein` column)* | `reha-cells.tsx` | **`RehaScheinSwitchCell`:** `!trip.payer?.reha_schein_enabled` | `<span className='text-muted-foreground'>—</span>` |

Columns **`select`**, **`name`**, **`pickup_address`**, **`dropoff_address`**, **`driver_id`**, **`status`**, **`invoice_status`**, **`kts_document_applies`** (switch only), **`actions`**: **no** `—` placeholder in the reviewed cell code.

---

## 2. Centering wrapper (`flex justify-center`, `text-center`, …)

| Column / component | Centering? | Wrapper (if any) |
| --- | --- | --- |
| `scheduled_at` | **No** | None — bare `<span>…</span>`. |
| `time` | **No** | None for the dash branches (non-dash branch uses `<div className='flex items-center'>…`). |
| `gross_price` | **No** | None. |
| `fremdfirma` | **Yes** | `<div className='flex justify-center px-1'>` wraps the conditional; dash path is `<span className='text-muted-foreground'>—</span>` inside it. |
| `fremdfirma_abrechnung` | **Yes** | `<div className='flex justify-center px-1'>` wraps the dash `<span>…`. |
| `billing_calling_station` | **No** | None. |
| `billing_betreuer` | **No** | None. |
| `net_price` | **No** | None. |
| `tax_rate` | **No** | None. |
| `KtsFehlerSwitchCell` | **No** (for the dash) | Dash branch returns only the `<span>…`; the **enabled** branch uses `<div className='flex justify-center px-1'>`. |
| `KtsFehlerTextCell` | **No** | None around the dash `<span>`. |
| `RehaScheinSwitchCell` | **No** (for the dash) | Dash branch is bare `<span>…`; gated **on** branch uses `<div className='flex justify-center px-1'>`. |

---

## 3. Node type: plain text vs `<span>` vs `<div>`

All **`—`** placeholders in scope are **`—` inside a `<span>`** with `className='text-muted-foreground'` (verbatim in each case above).

**No** dash placeholder uses a `<div>` as the immediate parent of **`—`**; `<div>` centering wrappers only wrap the `<span>` on **`fremdfirma`**, **`fremdfirma_abrechnung`**, and the **Switch** variants (not the dash rows for KTS-Fehler / Reha).

---

## 4. Defined inline vs delegated file

| Column `id` / cell | Defined in |
| --- | --- |
| `scheduled_at`, `time`, `gross_price`, `fremdfirma`, `fremdfirma_abrechnung`, `billing_calling_station`, `billing_betreuer`, `net_price`, `tax_rate` | `src/features/trips/components/trips-tables/columns.tsx` |
| `kts_fehler` (`KtsFehlerSwitchCell`) | `src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx` |
| `kts_fehler_beschreibung` (`KtsFehlerTextCell`) | `src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx` |
| `reha_schein` (`RehaScheinSwitchCell`) | `src/features/trips/components/trips-tables/inline-cells/reha-cells.tsx` |

Barrel import in `columns.tsx`: `from './inline-cells'` → `inline-cells/index.ts` re-exports `kts-cells` and `reha-cells`.

---

## Note — ASCII `-` (not `—`)

These are **not** em-dash placeholders but empty-state glyphs in the same table file:

- **`payer_name`:** `{row.original.payer?.name || '-'}` inside `<div>` — **hyphen-minus**.
- **`billing_type`:** when `formatBillingDisplayLabel` yields empty after trim, early return **`'-'`** (string node, **hyphen-minus**), not `—`.

Excluded from counts above.

---

## Out of scope (not `columns.tsx` / not `inline-cells` barrel)

**`trips-mobile-card-list.tsx`** uses `'—'` in places for the mobile layout; not part of the desktop column definitions audited here.

---

*End of audit.*
