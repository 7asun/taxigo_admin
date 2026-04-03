---
name: KTS document workflow
overview: Merge of strategic plan + implementation-suggestions/kts-architecture-spec.md. Operational KTS flag on trips, catalog cascade (variant → familie JSON → payer), trips.kts_source transparency, V1 invoice soft warnings, V2 kts_reviews roadmap. Documentation lives in docs/kts-architecture.md.
todos:
  - id: migration-kts-v1
    content: "SQL: payers.kts_default (bool NULL), billing_variants.kts_default (bool NULL), behavior_profile.kts_default yes|no|unset, trips.kts_document_applies + trips.kts_source; COMMENT ON; RLS as needed; bun run db:types"
    status: in_progress
  - id: resolver-lib
    content: "Add src/features/trips/lib/resolve-kts-default.ts (+ unit clarity); normalize missing behavior_profile.kts_default to unset; return { value, source }"
    status: pending
  - id: catalog-ui
    content: "Payer editor kts_default; billing-type-behavior-dialog + BillingTypeBehavior types/Zod; billing variant dialog kts_default"
    status: pending
  - id: trip-ui
    content: "Neue Fahrt + Trip-Detail KTS switch, hints, manual-override tracking (do not re-run resolver after user override); paired-trip-sync + patches"
    status: pending
  - id: recurring-csv-dup
    content: "recurring_rules columns + cron copy; bulk CSV kts_document_applies; duplicate-trips + build-return-trip-insert (see spec for kts_source on copy)"
    status: pending
  - id: invoice-soft-warning
    content: "V1 KTS badge on trip rows in invoice/billing views + batch warning (no hard block)"
    status: pending
  - id: docs-inline
    content: "Keep docs/kts-architecture.md canonical; billing-families-variants cross-link; concise comments on resolver + trip KTS field wiring"
    status: completed
  - id: v2-kts-reviews
    content: "Deferred kts_reviews append-only table + UI (see docs/kts-architecture.md §8); reserve name kts_review_status on trips if ever needed — do not use until V2"
    status: pending
isProject: false
---

# KTS (Krankentransportschein) — merged implementation plan

## Canonical documentation

- **Single source of truth:** [`docs/kts-architecture.md`](../../docs/kts-architecture.md) (architecture, cascade, schema, UI, CSV, V1/V2 boundaries, code map).
- **Billing context:** [`docs/billing-families-variants.md`](../../docs/billing-families-variants.md) — short KTS subsection + link to the architecture doc.
- **Original working spec (archive):** [`implementation-suggestions/kts-architecture-spec.md`](../../implementation-suggestions/kts-architecture-spec.md) — header points to `docs/` to avoid drift.

## Honest assessment (integration review)

**What is strong in the merged spec**

- **Two-layer model** (Abrechnung vs. operational KTS) matches how dispatch and clearing actually work; the explicit `trips.kts_document_applies` flag avoids inferring KTS from display names or variant codes.
- **Cascade with variant participation** is correct for real trees (e.g. „Dialyse · KTS“ vs „Dialyse · Standard“ under the same Familie). **Unterart-level `kts_default` is mandatory in V1**, as in your spec.
- **`trips.kts_source`** (`variant` | `familie` | `payer` | `manual` | `system_default`) is high leverage for support and substitute admins; keep it on every save path that touches the flag.
- **V1 “soft warning” in invoice flows** is pragmatic: no accidental hard-block of edge cases while still surfacing risk.
- **V2 `kts_reviews` as insert-only** is the right shape for audit history; nullable `created_by` + `created_by_label` is realistic before clearing gets logins.

**Gaps / decisions to watch during implementation**

1. **`kts_source` on duplicate / Rückfahrt:** The spec sets `manual` for copies to mean “not fresh catalog resolution.” That conflates with a dispatcher toggling the switch by hand. If debugging duplicates matters, consider extending the enum later with `duplicated` (optional V1.1); otherwise document the convention and accept it.
2. **Resolver vs. `behavior_profile` normalization:** Family uses JSON `kts_default: 'yes' | 'no' | 'unset'`; missing key must normalize to `'unset'` (same discipline as other behavior fields in [`normalizeBillingTypeBehavior`](../../src/features/trips/lib/normalize-billing-type-behavior-profile.ts)).
3. **Manual override + billing changes:** When payer/Familie/Unterart changes, spec says re-run resolver **unless** the user already overrode KTS — implement explicit “dirty” state for the KTS control so auto hints do not stomp intentional overrides.
4. **V2 `kts_reviews.created_by`:** Spec references `users(id)` — align the FK to whatever your app uses for staff identity (e.g. `public.users` / profiles) when you build V2; until then the table is only a roadmap.
5. **Invoice UI touchpoints:** The plan assumes “invoice batch” views exist; map warnings to **concrete routes/components** in a short follow-up task list when you start that step (grep `invoice` / batch in `src/features/invoices`).

**Verdict:** The integration is sound and **ready to implement** as written, with the small clarifications above handled in code/comments as you go.

## Code layout (maintainability)

| Piece | Location |
| ----- | -------- |
| Cascade resolver | `src/features/trips/lib/resolve-kts-default.ts` |
| Types + Zod | Extend `src/features/payers/types/payer.types.ts`, behavior dialog schema in `billing-type-behavior-dialog.tsx` |
| Trip create/edit | `create-trip-form.tsx`, `schema.ts`, `payer-section.tsx` (or adjacent KTS subcomponent), trip-detail patch builders |
| CSV | `bulk-upload-dialog.tsx` + [`docs/bulk-trip-upload.md`](../../docs/bulk-trip-upload.md) when column is added |
| Cron | `src/app/api/cron/generate-recurring-trips/route.ts` |

Keep **one** resolver implementation; CSV, forms, and cron call it.

## Execution order

Matches [`docs/kts-architecture.md`](../../docs/kts-architecture.md) §9: migration → resolver → catalog UI → trip UI → duplicate/Rückfahrt → recurring → CSV → invoice warnings → verify docs.

## Implementation readiness (start here)

1. Apply migration in Supabase (or `supabase db push` / local), then `bun run db:types` — or merge hand-edited `database.types.ts` until types are regenerated.
2. **Reference data:** `fetchPayers` / `fetchBillingVariantsForPayer` must select `kts_default`; variant nested select includes `billing_variants.kts_default`.
3. **Manual KTS lock (Neue Fahrt):** `useRef` `ktsUserLocked`; set `true` on switch `onCheckedChange`; on `payer_id` / `billing_variant_id` / effective family change, if `!ktsUserLocked` re-run `resolveKtsDefault` and `setValue('kts_document_applies', …)`.
4. **Submit:** `kts_source = ktsUserLocked ? 'manual' : resolveKtsDefault(...).source` (while `!ktsUserLocked`, the form value is kept in sync with the resolver, so the stored source is always the catalog tier).
5. **Duplicates:** copy `kts_document_applies`; set `kts_source = 'manual'`.

## Strategic notes (from earlier brainstorm)

- KTS is **operational** (“Schein / Prozess relevant”), not a duplicate of Kostenträger naming.
- Catalog defaults remove redundant clicking; **switch stays visible and editable** (your spec).
- V2 review state stays **off** `trips` until `kts_reviews` ships; do not repurpose reserved names.
