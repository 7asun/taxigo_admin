# Schichtzettel-Abgleich (shift reconciliation)

## Purpose

Admins review **trips** for a **driver** and **business-calendar day** against the paper Schichtzettel: they can correct the displayed amount via `manual_gross_price` and **confirm** the shift in a dedicated `shift_reconciliations` row (audit trail, optional `shift_id` link).

## Data model

**Effective Selbstzahler (per trip):** use `resolveAcceptsSelfPayment` in TypeScript and `COALESCE(billing_types.accepts_self_payment, payers.accepts_self_payment)` in SQL (`get_shift_day_summaries`). Order of resolution:

1. **`billing_types.accepts_self_payment`** when non-null — wins for trips with a `trips.billing_type_id` pointing at that family.
2. Else **`payers.accepts_self_payment`** — `true` = Selbstzahler, `false` = Rechnung, `null` = unconfigured (UI warning; not treated as invoice).

**Inherit at family:** `billing_types.accepts_self_payment` can be `NULL` to follow the payer (same as other catalog “unset” tri-state fields).

**No family on trip:** when `trips.billing_type_id` is `NULL` (e.g. some Rückfahrten, bulk imports), there is no family tier — resolution uses the payer only. This is expected, not an error.

- **`payers.accepts_self_payment`**: see Kostenträger detail sheet (**Fahrgast zahlt direkt (Schichtzettel)**).
- **Family override:** Abrechnungsfamilie bearbeiten — **Selbstzahler (Abrechnungsfamilie)** (Vererben / Selbstzahler / Rechnung).
- **`shift_reconciliations`**: one row per `(company_id, driver_id, date)`; `confirmed_by`, `confirmed_at`, `notes`, optional `shift_id` (FK, nullable, `ON DELETE SET NULL`), **`status`** (`open` | `completed`, default `completed`).

**Deferred:** `billing_variants.accepts_self_payment` (per-Unterart override) is not implemented; add only if the business needs a third tier.

## Phase A (shipped) — Unified Schichtzettel workspace

One page processes the paper Schichtzettel without switching to Fahrerschichtplanung for trip sign-off.

### List layout (State B)

Each day is a **two-row inline card** (plus optional Phase B row placeholder):

| Row | Content |
| --- | --- |
| **Row 1 — Ist-Zeit** | Inline `Beginn` / `Ende` / `Pause` (minutes); save on blur; **Arbeitsstunden** (e.g. `8,0 Std.`) and **€/h** when revenue and hours &gt; 0 |
| **Row 2 — Fahrten** | Trip count, Selbstzahler/Rechnung split bar, total revenue, **Details →** link |
| **Row 3 (Phase B)** | Comment placeholder in `shift-day-row.tsx` for `vehicle_shift_logs` — not implemented |

**Day header:** date, status badge, **Abschließen** / **Erneut öffnen**.

**Urlaub/Krank (`plan_only`):** plan badge only — no rows, no action.

### Detail view (State C — `?driver&date&mode=detail`)

Tabs: **Fahrten** · **Ist-Zeit** (`AdminShiftEntryForm`) · **Kilometer** (Phase B placeholder) · **Abschluss** (checklist + complete/reopen + notes).

### Three list sources (`get_shift_day_summaries` RPC)

| `day_type` | Source |
| --- | --- |
| `trips` | Assigned trips grouped by Berlin date |
| `shift_only` | `shifts` row with zero assigned trips (D3) |
| `plan_only` | `driver_day_plans` with `vacation` or `sick`, no trips |

### `showIstZeit` (Option B → Option A path)

- **Option B (now):** `showIstZeit={true}` hardcoded in `shift-day-list.tsx` only.
- **Option A (future):** swap to `driver.requires_shift_times` from page props — **one assignment site**; row component reads `IstZeitRowProps.showIstZeit` only.

### Product decisions (Phase A — not Phase 4 driver-planning D1–D4)

