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
- **`shift_reconciliations`**: one row per `(company_id, driver_id, date)`; `confirmed_by`, `confirmed_at`, `notes`, optional `shift_id` (FK, nullable, `ON DELETE SET NULL`).

**Deferred:** `billing_variants.accepts_self_payment` (per-Unterart override) is not implemented; add only if the business needs a third tier.

## Price rules (UI & writes)

- **Display and sums** use `getEffectivePrice` (`manual_gross_price` ?? `gross_price` ?? 0).
- **Writes** use **`trips.manual_gross_price` only** — never `gross_price`, `net_price`, `base_net_price`, or `approach_fee_net`. Updates bypass the trips pricing service so the engine does not overwrite paper corrections.

## RLS

`shift_reconciliations` uses the same pattern as other company-scoped admin tables: policies tied to `current_user_company_id()` and `current_user_is_admin()`.

## URL state (nuqs)

- **A** — no `driver`: empty prompt.
- **B** — `?driver=<id>` only: **list view** (month-grouped day rows). Data comes from the **`get_shift_day_summaries` RPC** (per-day aggregates only — never re-sum full trips in the browser for this list).
- **C** — `?driver=<id>&date=YYYY-MM-DD`: **detail** (summary bar, trip table, confirm). `date` is optional in the date picker; clearing it returns to the list. Changing the driver clears `date` to avoid a stale driver+day pair.

Links are shareable; refresh keeps the same selection.

## Component tree (rough)

- **RSC** `app/dashboard/shift-reconciliations/page.tsx` — `getDrivers()`; if **B**, prefetches `getShiftDaySummaries` → `initialSummaries`; if **C**, prefetches trips + reconciliation → `initialBundle`.
- **Client** `shift-reconciliation-page-client.tsx` — composes by state: `shift-reconciliation-filters.tsx` · `shift-day-list.tsx` (B) · `shift-detail-panel.tsx` (C: summary, table, confirm). Confirm success can clear `date` to return to the list.

**Server actions** in `actions.ts` only delegate to `api/shift-reconciliations.service.ts` (see `docs/SUPABASE_INTEGRATION.md`).

## Deferred / known limitations

- **Trip `status` filter:** the listing includes **`assigned`** trips only. Trips in **`in_progress`**, **`completed`**, or other states are **excluded** even if they appear on a paper Schichtzettel. Expanding the filter is a product follow-up.
- A **`shifts` row** for the day is **not required**; reconciliation can be confirmed with `shift_id` null (driver shift app is separate from this workflow).

## Related

- Business-day bounds: `getZonedDayBoundsIso` — see `docs/trips-date-filter.md`.
- Payer- and family-level `accepts_self_payment`: see **Data model** above; `src/features/trips/lib/resolve-accepts-self-payment.ts` for the TS contract.
