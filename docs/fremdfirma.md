# Fremdfirma (externe Durchführung)

## Überblick

Fahrten können einer **Fremdfirma** zugewiesen werden (Partner-Stammdaten unter **Account → Fremdfirmen**). Die Kostenträger- und Abrechnungslogik bei TaxiGo bleibt bestehen; die Durchführung liegt extern.

## Datenmodell

- `fremdfirmen`: Stammdaten inkl. Standard-Abrechnungsart (`default_payment_mode`).
- `trips.fremdfirma_id`, `fremdfirma_payment_mode`, `fremdfirma_cost`.
- `recurring_rules`: dieselben Spiegel-Felder wie bei KTS — der Cron übernimmt sie auf generierte Fahrten (siehe `generate-recurring-trips`). Einzelne Termine können danach in der Fahrtmaske überschrieben werden.

## UI

- **Neue Fahrt:** Kein Fremdfirma-Block — die Zuweisung erfolgt erst später (typisch im **Fahrt-Detail**), wenn der Partner bekannt ist.
- **Fahrt-Detail:** Block „Fremdfirma“ inkl. Partner, Abrechnungsart und ggf. Betrag; bei gesetzter Fremdfirma entfällt die Fahrerzuweisung dort, der Status folgt der Fremdfirma-Logik (`trip-status`, siehe `docs/trip-status-helper.md`).
- **Wiederkehrende Regel:** Gleiche Felder wie in der Fahrtmaske; Speichern schreibt die Regel-Spalten.
- **Fahrten-Liste (Desktop-Tabelle,** [`columns.tsx`](../src/features/trips/components/trips-tables/columns.tsx)**):**
  - **Fremdfirma** — Partnername aus dem Embed `fremdfirma:fremdfirmen(…)`; „—“ wenn keine Fremdfirma.
  - **Abrechnung Fremdfirma** — `Badge` für `trips.fremdfirma_payment_mode` (deutsche Kurzlabels, zentral in [`fremdfirma-payment-mode-labels.ts`](../src/features/fremdfirmen/lib/fremdfirma-payment-mode-labels.ts)); Tooltip „Abrechnung Fremdfirma: …“; „—“ ohne Fremdfirma.
  - **Fahrer** — bei gesetzter Fremdfirma kein Dropdown, sondern zentrierter Text **„Extern · {Name}“** ([`driver-select-cell.tsx`](../src/features/trips/components/trips-tables/driver-select-cell.tsx)); die Abrechnungsart erscheint **nur** in der Spalte **Abrechnung Fremdfirma** (nicht mehr unter dem Fahrer).
  - Die Zellen dieser drei Spalten sind **inhaltlich zentriert** (`flex justify-center` im Column-`cell`).
- **Schmale Ansicht** (`TripsMobileCardList`): keine separaten Fremdfirma-Spalten — nur die Desktop-Datentabelle.

## Cron

In `buildTripPayload` werden `no_invoice_*` und `fremdfirma_*` aus der Regel gesetzt. Bei gesetzter `fremdfirma_id`: `driver_id = null`, `needs_driver_assignment = false`, `status = assigned`.
