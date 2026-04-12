# Client price tags (`client_price_tags`)

Negotiated **gross (brutto)** prices per Fahrgast, optionally scoped to a **Kostenträger** and/or **Unterart** (`billing_variants`). Used in invoice line-item resolution **before** `billing_pricing_rules`.

## Table schema

| Column | Meaning |
|--------|---------|
| `id` | Primary key |
| `company_id` | Tenant (RLS) |
| `client_id` | FK → `clients` |
| `payer_id` | Optional FK → `payers`; null = not payer-scoped |
| `billing_variant_id` | Optional FK → `billing_variants`; null = not variant-scoped |
| `price_gross` | `numeric(10,2)` — brutto inkl. MwSt. |
| `is_active` | Soft-disable without deleting history |
| `created_at` / `updated_at` | Timestamps |

**Uniqueness (active rows only, partial indexes):**

- One global tag per client: `(client_id)` where `payer_id` and `billing_variant_id` are null.
- One payer-scoped tag per `(client_id, payer_id)` where variant is null.
- One variant-scoped tag per `(client_id, billing_variant_id)`.

## Resolution priority (STEP 0)

Implemented in `resolvePricingRule` when `clientId` and `clientPriceTags[]` are passed (invoice builder loads tags for all trip clients in one query after `fetchTripsForBuilder`).

For a given trip, among **active** tags for that `client_id`:

1. **Variant** — `billing_variant_id` equals the trip’s `billing_variant_id`.
2. **Payer** — `payer_id` equals the trip’s `payer_id`, variant null.
3. **Global** — both `payer_id` and `billing_variant_id` null.

If a tag matches and `price_gross > 0`, the resolver returns a **synthetic** `BillingPricingRuleLike` with `strategy: 'client_price_tag'` and **`_price_gross`**. `resolveTripPrice` P1 uses that gross before falling back to **`clients.price_tag`**.

If STEP 0 finds nothing, the existing billing rule waterfall (variant → type → payer) runs unchanged.

## Legacy `clients.price_tag`

The column is **not dropped** in the first migration. New data uses **`client_price_tags`**; **`setClientPriceTag`** keeps the **global** CPT row and **`clients.price_tag`** in sync for backwards compatibility and gradual rollout.

A follow-up migration may drop `clients.price_tag` once production is verified.

## Admin UI

- **Abrechnung → Preisregeln:** one table row per `client_price_tags` row (with client name + scope label).
- **Dialog:** strategy **Kunden-Preis (`client_price_tag`)** → Step 2 **manager**: search client, list tags, inline add (optional Kostenträger → Unterart), edit, active toggle, delete.

## API surface

- `src/features/payers/api/client-price-tags.service.ts` — `listClientPriceTagsForClientIds`, `listAllClientPriceTagsForCompany`, `listClientPriceTagsForManager`, `insertClientPriceTag`, `updateClientPriceTag`, `deleteClientPriceTag`.
- `src/features/clients/api/clients-pricing.api.ts` — `setClientPriceTag` for global sync.

## RLS

Same pattern as other admin billing tables: `client_price_tags_admin` — authenticated admin, `company_id = current_user_company_id()`.

## Migration

`supabase/migrations/20260412140000_client_price_tags.sql` creates the table, indexes, RLS, and backfills from `clients.price_tag` where `price_tag > 0` into a global CPT row (skips duplicates).
