# Trip detail sheet: in-sheet editing

## Location

- **Implementation:** [`src/features/trips/trip-detail-sheet/`](../src/features/trips/trip-detail-sheet/) — orchestrator [`trip-detail-sheet.tsx`](../src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx), callouts, dialogs, refresh hook, and **paired-leg sync** (see below).
- **Re-export (stable import path):** [`src/features/overview/components/trip-detail-sheet.tsx`](../src/features/overview/components/trip-detail-sheet.tsx) re-exports from the feature module.

### Billing: Anrufstation & Betreuer

When the selected Unterart’s family has `askCallingStationAndBetreuer`, or the trip already has `billing_calling_station` / `billing_betreuer`, the **header** (below date/time) shows two optional fields. They map to `trips.billing_*` columns — not Fahrgast `pickup_station` / `dropoff_station`. Saves go through [`build-trip-details-patch.ts`](../src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts). With a linked Gegenfahrt, **Trip aktualisieren** can mirror both columns to the partner via [`PAIRED_SYNC_COLUMN_KEYS`](../src/features/trips/trip-detail-sheet/lib/paired-trip-sync.ts) / [`buildPartnerSyncPatchFromDrafts`](../src/features/trips/trip-detail-sheet/lib/paired-trip-sync.ts) (same values on both legs, no route swap).

## Layout

The sheet keeps the **original** structure: header (Kunde with **Rollstuhl** switch beside the name, status badges including **Kopie** when `ingestion_source === 'trip_duplicate'`, **Datum** + **Uhrzeit**, optional **Anrufstation** / **Betreuer** when applicable), **TripSheetTopCallouts** (verknüpfte Fahrt + Gruppe), **Route & Verlauf** timeline (with expandable address edit where applicable), then the compact **two-column** details grid (`Fahrer` full width, `Kostenträger`, `Abrechnung`, `Kontakt`). Edits use the same grid and typography as before; footer action **Trip aktualisieren** when anything in the sheet is dirty (including header date/time), plus **Aktionen** (Duplizieren, Verschieben) and **Fahrt stornieren**.

## Behaviour

### Duplizieren (Aktionen)

**Duplizieren** erzeugt **neue** `trips`-Zeilen (INSERT) auf einem gewählten Kalendertag, mit `rule_id` geleert und `ingestion_source = 'trip_duplicate'` — es ist **kein** Verschieben der bestehenden Zeile.

| Aktion | Was passiert |
|--------|----------------|
| **Duplizieren** | Kopie(n); optional die **verknüpfte Gegenfahrt** mitkopieren (Checkbox im Dialog). Bei **Hin+Rück** und „Neue Uhrzeit wählen“: zwei Felder (Hinfahrt / Rückfahrt), unabhängig und optional leer (`explicitPerLegUnifiedTimes`). Vollständige Regeln, `includeLinkedLeg`, Payload: [trips-duplicate.md](./trips-duplicate.md). |
| **Verschieben** | **UPDATE** von `scheduled_at` / `requested_date` auf derselben Zeile (und ggf. Partner); nur nicht-wiederkehrende Fahrten, andere Eligibility: [trip-reschedule-v1.md](./trip-reschedule-v1.md). |
| **Rückfahrt** (Button) | Legt eine **neue** Rückfahrt an und **verknüpft** sie mit der geöffneten Hinfahrt — anderes Produktziel als „Kopie auf anderem Tag“. |
| **Datum/Uhrzeit** (Header) | Inline bearbeiten; Speichern über dieselbe Fußzeile **Trip aktualisieren** wie Kostenträger/Route (PATCH inkl. reiner Uhrzeit am gleichen Tag). |

Nach erfolgreichem Duplizieren springt das Blatt auf die **neue** Fahrt (sofern der Parent `onNavigateToTrip` setzt).

### Standalone row

By default, edits apply **only** to the opened `trips.id`. Other rows sharing `group_id` are **not** updated automatically.

### Verknüpfte Gegenfahrt: Spiegeln auf die Gegenfahrt (Hin/Rück)

**Problem.** A linked return is a **second** row in `trips`, tied via `linked_trip_id` / `link_type`. A normal save issues `updateTrip` for the **current** row only. After dispatch changes passenger data, Rollstuhl, Kostenträger, billing, notes, **addresses**, **stations**, or other route fields on one leg, the other leg would otherwise stay out of sync—despite new returns being created with reversed route + shared Stammdaten (see [`buildReturnTripInsert`](../src/features/trips/lib/build-return-trip-insert.ts)).

**Design.** When a linked partner exists (`findPairedTrip` / `linkedPartner` in the sheet) and the pending save touches any field in [`PAIRED_SYNC_COLUMN_KEYS`](../src/features/trips/trip-detail-sheet/lib/paired-trip-sync.ts)—or when notes differ and the user saves notes—the UI asks whether to apply changes **only to this row** or to **this row and the linked Gegenfahrt**.

**What is mirrored when the user chooses “Diese Fahrt + Gegenfahrt”.**

