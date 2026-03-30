# Fahrten duplizieren

Dispatch kann **einmalige Kopien** bestehender Fahrten auf einen anderen Kalendertag legen — ohne neue `recurring_rules`-Zeile und ohne die bestehende Serie zu ändern.

---

## Problem / Ziel

- Eine Fahrt (oder mehrere) wurde für heute angelegt; dieselbe Konfiguration soll **morgen oder an einem frei wählbaren Tag** noch einmal stattfinden.
- Das ist **kein** Ersatz für wiederkehrende Regeln (Cron unter `recurring_rules`). Kopien sind normale `trips`-Zeilen mit `rule_id = null`.

---

## Einstieg (UI)

| Wo | Aktion |
|----|--------|
| **Fahrten**-Liste | Zeilen per Checkbox wählen → Bulk-Leiste **„Duplizieren“** (ein oder mehrere Datensätze). |
| **Trip-Detail-Blatt** | Footer → **„Aktionen“** öffnen → **„Duplizieren“** (genau die geöffnete Zeile als Ausgangspunkt). |

- In der **Liste** gelten **nur die ausgewählten** Zeilen (kein automatisches Duplizieren einer ganzen `group_id`-Gruppe, wenn nicht alle Mitglieder markiert sind).
- Im **Detail-Blatt** entspricht die Auswahl **immer einer** Zeile; optional kann die **verknüpfte Gegenfahrt** mitkopiert werden (siehe unten).

---

## API: `includeLinkedLeg`

Der `POST`-Body wird von `parseDuplicateTripsPayload` validiert (siehe [`duplicate-trip-schedule.ts`](../src/features/trips/lib/duplicate-trip-schedule.ts)).

| Feld | Typ | Standard | Bedeutung |
|------|-----|----------|-----------|
| `includeLinkedLeg` | `boolean` (optional) | **`true`**, wenn das Feld **fehlt** | `true`: Server lädt wie bisher zu jeder angefragten Zeile die **Partner-Zeile** (Hin/Rück) nach und dupliziert ggf. **ein Paar**. `false`: Es werden **nur** die IDs aus `ids` geladen — keine Partner-Expansion (`fetchTripsExpandedForDuplicate`). |

**Abwärtskompatibilität:** Bestehende Clients (Bulk-Leiste, ältere Builds), die `includeLinkedLeg` **nicht** mitsenden, verhalten sich unverändert wie zuvor (**immer** Partner einbeziehen, wenn eine Seite der Verknüpfung ausgewählt ist).

**Detail-Blatt:** Sendet `includeLinkedLeg: false`, wenn der Nutzer die Checkbox **„… mitkopieren“** abwählt. Dann entsteht **nur eine** neue Zeile für die geöffnete Fahrt; sie ist **nicht** mit der Gegenfahrt verknüpft (siehe nächster Abschnitt).

---

## API: `unified_time` — ISO-Felder und `explicitPerLegUnifiedTimes`

| Feld | Typ | Bedeutung |
|------|-----|-----------|
| `unifiedScheduledAtIso` | `string` (ISO) | Standardfall (`explicitPerLegUnifiedTimes` **fehlt**): bei `scheduleMode: unified_time` **Pflicht** — Abholzeit der **Hinfahrt** (bzw. nach Anker-Logik im Bulk-Dialog, siehe unten). |
| `unifiedReturnScheduledAtIso` | `string` (ISO), optional | Wenn gesetzt: **Rückfahrt**-Instant; der Server setzt die Rückfahrt dann **direkt** und ruft `computeReturnScheduleForDuplicate` für dieses Bein nicht auf. |
| `explicitPerLegUnifiedTimes` | `boolean`, nur **`true`** | Nur **Detail-Blatt** + **genau ein** Hin-/Rück-Paar in der Anfrage + `unified_time`. Dann sind `unifiedScheduledAtIso` und `unifiedReturnScheduledAtIso` **jeweils optional** (fehlen/leer = Kopie **ohne** feste `scheduled_at` für diese Seite, `requested_date` = gewähltes Datum). Andere Kombinationen (Bulk, mehrere Paare) lehnt `executeDuplicateTrips` ab. |

**Ohne** `explicitPerLegUnifiedTimes` (Liste, Einzelfahrt, ältere Clients): `unified_time` verlangt weiterhin `unifiedScheduledAtIso`; optionales `unifiedReturnScheduledAtIso` wie oben.

