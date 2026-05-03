# Geocoding Strategy Brainstorm

**Scope:** Trade-off analysis only. No implementation plan.

**Problem (restated):** Perceived “same route” trips get different `driving_distance_km` because different write paths materialise slightly different lat/lng, which miss `route_metrics_cache` (5 dp coordinate key) and trigger new Directions results. Invoices read the stored trip distance, so passengers and auditors see inconsistency.

---

## Option A — Unify on the Geocoding API (structured address)

### What the codebase supports today (form)

- The create-trip flow uses **`AddressAutocomplete`**, which loads suggestions from **`/api/places-autocomplete`**, and on selection can call **`/api/place-details?placeId=...`** to resolve a Place to **lat/lng and structured fields** (`address-autocomplete.tsx` ~230–235; `place-details/route.ts` ~125–131 returns `lat`, `lng`, `zip_code`, `street`, `street_number`, `city`).
- The form’s `AddressResult` and `AddressGroupEntry` carry **structured fields** (`street`, `street_number`, `zip_code`, `city`, `lat`, `lng`, optional `placeId`) — see `updatePickupAddress` in `create-trip-form.tsx` (e.g. population of `street`, `zip_code`, `lat`, `lng` from the selected result ~843–858).
- So **after a proper autocomplete selection + Place Details**, the client already has **everything needed** to call `geocodeStructuredAddressToLatLng` **without** inventing parsing — either **reuse Place Details geometry as today**, or **discard geometry** and re-geocode from those structured fields via **`/api/geocode-address`** (which wraps `geocodeStructuredAddressToLatLng`).

If the dispatcher **only types free text** without selecting a suggestion, structured fields may stay incomplete — then Option A is **not** automatic; you still need extraction or an insist-on-selection UX rule.

### Would dropping Place Details geometry hurt TaxiGo?

- **Places (especially establishments)** often anchor to a **building or POI centroid** that can differ from **Geocoding API** results for the same postal address (street-level vs rooftop vs along-street interpolation).
- **Dialysis clinics, hospitals, airports, large hotels** are exactly where **multiple entrances / sub-premises** matter for dispatch narrative — Places tends to respect the selected POI; pure address geocoding often lands on **street segment or building envelope**.
- **Operational impact:** Distance is used for **pricing tiers and VAT thresholds**, not turn-by-turn navigation in this product. A shift of **hundreds of metres to a few kilometres** is plausible between POI geometry and Geocoding centroid **for difficult venues** — enough to move invoices or tax bands at thresholds.

### Maximum observed delta (Place Details vs Geocode)

**Not measured** in this repository: there is **no** regression fixture or logged comparison between `/api/place-details` output and `/api/geocode-address` for the same logical address. Any numeric “max delta” would require **production sampling or a dedicated measurement script**. Honest answer: **unknown until instrumented**.

### Pros / cons (German taxi — correctness & ops)

| | |
|--|--|
| **Pros** | **(1)** One conceptual pipeline (structured → Geocoding API) may reduce **lat/lng jitter between bulk/cron and form** if everyone trusts the **same string normalisation + same API**. **(2)** Geocoding SKU is often **simpler to budget** than mixing Places Autocomplete + Details + Directions. |
| **Cons** | **(1)** **Correctness risk** at POIs: replacing POI-anchored coordinates with **street geocodes** can systematically shift routes (wrong distance, wrong threshold). **(2)** **Address-string drift** still breaks determinism unless you enforce **strict canonical formatting** (abbreviations, ß/ss, “Str.” vs “Straße”) — otherwise “same” stops are still different inputs to Geocoding. |

---

## Option B — Unify on Place ID + Place Details

### Schema: `recurring_rules` and Place IDs

From **`src/types/database.types.ts`** (`recurring_rules.Row`), columns include **`pickup_address`** and **`dropoff_address`** (strings) and **do not include `place_id`, `pickup_place_id`, or stored lat/lng** on the rule row.

So today:

- **Option B “store Place ID on the rule at creation”** is **not** supported without a **schema migration** (new nullable columns or a side table).
- **Cron** currently geocodes **free-text lines** with **`geocodeAddressLineToStructured`** (`generate-recurring-trips/route.ts` pattern). There is **no** persisted Place ID to reuse on each run.

### Feasibility of resolving Place ID for cron without storing it

- You could **Find Place / Text Search** (Places) per cron leg using `pickup_address` / `dropoff_address` — **feasible but fragile**: ambiguous strings, multiple matches, extra latency and **billable Places requests every generation window**.
- **Storing Place ID on the rule** (after migration + admin UI to pick a place once) avoids repeated ambiguity — **strong fit for Option B**, but **requires product + schema work**.

