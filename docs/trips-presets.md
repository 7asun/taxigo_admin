# Fahrten — gespeicherte Ansichten (Trip-Presets)

## Zweck

**Ansichten** speichern die **Kombination** aus Tabellenfiltern (URL-Suchparameter), **sichtbaren Spalten** (TanStack `columnVisibility`), und **Spaltenreihenfolge** (`column_order`) pro Firma (`trip_presets`, RLS nach `company`).

## Payload

- **`params`**: Objekt mit erlaubten Schlüsseln (`TripPresetParams` / Whitelist in `isTripPresetParamKey`). **`page`** und **`perPage`** sind ausgeschlossen; beim Anwenden wird **`page=1`** gesetzt, **`perPage`** wird nur gesetzt, wenn das Preset ihn explizit enthält (aktuell: typischerweise weggelassen, nuqs-Defaults greifen).
- **`column_visibility`**: JSON-Spiegel der Table-`VisibilityState` (partielle Keys sind erlaubt; Vergleich nutzt normalisierte stabile JSON-Strings).
- **`column_order`**: JSON-Array von Spalten-`id`-Strings in Anzeige-Reihenfolge (wie `table.getState().columnOrder`). Leeres Array **`[]`** bedeutet „beim Anwenden Reihenfolge nicht überschreiben“ (Legacy-Presets); beim **Speichern** wird immer die aktuelle Reihenfolge mitpersistiert.

## Atomisches Anwenden

`useApplyTripPreset`:

1. Baut **`URLSearchParams`** aus dem Preset (nur truthy String-Werte), setzt **`page=1`**, **`router.replace(pathname + '?' + …)`**.
2. Ruft **`refreshTripsPage()`** auf (wie die Filterleiste), damit RSC/React Query mit dem neuen URL-Zustand nachziehen.
3. **Sichtbarkeit:** Wenn die Table-Instanz existiert → `table.setColumnVisibility`; sonst **`setPendingColumnVisibility`**.
4. **Reihenfolge:** Wenn **`column_order`** nicht leer ist: analog **`table.setColumnOrder`** bzw. **`setPendingColumnOrder`** (Kanban → Liste).

**TripsTable** übernimmt Pending in Effekten und leert die Queue — wie bei `columnVisibility`.

## Aktives Preset

Ein Preset gilt als **aktiv**, wenn die normalisierte Whitelist der URL-Parameter, die normalisierte Sichtbarkeit und (falls im Preset gespeichert) die Spaltenreihenfolge mit dem aktuellen Zustand übereinstimmen. Ist **`column_order`** im Preset leer, fließt die Reihenfolge **nicht** in den Vergleich ein (Abwärtskompatibilität).

## Deselect / Zurücksetzen

Ein erneuter Klick auf das **aktive** Preset in der Dropdown-Liste setzt die Ansicht auf **Standard**:

- URL: **`view=list`**, **`page=1`**, **`scheduled_at`** = heute (`todayYmdInBusinessTz()`, gleiches Format wie die Filterleiste bei Erstbesuch).
- Spalten: **`DEFAULT_COLUMN_VISIBILITY`** und **`DEFAULT_COLUMN_ORDER`** in `ansichten-dropdown.tsx` — müssen mit `TripsTable` `initialState` bzw. der Reihenfolge in `trips-tables/columns.tsx` übereinstimmen.

## Verwaltungs-Sheet: „Überschreiben“

Pro Zeile: **Übernehmen** wendet das Preset an; **Überschreiben** speichert die **aktuellen** Filter + Spalten + Reihenfolge (`getSnapshot()`) in dieses Preset (Update), ohne den Namen zu ändern.

## UI-Verhalten

- **„Aktuelle Ansicht speichern“** ist in der **Kanban-Ansicht** (`view=kanban`) **deaktiviert** mit Tooltip: *„Ansichten sind nur in der Listenansicht verfügbar.“*
- **Dropdown:** `modal={false}` für kompatibles Verhalten mit verschachtelten Radix-Untermenüs.

### Spalte **`reha_schein`**

- In der Fahrten-Tabelle ausblendbar; **standardmäßig ausgeblendet** (nur für einen Teil der Fahrten relevant), analog **`net_price`** / **`tax_rate`**.

## Bewusst nicht umgesetzt (Scope)

- Pro-Benutzer-Presets (aktuell firmenweit).
- Kanban-eigene Spalten-Presets.

## Technik

- **Tabelle:** `public.trip_presets` (Migration `20260514150000_trip_presets.sql`, ergänzt u. a. durch `20260514160000_trip_presets_column_order.sql`).
- **Client-API:** `trip-presets.service.ts`, React Query `tripKeys.presets()`.
- **Hooks:** `use-trip-presets`, `use-apply-trip-preset`, `use-current-trip-view-snapshot`.

### Migrationen (Zeitstempel)

Dateinamen folgen dem Muster **`YYYYMMDDHHmmss_beschreibung.sql`** (UTC-ähnlicher Präfix, keine Trennzeichen zwischen Datum und Uhrzeit).