---

## Dialog-Optionen (Datum & Zeit)

| Option | Verhalten |
|--------|-----------|
| **Neues Datum** | Kalendertag für die Kopien; Standard ist **der nächste Kalendertag** im konfigurierten Geschäftszeitraum (`NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE`, sonst `Europe/Berlin`). |
| **Gleiche Uhrzeit wie in der Vorlage** | Pro Quell-Zeile: gleiche **Uhrzeit** (in der Geschäftszeitzone) am gewählten Tag. Hat die Quelle **keine** `scheduled_at`, bleibt die Kopie ohne feste Zeit: `scheduled_at = null`, `requested_date` = gewähltes Datum. |
| **Neue Uhrzeit wählen** | **`scheduleMode: unified_time`**. Verhalten hängt von **Liste vs. Detail** und **Hin/Rück** ab (siehe nächster Absatz). |
| **Zeit offen** | Nur der Kalendertag; `scheduled_at = null`, `requested_date` = gewähltes Datum. |

### „Neue Uhrzeit wählen“: Liste (Bulk) vs. Detail-Blatt

- **Detail-Blatt** mit **verknüpftem Hin-/Rück-Paar** (Mitkopie aktiv): Zwei Felder **Hinfahrt** und **Rückfahrt** (je `<input type="time">`). Keine Radio-Auswahl „gilt für …“. Vorlage-Uhrzeiten werden auf den gewählten Kalendertag gemappt; jedes Feld darf **leer** bleiben (Kopie ohne feste Zeit für dieses Bein). Request sendet `explicitPerLegUnifiedTimes: true` und nur gesetzte ISOs.
- **Liste (Bulk)** mit **zwei markierten Zeilen** eines Paars **und** Uhrzeit in **beiden** Vorlagen: **Radio** „Uhrzeit gilt für Hinfahrt / Rückfahrt“ + **eine** Uhrzeit; die andere Fahrt folgt dem **Abstand** wie in der Vorlage (`computeReturnScheduleForDuplicate`). Fehlt in der Vorlage eine Seite ohne Zeit, bleibt die entsprechende Kopie zeitoffen; **`requested_date`** der Rückfahrt bleibt mit dem Kalendertag der neuen Hinfahrt ausgerichtet (Geschäftszeitzone), damit Hin/Rück nicht auf verschiedene Tage rutschen.
- **Einzelfahrt** (Liste oder Detail ohne Paar): ein Uhrzeitfeld wie bisher.

### Detail-Blatt: verknüpfte Gegenfahrt

Wenn für die geöffnete Fahrt eine Partner-Zeile bekannt ist, zeigt der Dialog eine Checkbox (Standard: **aktiv**), z. B. **„Rückfahrt mitkopieren“** / **„Hinfahrt mitkopieren“** — abhängig von der Richtung der Gegenfahrt (`getTripDirection`).

- **Aktiv** (`includeLinkedLeg: true`): gleiches Verhalten wie bei **einer** markierten Zeile in der Fahrten-Liste (Server lädt Partner und erzeugt **ein** neues Paar).
- **Inaktiv** (`includeLinkedLeg: false`): nur die geöffnete Zeile wird kopiert. Die neue Zeile ist eine **eigenständige** Fahrt ohne `linked_trip_id` zur neuen Gegenfahrt — Disposition und Abrechnung behandeln sie wie jede andere Einzelfahrt; die **Original-Gegenfahrt** bleibt unverändert.

---

## Verknüpfte Hin- und Rückfahrt (Liste & API mit `includeLinkedLeg: true`)

- Ist nur **eine** Seite einer Verknüpfung ausgewählt (oder das Detail-Blatt mit aktivierter Mitkopie), lädt der Server die **Partner-Zeile** (gleiche Logik wie `findPairedTrip` in `recurring-exceptions.actions.ts`) und dupliziert **beide** Beine genau einmal.
- Sind in der Liste **beide** Seiten markiert, entsteht dennoch nur **ein** neues Paar (IDs werden zusammengeführt).
- Nach dem Einfügen: **Rückfahrt** mit `link_type = 'return'` und `linked_trip_id` → neue Hinfahrt; anschließend **Update** der Hinfahrt auf `link_type = 'outbound'` und `linked_trip_id` → neue Rückfahrt (wie Bulk-Upload / nachträgliche Rückfahrt).

