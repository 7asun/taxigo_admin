# Price engine — distance override audit (read-only)

Scope: how `client_km_overrides` distances are chosen and converted, and how invoice line items pass the resolved km into `resolveTripPricePure`. No code changes.

---

## 1. `pickClientKmOverrideRow` — what it returns

`pickClientKmOverrideRow` does **not** return a numeric km value. It returns **`ClientKmOverrideLike | null`**: the full matching catalog row (or `null`). Selection uses payer / billing-variant precedence only; **`drivingDistanceKm` is not an argument** and is never combined inside this function.

```33:70:src/features/invoices/lib/resolve-effective-distance.ts
function pickClientKmOverrideRow(
  rows: ClientKmOverrideLike[],
  payerId: string | null | undefined,
  billingVariantId: string | null | undefined
): ClientKmOverrideLike | null {
  if (rows.length === 0) return null;
  const pid = payerId ?? null;
  const vid = billingVariantId ?? null;

  if (vid) {
    const variantRows = rows.filter(
      (r) => r.billing_variant_id != null && r.billing_variant_id === vid
    );
    const variantPayer = variantRows.find(
      (r) => r.payer_id != null && r.payer_id === pid
    );
    if (variantPayer) return variantPayer;
    const variantAnyPayer = variantRows.find((r) => r.payer_id == null);
    if (variantAnyPayer) return variantAnyPayer;
  }

  const payerWide = rows.filter(
    (r) =>
      (r.billing_variant_id == null || r.billing_variant_id === undefined) &&
      r.payer_id != null &&
      r.payer_id === pid
  );
  if (payerWide.length > 0) return payerWide[0];

  const fullyGlobal = rows.filter(
    (r) =>
      (r.billing_variant_id == null || r.billing_variant_id === undefined) &&
      r.payer_id == null
  );
  if (fullyGlobal.length > 0) return fullyGlobal[0];

  return null;
}
```

The numeric km is produced **later** in `resolveEffectiveDistanceKm` by calling `parseOverrideKm(picked.distance_km)`.

---

## 2. Numeric conversion: `Number(...)`, not `parseFloat`

Override km is normalized in `parseOverrideKm`:

- If `raw` is already a `number`, that value is used.
- Otherwise **`Number(raw)`** is used (not `parseFloat`).

`parseFloat` is not used anywhere in this file.

```15:24:src/features/invoices/lib/resolve-effective-distance.ts
function isUsableKm(n: number): boolean {
  // why: zero/negative distance is not a billable route; treating it as missing avoids
  // poisoning tax tiers (50 km boundary) and per-km totals with nonsense input.
  return Number.isFinite(n) && n > 0;
}

function parseOverrideKm(raw: number | string): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return isUsableKm(n) ? n : null;
}
```

So for a string like `"20.100"`, the code path is `Number("20.100")` → **`20.1`** (JavaScript’s usual numeric parsing). If `Number` yields `NaN`, non-finite, or `≤ 0`, `parseOverrideKm` returns `null` and the resolver falls through to `drivingDistanceKm`.

---

## 3. `resolveEffectiveDistanceKm` — override branch vs `drivingDistanceKm`

When an override row is picked and `parseOverrideKm` returns a non-null km, the function returns **only that parsed number**. There is **no** expression mixing override and `drivingDistanceKm` (no sum, max, average, etc.).

**Exact return statement for the override-wins branch:**

```112:113:src/features/invoices/lib/resolve-effective-distance.ts
    const km = picked ? parseOverrideKm(picked.distance_km) : null;
    if (km != null) return km;
```

Full priority for context:

```95:119:src/features/invoices/lib/resolve-effective-distance.ts
  const manual = input.manualDistanceKm;
  if (manual != null && isUsableKm(manual)) {
    // why: trip-level manual KM is the strongest signal — it reflects a human decision
    // on this specific ride after seeing the invoice context, not a catalog default.
    return manual;
  }

  const cid = input.clientId;
  if (cid && input.clientKmOverrides.length > 0) {
    const rows = input.clientKmOverrides.filter(
      (r) => r.client_id === cid && r.is_active === true
    );
    const picked = pickClientKmOverrideRow(
      rows,
      input.payerId,
      input.billingVariantId
    );
    const km = picked ? parseOverrideKm(picked.distance_km) : null;
    if (km != null) return km;
  }

  const driving = input.drivingDistanceKm;
  if (driving == null) return null;
  // why: routing distance may be 0 in edge cases; still a resolved value unlike "unknown".
  return Number.isFinite(driving) ? driving : null;
```

---

## 4. Type of `distance_km` in JavaScript

**Generated DB types** declare `distance_km` as **`number`** on `client_km_overrides.Row`:

```341:352:src/types/database.types.ts
      client_km_overrides: {
        Row: {
          id: string;
          company_id: string;
          client_id: string;
          payer_id: string | null;
          billing_variant_id: string | null;
          distance_km: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
```

The resolver’s **`ClientKmOverrideLike`** allows **`number | string`** so the pure function can accept test doubles or odd JSON shapes; production mapping passes the row field through unchanged:

```21:28:src/features/invoices/api/client-km-overrides.api.ts
function mapRowToLike(row: ClientKmOverrideRow): ClientKmOverrideLike {
  return {
    client_id: row.client_id,
    payer_id: row.payer_id,
    billing_variant_id: row.billing_variant_id,
    distance_km: row.distance_km,
    is_active: row.is_active === true
  };
}
```

**In practice** (Supabase JS client + Postgres `numeric`): expect a **number**. If a string ever appeared (e.g. manual test object), the code would use **`Number(raw)`**, not `parseFloat`.

---

## 5. Step-by-step trace: Bienert scenario

**Assumptions (as given):**

- `manualDistanceKm = null`
- `drivingDistanceKm = 19.164`
- A winning override row exists with `distance_km` as the string **`"20.100"`** (hypothetical string; if the runtime supplies `20.1` as a number, the numeric branch is taken instead — same final km)

**Steps:**

1. **Manual branch:** `manual != null && isUsableKm(manual)` is false → continue.
2. **Override branch:** `clientId` truthy and `clientKmOverrides.length > 0` → filter rows where `client_id` matches Bienert and `is_active === true`.
3. **`pickClientKmOverrideRow(rows, payerId, billingVariantId)`** returns one **`ClientKmOverrideLike`** row (precedence per variant/payer/global rules).
4. **`km = parseOverrideKm(picked.distance_km)`**
   - If `distance_km` is string `"20.100"`: `n = Number("20.100")` → **`20.1`**; `isUsableKm(20.1)` → true → **`km = 20.1`**.
   - If `distance_km` is already number **`20.1`**: `n = 20.1` → same result.
5. **`if (km != null) return km`** → function returns **`20.1`**.
6. **`drivingDistanceKm` (19.164) is not used** in this path.

**Result:** `resolveEffectiveDistanceKm` returns **`20.1`**, not `19.164`.

---

## 6. How that value reaches `resolveTripPricePure`

`buildLineItemsFromTrips` resolves distance once, then passes it as **`driving_distance_km`** on the payload to `resolveTripPricePure` (naming reflects the trip field shape; the value is the **effective** km, not necessarily Google’s raw routing value).

```459:492:src/features/invoices/api/invoice-line-items.api.ts
    const effectiveDistanceKm = resolveEffectiveDistanceKm({
      manualDistanceKm: trip.manual_distance_km ?? null,
      drivingDistanceKm: trip.driving_distance_km ?? null,
      clientId: trip.client?.id ?? null,
      payerId: trip.payer_id ?? null,
      billingVariantId: trip.billing_variant_id ?? null,
      clientKmOverrides
    });

    const { rate: taxRate } = resolveTaxRate(effectiveDistanceKm);

    const rule = resolvePricingRule({
      rules,
      payerId: trip.payer_id,
      billingTypeId: trip.billing_variant?.billing_type_id ?? null,
      billingVariantId: trip.billing_variant_id,
      clientId: trip.client?.id ?? null,
      clientPriceTags
    });

    // manual_gross_price: persisted taxameter — P0 in resolveTripPrice (trips are SSOT).
    const priceResolution = resolveTripPricePure(
      {
        kts_document_applies: trip.kts_document_applies === true,
        net_price: trip.net_price ?? null,
        base_net_price: trip.base_net_price ?? null,
        manual_gross_price: trip.manual_gross_price ?? null,
        driving_distance_km: effectiveDistanceKm,
        scheduled_at: trip.scheduled_at,
        client: trip.client
      },
      taxRate,
      rule
    );
```

---

## Summary table

| Question | Answer |
|----------|--------|
| What does `pickClientKmOverrideRow` return? | The **full override row** (`ClientKmOverrideLike \| null`), not a km scalar. |
| How is km extracted? | `parseOverrideKm(picked.distance_km)` → **`Number`** for non-numbers, else the number as-is. |
| Combined with `drivingDistanceKm`? | **No.** Override path returns **only** parsed override km. |
| Override-wins return | `if (km != null) return km;` |
| DB / typical JS type for `distance_km` | **`number`** per `database.types.ts`; interface allows `string` for flexibility. |
| Bienert example | Returns **`20.1`**, ignoring **`19.164`** when override applies. |