| ID | Rule |
| --- | --- |
| D1 | **Abschließen** requires complete Ist-Zeit **only if** a `shifts` row exists with incomplete times (`ended_at` null). Empty Row 1 (no shift) is allowed — not all drivers are hourly. |
| D2 | Admin can **reopen** a completed reconciliation (`status → open`). |
| D3 | Days with shift actuals but zero assigned trips appear in the list (`shift_only`). |
| D4 | Fahrerschichtplanung **Ist-Zeit** tab links to full reconciliation page (`mode=detail`), not a sheet. |
| D5 | `showIstZeit` always true in Option B; isolated behind one prop for future `accounts.requires_shift_times`. |

### Status migration

[`20260608140000_add_reconciliation_status.sql`](../supabase/migrations/20260608140000_add_reconciliation_status.sql) — `status text NOT NULL DEFAULT 'completed'`. Existing rows implied completion via legacy `confirmShift`.

RPC replaced in [`20260608140100_update_shift_day_summaries.sql`](../supabase/migrations/20260608140100_update_shift_day_summaries.sql) (DROP + CREATE in same transaction when return columns change).

### €/h display

`total_revenue ÷ Arbeitsstunden` shown only when both &gt; 0. Arbeitsstunden = `(Ende − Beginn − Pause)` formatted with `Intl.NumberFormat('de-DE')` → `"8,0 Std."` (comma decimal).

### Inline Ist-Zeit save

`saveIstZeitInline` calls `createAdminShiftForDriver` (same `entered_by`, Berlin bounds, unique index). Success is **silent** (no toast); list refreshes via query invalidation on `summaries(driverId)`.

### Deep link

Fahrerschichtplanung popover **Ist-Zeit** tab → **Vollständigen Abgleich öffnen →** → `/dashboard/shift-reconciliations?driver=&date=&mode=detail`.

## Price rules (UI & writes)

- **Display and sums** use `getEffectivePrice` (`manual_gross_price` ?? `gross_price` ?? 0).
- **Writes** use **`trips.manual_gross_price` only** — never `gross_price`, `net_price`, `base_net_price`, or `approach_fee_net`. Updates bypass the trips pricing service so the engine does not overwrite paper corrections.

## RLS

`shift_reconciliations` uses the same pattern as other company-scoped admin tables: policies tied to `current_user_company_id()` and `current_user_is_admin()`.

## URL state (nuqs)

- **A** — no `driver`: empty prompt.
- **B** — `?driver=<id>` only: **list view** (month-grouped two-row day cards). Data from **`get_shift_day_summaries` RPC** (trips + shifts + plan days).
- **C** — `?driver=<id>&date=YYYY-MM-DD&mode=detail`: **detail tabs** (Fahrten, Ist-Zeit, Kilometer placeholder, Abschluss). Date picker sets `mode=detail`. Changing driver clears `date`.

Links are shareable; refresh keeps the same selection.

## Component tree (rough)

- **RSC** `app/dashboard/shift-reconciliations/page.tsx` — `getDrivers()`; if **B**, prefetches `getShiftDaySummaries` → `initialSummaries`; if **C**, prefetches trips + reconciliation → `initialBundle`.
- **Client** `shift-reconciliation-page-client.tsx` — `shift-reconciliation-filters.tsx` · `shift-day-list.tsx` → `shift-day-row.tsx` (B) · `shift-detail-panel.tsx` (C: tabbed detail). Abschluss success can clear URL to return to list.

**Server actions** in `actions.ts` only delegate to `api/shift-reconciliations.service.ts` (see `docs/SUPABASE_INTEGRATION.md`).

## Deferred / known limitations

- **Trip `status` filter:** the listing includes **`assigned`** trips only. Trips in **`in_progress`**, **`completed`**, or other states are **excluded** even if they appear on a paper Schichtzettel. Expanding the filter is a product follow-up.
- A **`shifts` row** for the day is **not required**; reconciliation can be confirmed with `shift_id` null (driver shift app is separate from this workflow).

## Related

- Business-day bounds: `getZonedDayBoundsIso` — see `docs/trips-date-filter.md`.
- Payer- and family-level `accepts_self_payment`: see **Data model** above; `src/features/trips/lib/resolve-accepts-self-payment.ts` for the TS contract.