### API cost

Exact cost depends on **Google Maps Platform SKUs**, **monthly trip/rule volumes**, and whether you use **Places Autocomplete (per session)**, **Places Details**, **Geocoding**, etc. This codebase does **not** centralise billing telemetry. **Qualitative:** Places **Details** (New) and **Autocomplete** are typically **priced differently** than **Geocoding**; mixing fewer Products sounds cheaper only if you **reduce total request count** — forcing Details on every bulk/cron row could **increase** cost versus cheap Geocoding calls unless you cache aggressively.

### Pros / cons

| | |
|--|--|
| **Pros** | **(1)** **Semantic correctness** for venues: one chosen POI → stable geometry for distance and dispatch narrative. **(2)** Aligns **manual entry** (already Places-driven) with **server paths** if those paths also resolve to **the same Place**. |
| **Cons** | **(1)** **No current rule-level Place ID** — migration + UI + backfill policy required. **(2)** **Operational complexity:** ambiguous text addresses in CSV/rules may **not** resolve to a unique Place without human confirmation — risk of **silent wrong POI** or **failed** automation. |

---

## Option C — Cache keyed by normalised address hash (coordinates unchanged)

### Schema / DDL

- **`route_metrics_cache`** today is **`UNIQUE (company_id, origin_lat, origin_lng, dest_lat, dest_lng)`** with coords at **`decimal(8,5)`** (`20260417100000_route-metrics-cache.sql`).
- Adding **`origin_address_hash`**, **`dest_address_hash`** (or a single **`route_pair_hash`**) is **straightforward in Postgres**: new migration, nullable columns for back-compat, new **partial unique index** where hashes **IS NOT NULL**, **plus** careful **upsert** semantics so coord-key and hash-key do not fork truth.

### Normalisation pitfalls (German addresses)

- Trip rows store **separate** `street`, `street_number`, `zip_code`, `city` plus a **composed** `pickup_address` / `dropoff_address`. Bulk vs form **compose strings differently** (`bulk-upload-dialog.tsx` builds display lines from parts). **`musterstraße` vs `Musterstraße`**, **`str.` vs `Straße`**, **Unicode normalisation**, **leading zeros in PLZ**, **duplicate whitespace** — all change naive hashes.
- **Risk:** aggressive normalisation **merges two distinct destinations** (same street name, different cities if city omitted from hash); conservative normalisation **fails to merge** jitter that Option C is meant to fix.

### Collision risk

- **Cryptographic hash collisions** (SHA-256, etc.) on canonical strings are **negligible**.
- The realistic failure mode is **semantic collision**: **two different trips normalise to the same key** — not SHA collision but **bad normalisation**. That yields **wrong reused distance** — **silent** and **dangerous** for audits.

### Fallback when hash is null

- **Historical cache rows** without hashes: **fallback to coordinate-key lookup** is **exactly today’s behaviour** — safe **if** new logic never writes **only** hash without filling coords. Prefer **one authoritative distance per attempt**: hash hit → use stored distance; miss → Directions → **upsert both** coord-key and hash-key (if defined) to avoid drift between keys.

### Pros / cons

| | |
|--|--|
| **Pros** | **(1)** Fixes **invoice-visible inconsistency** without forcing every team to abandon Places or Geocoding — **decouples “distance identity” from coordinate jitter**. **(2)** Can roll out **incrementally**: new writes populate hashes; old rows still work on coords. |
| **Cons** | **(1)** **Wrong-merge risk** if normalisation is sloppy (same hash, different physical stops). **(2)** **Two keys** (hash + coords) require **discipline**: conflicting distances if updates are inconsistent — ops must monitor. |

---

## Cross-cutting comparison (requested structure)

### Top 2 pros / cons per option

**Option A**

- Pros: single geocoder story; may align bulk/cron/form **if** strings are canonical.
- Cons: **loss of POI fidelity** vs Places; **string canonicalisation** still hard.

**Option B**

- Pros: **best semantic match** for named venues; aligns with current **form** mental model.
- Cons: **schema + UX gap** for rules; **ambiguous strings**; potential **cost / complexity** for batch Places resolution.

**Option C**

- Pros: targets **the cache miss** directly; **minimal disruption** to existing geocoders.
- Cons: **normalisation bugs** become **silent revenue/legal risk**; **two-key** maintenance.