**Antwort-Reihenfolge:** Die API liefert `ids` in der Reihenfolge der Inserts. Bei einem Paar ist das **`[outboundId, returnId]`** — das Detail-Blatt nutzt diese Reihenfolge, um nach dem Duplizieren **die Kopie der zuletzt geöffneten Beine** anzuzeigen (Hinfahrt → erste ID, Rückfahrt → zweite ID).

Details zu `link_type`: [trip-linking-and-cancellation.md](./trip-linking-and-cancellation.md).

---

## Nach dem Duplizieren (Detail-Blatt)

- Nach erfolgreichem Aufruf springt das Blatt auf die **neue** Fahrt (`onNavigateToTrip`), sofern der Parent dies unterstützt (z. B. Fahrten-Tabelle, Übersicht).
- Die Listenseite wird wie gewohnt über den bestehenden Refresh aktualisiert.

---

## Datenregeln

- **Kopiert u. a.:** Route (Adressen, Strukturfelder, Koordinaten), Kunde, Abrechnung (`payer_id`, `billing_variant_id`), Notizen, Fahrgast-Flags, Fahrstrecke/-dauer falls vorhanden.
- **Immer geleert / Standard:** `rule_id`, `driver_id`, Ist-Zeiten, Storno-Felder, `group_id` (v1), `ingestion_source = 'trip_duplicate'`, Status **offen** (`pending`) ohne Fahrer.
- **Herkunft (v1):** Kopien sind über `ingestion_source = 'trip_duplicate'` erkennbar. Im Detail-Blatt erscheint dazu ein **„Kopie“**-Badge. Eine **FK zur Original-Zeile** ist für eine spätere Version vorgesehen, nicht Teil von v1.

- **Warnung UI:** Wenn eine Quelle `rule_id` gesetzt hat — Hinweis, dass sich Kopien mit künftigen Fahrten aus derselben Regel überschneiden können.

---

## Technische Dateien

| Pfad | Rolle |
|------|--------|
| [`src/features/trips/lib/duplicate-trip-schedule.ts`](../src/features/trips/lib/duplicate-trip-schedule.ts) | Zeitlogik + `parseDuplicateTripsPayload` (`includeLinkedLeg`, `explicitPerLegUnifiedTimes`, ISO-Felder; ohne Supabase) |
| [`src/features/trips/lib/duplicate-trips.ts`](../src/features/trips/lib/duplicate-trips.ts) | Expansion (`fetchTripsExpandedForDuplicate`), Paar-Partitionierung, Insert-Reihenfolge, `createdIds` |
| [`src/app/api/trips/duplicate/route.ts`](../src/app/api/trips/duplicate/route.ts) | Auth, `company_id`-Prüfung, Service-Role-Inserts |
| [`src/features/trips/api/trips.service.ts`](../src/features/trips/api/trips.service.ts) | `duplicateTrips` (Client `fetch`) |
| [`src/features/trips/components/trips-tables/duplicate-trips-dialog.tsx`](../src/features/trips/components/trips-tables/duplicate-trips-dialog.tsx) | Dialog (`variant`: `bulk` \| `detail`, optional `linkedPartnerPreview`, `onSuccess` mit `ids`) |
| [`src/features/trips/components/trips-tables/trips-pagination-bulk-actions.tsx`](../src/features/trips/components/trips-tables/trips-pagination-bulk-actions.tsx) | Bulk-Leiste **„Duplizieren“** |
| [`src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx`](../src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx) | **Aktionen**-Menü, Einbindung Dialog, Navigation nach Erfolg |

---

## Siehe auch

- [trip-detail-sheet-editing.md](./trip-detail-sheet-editing.md) — **Duplizieren** vs **Verschieben** vs **Rückfahrt** im Blatt
- [trip-reschedule-v1.md](./trip-reschedule-v1.md) — **Verschieben** (UPDATE, andere Eligibility)
- [trip-linking-and-cancellation.md](./trip-linking-and-cancellation.md) — §3e Duplizieren
- [trips-rueckfahrt-detail-sheet.md](./trips-rueckfahrt-detail-sheet.md) — verwandtes Muster (Kopie ohne `rule_id` auf der Rückfahrt)