- **Stammdaten / Abrechnung / Hinweise:** Same values as on the open trip: `client_id`, `client_name`, `client_phone`, `is_wheelchair`, `payer_id`, `billing_variant_id`, `billing_calling_station`, `billing_betreuer`, `notes` (merged from the notes textarea when that flow runs with dirty notes).
- **Route on the partner leg** uses the same **endpoint swap** as [`swapRouteEndpoints`](../src/features/trips/lib/build-return-trip-insert.ts) / a new Rückfahrt: this leg’s **dropoff** drafts (address, structured fields, coordinates, `dropoff_location`) become the partner’s **pickup** side; this leg’s **pickup** drafts become the partner’s **dropoff** side. **Stations** follow the same swap: partner `pickup_station` ← this leg’s dropoff station draft, partner `dropoff_station` ← this leg’s pickup station draft.
- **Driving metrics** on the partner row (`driving_distance_km`, `driving_duration_seconds`) are recomputed via Google Directions when all four coordinates are present ([`finalizePartnerPatchWithDrivingMetrics`](../src/features/trips/trip-detail-sheet/lib/paired-trip-sync.ts)).

**Not mirrored** (each leg stays independent): **date/time** (`scheduled_at` / `requested_date` are not paired keys), **driver**, and other columns outside the allowlist.

**Dialog order (critical).** If the trip belongs to a recurring series (`rule_id`), [`RecurringTripEditScopeDialog`](../src/features/trips/trip-detail-sheet/dialogs/recurring-trip-edit-scope-dialog.tsx) runs **first**. Only after the user chooses **Nur diese Fahrt** (materialized occurrence) may [`PairedTripSyncDialog`](../src/features/trips/trip-detail-sheet/dialogs/paired-trip-sync-dialog.tsx) appear. The two modals are **never** open at the same time.

**Trip aktualisieren.** The PATCH for the open row is built in [`build-trip-details-patch.ts`](../src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts) (route, date, metrics, client, billing, etc.). Eligibility for the paired prompt is computed in [`paired-trip-sync.ts`](../src/features/trips/trip-detail-sheet/lib/paired-trip-sync.ts) (any key in `PAIRED_SYNC_COLUMN_KEYS` present in the built patch **or** dirty notes). If the user chooses **Diese Fahrt + Gegenfahrt**, the current row is updated first; then [`buildPartnerSyncPatchFromDrafts`](../src/features/trips/trip-detail-sheet/lib/paired-trip-sync.ts) builds the partner payload from **current form drafts + trip fallbacks**, then driving metrics are applied; then the second `updateTrip` runs. If the user also had unsaved note edits, notes are merged onto **both** rows in that flow.

**Notizen (separate Speichern).** The notes block can trigger the same paired dialog (**notes** variant) so a notes-only save can still align both legs (notes only on that path unless the user later saves details with full paired sync).

**Failure behaviour.** If the first `updateTrip` succeeds and the second fails, the error is shown to the user; there is **no** automatic compensating rollback of the first write.

### Group hint

When `group_id` is set, [`TripSheetTopCallouts`](../src/features/trips/trip-detail-sheet/components/trip-sheet-top-callouts.tsx) shows [`GroupedTripHint`](../src/features/trips/trip-detail-sheet/components/grouped-trip-hint.tsx) in the **same scroll slot** as the linked-partner strip (above “Route & Verlauf”).

### Recurring series (`rule_id`)

Before persisting changes (including the path that leads to the paired dialog), `RecurringTripEditScopeDialog` asks **Nur diese Fahrt** vs **Gesamte Serie**. The single-row path runs `tripsService.updateTrip` on the current row only. **Gesamte Serie** currently routes users to adjust the recurring rule in the client profile (toast), until a dedicated series-update API exists. Choosing **Gesamte Serie** does **not** run paired sync.

### Refreshing after saves

[`useTripDetailSaveRefresh`](../src/features/trips/trip-detail-sheet/hooks/use-trip-detail-save-refresh.ts) mirrors [`useTripCancellation`](../src/features/trips/hooks/use-trip-cancellation.ts): on the Fahrten route, `refreshTripsPage()`; elsewhere, `router.refresh()` + `invalidateQueries(tripKeys.all)`. After a paired save, the partner trip’s detail query is invalidated explicitly as well. See [trips-page-rsc-refresh.md](trips-page-rsc-refresh.md) and [server-state-query.md](server-state-query.md).

## File map (paired sync)

| File                                                                                                                 | Role                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`lib/build-trip-details-patch.ts`](../src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts)         | Builds the full `PATCH` for **one** trip from drafts (including driving metrics).                                                                                                                                             |
| [`lib/paired-trip-sync.ts`](../src/features/trips/trip-detail-sheet/lib/paired-trip-sync.ts)                         | `PAIRED_SYNC_COLUMN_KEYS` (dialog eligibility + mirrored columns), `buildPartnerSyncPatchFromDrafts` (swapped route + Stammdaten from drafts), `finalizePartnerPatchWithDrivingMetrics`, helpers for when to show the dialog. |
| [`dialogs/paired-trip-sync-dialog.tsx`](../src/features/trips/trip-detail-sheet/dialogs/paired-trip-sync-dialog.tsx) | User confirmation: **Nur diese Fahrt** vs **Diese Fahrt + Gegenfahrt** (details or notes variant).                                                                                                                            |

## Related

- [trips-duplicate.md](trips-duplicate.md) — Duplizieren aus Liste und Detail-Blatt, `includeLinkedLeg`, `explicitPerLegUnifiedTimes`, „Kopie“-Badge.
- [trips-rueckfahrt-detail-sheet.md](trips-rueckfahrt-detail-sheet.md) — creating a linked return from the sheet (create-time symmetry with `buildReturnTripInsert`).
- [trip-linking-and-cancellation.md](trip-linking-and-cancellation.md) — pairing and cancel flows.
- [`findPairedTrip`](../src/features/trips/api/recurring-exceptions.actions.ts) — resolves the other leg for cancel/navigation; paired sync reuses the same partner concept.