---

## Recommendation (direct)

**Prefer a hybrid centred on Option C for “same route → same distance,” combined with tighter **endpoint identity** where you already have it — **not** a wholesale rip-out of Places for Option A.

**Why:** Your stated failure mode is **`route_metrics_cache` fragmentation**, not necessarily “wrong geocoder everywhere.” Option C attacks **that** without forcing every cron/bulk row through Places (expensive, ambiguous) or stripping POI precision from the form (Option A’s main correctness downside).

**Boundary for the hybrid:**

- **`route_metrics_cache` lookups and writes:** primary key should include a **deterministic `route_pair_hash`** built from **company-scoped, normalised structured fields** (and optionally **Place ID when present**), **before** or **alongside** coord-rounding.
- **Trip rows:** keep storing **whatever geometry your UX chose** (Places vs Geocoding) for map/display; **distance** comes from the **canonical cache branch** keyed by hash + fallback coords so invoices stabilise.
- **Optional later:** add **`pickup_place_id` / `dropoff_place_id`** on `trips` (and eventually `recurring_rules`) when product wants **Option B-style** identity without re-geocoding text every time — **schema change**, not required for first stabilisation if hash logic is careful.

**Single biggest silent regression risk (recommended hybrid):** **False sharing** — two different real-world routes collapse to the **same normalised hash** (missing city in hash, wrong abbreviation expansion, inconsistent CSV vs form strings), so **everyone gets the same cached kilometres** — consistent but **consistently wrong**, including across invoice periods.

---

## Answers tied to codebase facts

| Question | Answer |
|----------|--------|
| Does `recurring_rules` store `place_id` or rule-level coordinates? | **`No`** — only **`pickup_address`** / **`dropoff_address`** strings (see `database.types.ts`). Option B **without migration** cannot persist Place IDs on rules. |
| Does the form store structured fields? | **Yes**, when the user selects via Autocomplete and Place Details runs — **`street`, `street_number`, `zip_code`, `city`, `lat`, `lng`**, optional **`placeId`** in UI types (`address-autocomplete.tsx`, `create-trip-form.tsx`). |
| Observed max delta Place vs Geocode? | **Not in repo** — requires measurement. |

---

## Senior-level closing note

Unifying **only** on Geocoding (Option A) trades **dispatch and invoicing truth** for **string determinism** — often a bad swap for German healthcare transport where **the correct building** matters. Unifying **only** on Places everywhere (Option B) is **product- and schema-heavy** while **`recurring_rules` remains text-only**. **Option C**, done with **conservative normalisation**, **company scope**, and **Place ID when available**, targets the actual inconsistency mechanism with less UX violence — provided you invest in **tests around normalisation edge cases** and **monitoring for hash collisions in business terms** (not SHA collisions).

---

## Structured Field Consistency Audit

**Naming:** The database uses **`pickup_zip_code`** / **`dropoff_zip_code`** (underscore), not `pickup_zipcode`.

### 1. Manual create form (Places Autocomplete + Place Details)

**Insert payload** maps address groups to columns such as `pickup_street`, `pickup_street_number`, `pickup_zip_code`, `pickup_city` (`create-trip-form.tsx`, e.g. anonymous outbound ~1371–1374, passenger outbound ~1525–1528).

**After selection with `placeId`:** `AddressAutocomplete.handleSelect` calls **`GET /api/place-details`**, merges **`details.lat` / `details.lng`**, **`details.zip_code`**, **`details.street`**, **`details.street_number`**, **`details.city`** into the `AddressResult` (~239–262 in `address-autocomplete.tsx`). **`street`** is merged as `details.street || result.street`; **`street_number`** comes **only from Place Details** (`mergedStreetNumber = details.street_number`).

**Is `pickup_street_number` always present?** **No.** If the Places response has **no `street_number` component**, `details.street_number` is omitted → the merged result may have **`street_number` undefined**, which becomes **`pickup_street_number: pickupGroup.street_number || null`** → **`null`** on insert.

**Named establishment (e.g. Klinikum):** Suggestions can carry **`name`** (establishment row). Place Details still fills **`route`** and **`street_number`** when Google exposes them (`place-details/route.ts` ~113–119). Where **`route` is missing**, `street` may be **undefined** unless carried over from **`result.street`** from autocomplete — **establishments may still end up with sparse `street` / null `street_number`**, while **`pickup_address`** is rebuilt via `formatTripAddressDisplayLine` including **`placeName`** so the **display line can describe the venue** even when structured street fields are thin.

