# Audit: Address Recalculation Flow

## 1. Where does driving distance get written?
- **Finding:** Driving distance (`driving_distance_km`) is computed **client-side** within the patch builder (`src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts`). 
- **Mechanism:** When building the PATCH payload, if `wouldRecomputeDrivingMetrics` evaluates to `true`, `fetchDrivingMetrics` (Google Directions API call) is invoked. The resulting distance and duration are then explicitly appended to the PATCH payload. A similar process occurs in `finalizePartnerPatchWithDrivingMetrics` (in `src/features/trips/trip-detail-sheet/lib/paired-trip-sync.ts`) for linked return trips.
- **Dependency:** It requires both pickup and dropoff coordinates (`lat` and `lng`) to be present and numeric.

## 2. Where does `grossprice` get computed?
- **Finding:** `grossprice` is computed **server-side**, specifically within the trip update endpoints (e.g., `src/features/trips/api/trips.service.ts`).
- **Mechanism:** Before executing a Supabase update, the backend invokes `shouldRecalculatePrice(patch)` (defined in `src/features/trips/lib/trip-price-engine.ts`). If this returns `true`, it calls `computeTripPrice` to recalculate the price.
- **Dependency:** `shouldRecalculatePrice` returns `true` only if the incoming PATCH contains specific pricing-relevant fields, such as `driving_distance_km`, `pickup_lat`, `dropoff_lat`, etc. It **does not** check for `pickup_address` or `dropoff_address`. Thus, the server only recalculates the price if the client patch explicitly includes updated coordinates or a new distance.

## 3. What does `AddressResult` contain?
- **Finding:** `AddressResult` contains: `address` (string), `name`, `street`, `street_number`, `zip_code`, `city`, `lat` (number), `lng` (number), `distance`, and `placeId`.
- **Mechanism:** In `AddressAutocomplete`, when a user types a free-text address without selecting a suggestion, the `onChange` handler fires with `{ address: e.target.value }`. This object is technically an `AddressResult`, but `lat` and `lng` are `undefined`.
- **Gap Identified:** In `trip-detail-sheet.tsx`, the `onChange` handler for the autocomplete stores this un-geocoded object into `lastPickupResolved.current`. Since it's an object (not a string), the condition `typeof result === 'string'` bypasses, but `lastPickupResolved.current` ends up lacking coordinates.

## 4. Is `lastPickupResolved` / `lastDropoffResolved` the only path for providing coordinates to the patch builder?
- **Finding:** Yes. `buildTripDetailsPatch` solely relies on `input.lastPickupResolved` and `input.lastDropoffResolved` to inject `pickup_lat` and `pickup_lng` into the PATCH payload.
- **Gap Identified:** If `r?.lat` and `r?.lng` are not numbers (e.g., typed manually without autocomplete), the patch builder completely skips setting `patch.pickup_lat` and `patch.pickup_lng`. Because `patch.pickup_lat` and `patch.dropoff_lat` are `undefined`, `wouldRecomputeDrivingMetrics` evaluates to `false`. Consequently, distance recalculation is silently skipped, and because neither coordinates nor distance are included in the patch, the server-side `shouldRecalculatePrice` also evaluates to `false`, leaving the price unupdated.

## 5. What is the `isDistanceLocked` guard doing?
- **Finding:** The `isDistanceLocked` boolean prevents modifying `driving_distance_km` and `driving_duration_seconds` if the trip has already been invoiced (i.e., it has an associated invoice line item).
- **Mechanism:** If `isDistanceLocked` is `true`, `fetchDrivingMetrics` is bypassed, and the distance/duration keys are forcibly deleted from the patch.
- **Intention:** This intentionally suppresses distance (and subsequently price) recalculations to keep the trip data aligned with finalized billing snapshots. 

## 6. Minimal Safest Fix & Risks
**The Fix:**
In `src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts`, when `pickup_address` or `dropoff_address` changes, we must explicitly set `lat`, `lng`, and `driving_distance_km` to `null` if the resolved result lacks coordinates.

```typescript
  if (normalizeNotes(input.pickupAddressDraft) !== normalizeNotes(trip.pickup_address ?? '')) {
    const r = input.lastPickupResolved;
    patch.pickup_address = input.pickupAddressDraft || '';
    
    if (typeof r?.lat === 'number' && typeof r?.lng === 'number') {
      patch.pickup_lat = r.lat;
      patch.pickup_lng = r.lng;
    } else {
      // FIX: Explicitly nullify coordinates when manually typed
      patch.pickup_lat = null;
      patch.pickup_lng = null;
    }
  }
```
*Note: Apply the same logic for `dropoff_address`.*

By explicitly including `patch.pickup_lat = null` (or dropoff), the patch will contain the `pickup_lat` key. This will cause `shouldRecalculatePrice` to return `true` on the server, triggering a price recalculation (likely falling back to a flat rate or nulling the distance-based price, which is correct for an un-geocoded address). Furthermore, `wouldRecomputeDrivingMetrics` will evaluate to `true` (since `patch.pickup_lat !== undefined`), and while `fetchDrivingMetrics` might fail or skip due to null coordinates, it ensures we don't hold onto stale distance metrics for a newly typed address. We should also explicitly set `patch.driving_distance_km = null` if we nullified the coordinates so the old distance is cleared.

**Risks & Edge Cases:**
1. **Distance API Skip:** If `fetchDrivingMetrics` requires numbers, passing `null` will skip it, resulting in the patch carrying `driving_distance_km: null`. This is mathematically correct since we don't know the distance, but the user interface will show "Geplant" or "-" for distance and price.
2. **`isDistanceLocked`:** If the distance is locked, we probably shouldn't nullify the coordinates or distance either, or we need to ensure the admin override intentionally breaks the lock. Currently, `isDistanceLocked` deletes `driving_distance_km` from the patch, meaning price might still recalculate if `pickup_lat` is in the patch. The server might recalculate the price using the old distance if it falls back to DB values, or it might wipe the price. This needs careful testing to ensure invoiced trips don't get their prices wiped if an address is tweaked.

## Resolution
The fix was implemented in `src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts`.
- **Lines ~164-173 (Pickup)** and **Lines ~187-196 (Dropoff)**: An `else if (!isDistanceLocked)` block was added after the check for valid coordinates `r?.lat` and `r?.lng`.
- **Why**: When an address is updated by typing (no autocomplete used), the coordinates are now explicitly set to `null` instead of being silently skipped, along with `driving_distance_km` and `driving_duration_seconds`. This guarantees the `patch` object includes these keys, forcing `shouldRecalculatePrice` to return `true` on the server and triggering a price calculation engine rerun.
- **Guard**: The logic is wrapped in `!isDistanceLocked` to prevent wiping the distance and recalculating the price of an already invoiced trip (where `isDistanceLocked` is `true`). In this case, the stale coordinates remain in place, which is the expected behaviour when tweaking the label of a locked trip.
