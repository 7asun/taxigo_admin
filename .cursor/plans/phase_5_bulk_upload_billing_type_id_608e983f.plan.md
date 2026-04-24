---
name: Phase 5 Bulk Upload billing_type_id
overview: Align bulk CSV upload with create-trip-form and recurring-trips cron by deriving `billing_type_id` from the resolved variant row in `billingTypeTree`, tightening the nested variant type, and blocking uploads until billing data has loaded—documented in the pre-audit and price-calculation-engine docs.
todos:
  - id: step1-type
    content: Add billing_type_id to BillingTypeTreeRow; bun run build
    status: completed
  - id: step2-derive
    content: Replace billing_type_id line with variant tree IIFE + why comment; build
    status: completed
  - id: step3-guard
    content: Add processCsv early guard + why comment; build
    status: completed
  - id: step4-docs
    content: Update phase5-preaudit.md + price-calculation-engine.md; build
    status: completed
isProject: false
---

# Phase 5 — Bulk upload `billing_type_id` fix

## Scope

- **Code:** Only [`src/features/trips/components/bulk-upload-dialog.tsx`](src/features/trips/components/bulk-upload-dialog.tsx) (per your hard rule for source).
- **Docs:** [`docs/plans/phase5-preaudit.md`](docs/plans/phase5-preaudit.md) and [`docs/price-calculation-engine.md`](docs/price-calculation-engine.md) (Step 4 is mandatory).

No pricing engine, resolver, service, or variant-resolution logic changes.

## Step 1 — `BillingTypeTreeRow` nested type

In `bulk-upload-dialog.tsx`, extend the nested `billing_variants` object to include **`billing_type_id: string`**, matching the existing select:

```188:189:src/features/trips/components/bulk-upload-dialog.tsx
        .select(
          `id, name, payer_id, behavior_profile, billing_variants ( id, name, code, sort_order, kts_default, billing_type_id )`
```

Run **`bun run build`**.

## Step 2 — Derive `billing_type_id` from variant

In the `InsertTrip` literal inside the CSV `for` loop, replace:

`billing_type_id: matchedType?.id || null,`

with your specified IIFE: walk **`billingTypeTree`**, find **`typeRow.billing_variants.find((v) => v.id === billingVariantId)`**, return **`variant.billing_type_id`**, else **`matchedType?.id ?? null`**.

Add a short **why** comment (not a restatement of the code): e.g. parent type must come from the FK on the variant row (same invariant as [`create-trip-form.tsx`](src/features/trips/components/create-trip/create-trip-form.tsx) / cron) so a bad or missing **Abrechnungsart** string cannot clear **`billing_type_id`** when **`billing_variant_id`** is set; note **`billing_type_id` on the variant is the authoritative parent** when a variant exists.

Run **`bun run build`**.

## Step 3 — Load-race guard

**Placement (recommended):** At the top of **`processCsv`**, immediately after `if (files.length === 0) return;`, **before** `setIsProcessing(true)` and **before** `Papa.parse(...)`.

Reason: avoids leaving **`isProcessing`** stuck `true` if the guard fired inside the async `complete` callback (end of `complete` already calls `setIsProcessing(false)`, but an early return mid-callback would not).

Behavior: if **`billingTypeTree.length === 0`**, show the German toast and **`return`** (no parse). This matches your spec’s intent (do not process while tree is still empty from the initial state / pre-effect).

**Caveat to accept per spec:** If the effect has finished and the tenant truly has **zero** `billing_types` rows, the tree stays `[]` and uploads will be blocked. If that is unacceptable later, a dedicated `billingTypesLoaded` flag would distinguish “not loaded” vs “loaded empty.”

Add a **why** comment: silent null **`billing_type_id`** on every row when the tree has not loaded yet.

Run **`bun run build`**.

## Step 4 — Documentation and comments

**a)** [`docs/plans/phase5-preaudit.md`](docs/plans/phase5-preaudit.md): append section **“Phase 5 — Applied”** with date **2026-04-24** and one paragraph summarizing: type alignment, variant-based derivation, upload guard.

**b)** [`docs/price-calculation-engine.md`](docs/price-calculation-engine.md): in or near the existing bulk-upload row in the table (~line 153) and/or the diagram reference to `bulk-upload-dialog.tsx`, add 2–3 sentences: **`billing_type_id`** is derived from the resolved variant’s **`billing_type_id`** (parity with create form + cron); upload is blocked until **`billingTypeTree`** is non-empty to avoid the load race.

**c)** In `bulk-upload-dialog.tsx`, ensure **three** targeted **why** comments exist (type block optional one line if needed; primary comments at: nested type if you document drift; IIFE derivation; guard). Per your list: variant vs name match; NOT NULL / authoritative parent from variant row; guard vs silent degradation.

Run **`bun run build`**.

## Verification

- **`bun run build`** after each step (per your workflow).
- Manually sanity-check: row with **`billing_variant_id` set** and typo/mismatch in **Abrechnungsart** should still get correct **`billing_type_id`** from the variant parent (once tree loaded).

## Optional const for toast

If ESLint complains about duplicate/long string, extract the German message to a **`const`** at module or function top; otherwise inline is fine per your rules.