### 2. CSV bulk upload (`/api/geocode-address`)

**`/api/geocode-address`** calls **`geocodeStructuredAddressToLatLng`**, which returns **`lat`, `lng`, `zip_code`, `city` only** — it does **not** return **`street` or `street_number`** parsed back from Google (`google-geocoding.ts` ~239–244).

**What bulk upload writes:** It assigns **`pickup_lat` / `pickup_lng`** (and dropoff) from the JSON, and **conditionally** overwrites **`pickup_zip_code` / `pickup_city`** (and dropoff) **when** the response includes `zip_code` / `city` (`bulk-upload-dialog.tsx` ~1158–1192). **`pickup_street`, `pickup_street_number`** (and dropoff counterparts) **stay whatever the CSV parser put on `row.trip`** — they are **not** replaced by the geocoder’s structured parsing.

**Same column names as the form?** **Yes** (`pickup_street`, `pickup_street_number`, `pickup_zip_code`, `pickup_city`). **Population logic is not the same:** form = Places Details components; bulk = **CSV source + optional zip/city refinement from forward geocode**, **never** street refresh from that API response.

### 3. Recurring cron (`geocodeAddressLineToStructured`)

**Generated trip rows** set structured fields directly from **`GeocodedAddressLineResult`**:  
`pickup_street: pickupGeo?.street ?? null`, `pickup_street_number: pickupGeo?.street_number ?? null`, `pickup_zip_code: pickupGeo?.zip_code ?? null`, `pickup_city: pickupGeo?.city ?? null` (and mirrored for dropoff) (`generate-recurring-trips/route.ts` ~291–305).

**`pickup_street_number`:** Populated from Geocoding API **`address_components`** when a **`street_number`** type exists (`google-geocoding.ts` ~90–93); otherwise **`null`**.

**Source text:** **`recurring_rules.pickup_address` / `dropoff_address`** strings (plus exceptions), not structured CSV — so parsing quality follows **that free-text line**.

### 4. Trip detail sheet edit (`build-trip-details-patch.ts`)

When pickup **display text** changes vs DB (`normalizeNotes` compare ~122–124), the PATCH sets **`pickup_address`** from the draft and:

- **`pickup_street`** = `lastPickupResolved?.street ?? trip.pickup_street`
- **`pickup_street_number`** = `lastPickupResolved?.street_number ?? trip.pickup_street_number`
- **`pickup_zip_code`** = `lastPickupResolved?.zip_code ?? trip.pickup_zip_code`
- **`pickup_city`** = `lastPickupResolved?.city ?? trip.pickup_city`
- **`pickup_lat` / `pickup_lng`** only if resolver returned numbers (~132–135)

**Can `pickup_address` update while structured fields stay old?** **Yes.** If the dispatcher changes the **free-text line** such that the block runs, but **`lastPickupResolved` is missing or lacks structured fields** (e.g. no fresh Place Details pass), **`r?.street`** etc. fall back to **`trip.pickup_street`** — the **new display string** can be written while **structured columns remain the previous row’s values**. (Same pattern for dropoff ~145–159.)

### 5. `trips` schema nullability

The structured-address migration **`ADD COLUMN`** uses plain **`TEXT`** with **no `NOT NULL`** (`20240316000000_add_structured_addresses_to_trips.sql`). In Postgres, those columns are **nullable**.

**Count:** The eight structured columns **`pickup_street`, `pickup_street_number`, `pickup_zip_code`, `pickup_city`, `dropoff_street`, `dropoff_street_number`, `dropoff_zip_code`, `dropoff_city`** are **all nullable** (no NOT NULL in that migration; **`database.types.ts`** models them as `string | null` on trip rows).

### 6. Assessment: hash `lower(trim(pickup_street)) || pickup_zip || lower(trim(dropoff_street)) || dropoff_zip`

**Stability across write paths:** **Weak.** Bulk rows **never** refresh street from geocode; cron rows come from **line parsing**; the form uses **Places**; detail-sheet can **desynchronise** display vs structured fields. The **same real-world stop** can therefore yield **different `pickup_street` / null handling** across paths — the proposed hash would **not** reliably match.

**False merges:** Omitting **`city`** and **`street_number`** is risky: many municipalities share **street names** under the same PLZ is uncommon but **same PLZ + same street name without Hausnummer** collapses **multiple stops on one road**; omitting city increases collision risk where **address strings are ambiguous**. Omitting normalisation for **ß/ss, abbreviations, “Str.”** worsens cross-path mismatch more than it prevents merges.

**Safer minimal field set (conceptual):** Include **`company_id`** (tenant scope), **`pickup_zip_code`**, **`pickup_city`**, **`pickup_street`**, **`pickup_street_number`**, and the same for dropoff — all **normalised** (case-fold, trim, Unicode NFKC, agreed abbreviation rules). Treat **null `street_number`** explicitly in the canonical string (e.g. sentinel) so **“no number”** does not collide ambiguously. Where available later, **`place_id`** (if stored) dominates text hashing for identity.

**Honest bottom line:** With **current** path inconsistency, a **`route_pair_hash` built only from structured columns on `trips` is not trustworthy until** either **normalisation at write time** converges across paths **or** the hash uses **inputs that are guaranteed stable** (e.g. explicit **`route_identity`** written once from a single resolver).

---

## Phase Approach Review — Senior Recommendation

- **Plan A (distance freeze on invoiced trips)** — Implemented in the trip detail sheet: `invoice_line_items` presence skips Directions for `driving_distance_km` / `driving_duration_seconds` on save (see `docs/driving-metrics-api.md` → **Distance Freeze Guard**).

### Q1 — Trip status and billing state

1. **Exact valid values for `trips.status` (canonical application contract)**  
   **`src/lib/trip-status.ts`** documents the values kept in sync with `trips.status`: **`completed`**, **`assigned`**, **`scheduled`**, **`in_progress`**, **`driving`** (legacy alias for in_progress), **`cancelled`**, **`pending`**, **`open`** (legacy alias for pending) (~31–39).  
   **`database.types.ts`** types **`trips.Row.status` as `string`**, not a string-literal union (~1299) — so the database layer itself does not encode those variants in TypeScript; migrations reviewed did **not** show a **`CHECK`** constraint enumerating trip statuses (invoice **`invoices.status`** is constrained elsewhere to **`draft` \| `sent` \| `paid` \| …**, which is **not** trip status).

2. **Join table / column: “this trip has been added to an invoice”**  
   **`invoice_line_items.trip_id`** — **`UUID`**, nullable for manual lines; **`REFERENCES public.trips(id)`** (`20260331130000_create_invoice_line_items.sql` ~37–40). There is **no** separate `invoice_trips` junction table in the reviewed migrations.

3. **When a trip is billed, does `trips.status` change?**  
   **No dedicated “billed” value exists** in **`TripStatus`** (`trip-status.ts`). Billing / invoice lifecycle is on **`invoices.status`** (draft, sent, paid, … — see invoices migration comments). **`effective-trip-invoice-status.ts`** derives **effective Rechnungsstatus** per trip from **line items joined to invoices**, not from **`trips.status`** (~22–34).

4. **Earliest point at which distance should be treated as “settled”**  
   **There is no single column answering this in schema.** Factually: **`invoice_line_items`** rows snapshot **`distance_km`** (and other fields) at invoice creation (`20260331130000_create_invoice_line_items.sql` ~7–12, ~69–72) — the **PDF/legal** distance is that snapshot, not the live `trips` row. For **operational** “do not change the trip row’s `driving_distance_km`” policy, a reasonable product line is: **as soon as a line item links the trip** (`invoice_line_items.trip_id` = that trip) on an invoice that is **not** voided in a way the product treats as “never issued” — often **any of `draft` / `sent` / `paid`** depending on whether draft builder rows count as “already on a bill.” The codebase’s **badge** logic treats **draft, sent, paid** as active invoice states for effective status (`effective-trip-invoice-status.ts` ~25–33). **Passenger expectation** is a product call; **earliest hard legal anchor** is **after a finalised / sent invoice** in many §14 UStG readings, but that is **not** encoded as a trip status in this app.

### Q2 — Place ID availability

1. **Is `place_id` stored on any table today?**  
   **No matches** for **`place_id`**, **`pickup_place_id`**, or **`dropoff_place_id`** in **`src/types/database.types.ts`** (repo-wide scan on that file).

2. **After Autocomplete + Place Details, is `placeId` always on `AddressResult`?**  
   **`AddressResult`** includes **optional** **`placeId?: string`** (`address-autocomplete.tsx` ~30–44). **Not always present:** if the user selects a suggestion **without** a `placeId`, or **Place Details fails** and the catch path runs **`onChange(result)`** with the pre-details result (~267–269), you may only have the autocomplete payload. Suggestions without a place id can take the branch **`if (result.placeId)`** as false and call **`onChange(result)`** without Details (~273–275).

3. **Does `/api/place-details` return `place_id` in JSON?**  
   **No.** The success JSON is **`{ lat, lng, zip_code, street, street_number, city }`** only (`place-details/route.ts` ~125–132). **`place_id` is not echoed back**; adding it would require a code change to the response shape.

### Part B — Cursor's assessment of the proposed approach

#### Phase 1 complexity

The freeze guard is **conceptually one concern**, but **`buildTripDetailsPatch`** today receives **`trip`** plus drafts/resolvers only — **no invoice linkage** (`trip-detail-sheet.tsx` ~887–910). To gate on “already invoiced,” callers must **either** enrich **`trip`** (or parallel flags) with **`exists invoice_line_items for trip_id`** via a **Supabase query before patch build**, **or** move the guard to **`applyDetailsPatch`** / the sheet layer where data is loaded. That is **still small**, but **not** strictly “one boolean inside `build-trip-details-patch.ts`” unless **`trip`** is extended.

**Additional surface:** Paired **`finalizePartnerPatchWithDrivingMetrics`** (`paired-trip-sync.ts`) can still inject **`driving_distance_km`** on the partner row — Phase 1 must cover **that path**, not only the primary PATCH builder.

**Policy nuance:** Blocking distance updates for **`draft`** invoices may strand corrections while fixing passenger-visible drift; blocking **only `sent`/`paid`** vs **any line item** is a product/legal choice not dictated by code.

#### Phase 2a complexity

Adding **nullable `TEXT`** **`pickup_place_id` / `dropoff_place_id`** on **`trips`** is a **standard migration** pattern matching existing nullable columns. **No evidence** in reviewed migrations that **`trips` RLS** enumerates column lists (typically column-agnostic `UPDATE`). Types/regenerated **`Database`** will need updating. **Risk:** flows that **never** set IDs (**bulk, cron, CSV**) keep **`NULL`** — cache logic must **branch**: Place-ID key **if both present**, else coord/hash fallback — otherwise Phase 2a **does not help** those trips.

#### Phase 2b complexity

Storing **resolved coordinates on `recurring_rules`** **does** stabilise cron-generated trips relative to **today’s per-run geocode**. **Alternative without schema:** cron could **reuse the last generated trip’s coords for the same `rule_id`** (lookup latest `trips` row where **`rule_id`** matches) — **no migration**, but **bootstrap problem** on first run and **bad coords propagate** if the first trip was wrong. Rule-level storage is **cleaner** if admins edit addresses deliberately.

**Cron today** does **not** reuse prior trip coordinates from code inspected earlier — it **geocodes address lines each payload build**. Whether **any** helper loads historical trips for coords would need a dedicated search; the **default architecture** is **fresh geocode per generation**.

#### Remaining gaps after both phases

Even after Phase **1 + 2**, **`driving_distance_km` can still differ** across:

- **Bulk upload / manual free-text / duplication / backfill / linked-return** paths that **never** write Place IDs.

- **Coordinate-keyed cache** for trips **without** both Place IDs — **jitter remains** unless addressed separately.

- **`fetchDrivingMetrics` / bulk / detail sheet** routes that **still** compute metrics independently — **Phase 2a** only aligns **cache** when IDs exist.

- **detail-sheet structured-field drift** (address display vs columns) — **not** solved by Place ID columns alone.

#### Senior recommendation

**Implement Phase 1 first**, but **scope it deliberately**: enrich the detail-sheet save path with **invoice awareness** (whether **`invoice_line_items`** exists for this **`trip.id`**, and which **`invoices.status`** values trigger freeze) and apply the **same rule** to **paired partner metrics**. Define explicitly whether **draft** invoices freeze distance — do not assume **`trips.status`** alone.

**Phase 2:** **2a (persist Place IDs on trip)** is **reasonable** as an incremental stabiliser **for form-created trips**, provided **`place-details`** also returns **`place_id`** for echo/storage **or** the client stores the **same id** already held before Details. **Do not** claim it fixes **all** routes until bulk/cron adopt IDs or another key.

**Phase 2b** on **`recurring_rules`** is **sound** if recurring volume matters more than migration cost; **lighter alternative** is **“reuse last trip coords by `rule_id`”** without schema — **pick based on ops tolerance for bootstrap edge cases**.

**If the product stage is early:** ship **Phase 1 + minimal observability** (log when distance would have changed but was blocked) **before** large **`route_metrics_cache`** redesign — **stop silent regression first**, then iterate on identity keys.
