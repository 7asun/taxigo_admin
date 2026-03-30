# Fahrten duplizieren (Bulk-Aktion)

Dispatch kann **einmalige Kopien** bestehender Fahrten auf einen anderen Kalendertag legen — ohne neue `recurring_rules`-Zeile und ohne die bestehende Serie zu ändern.

---

## Problem / Ziel

- Eine Fahrt (oder mehrere) wurde für heute angelegt; dieselbe Konfiguration soll **morgen oder an einem frei wählbaren Tag** noch einmal stattfinden.
- Das ist **kein** Ersatz für wiederkehrende Regeln (Cron unter `recurring_rules`). Kopien sind normale `trips`-Zeilen mit `rule_id = null`.

---

## Einstieg (UI)

- **Fahrten**-Liste: Zeilen per Checkbox wählen → in der Bulk-Leiste **„Duplizieren“**.
- Derselbe Dialog gilt für **eine** oder **mehrere** ausgewählte Zeilen.
- Es werden **nur die ausgewählten** Zeilen berücksichtigt (kein automatisches Duplizieren einer ganzen `group_id`-Gruppe, wenn nicht alle Mitglieder markiert sind).

---

## Dialog-Optionen

| Option | Verhalten |
|--------|-----------|
| **Neues Datum** | Kalendertag für die Kopien; Standard ist **der nächste Kalendertag** im konfigurierten Geschäftszeitraum (`NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE`, sonst `Europe/Berlin`). |
| **Uhrzeit wie Original** | Pro Quell-Zeile: gleiche **Uhrzeit** (in der Geschäftszeitzone) am gewählten Tag. Hat die Quelle **keine** `scheduled_at`, bleibt die Kopie ohne feste Zeit: `scheduled_at = null`, `requested_date` = gewähltes Datum. |
| **Eine Uhrzeit für alle (Hinfahrt)** | Ein Datum/Uhrzeit-Picker legt die **Hinfahrt** aller duplizierten Einheiten fest. Bei **Hin+Rück** mit zwei Zeiten bleibt der **Zeitabstand** zwischen den Beinen erhalten. Fehlt der Rückweg die Uhrzeit (`scheduled_at` null), bleibt die Kopie zeitoffen, aber **`requested_date` der Rückfahrt entspricht dem Kalendertag der neuen Hinfahrt** (Geschäftszeitzone) — nicht nur dem separaten Datumsfeld, damit Hin/Rück nicht auf zwei verschiedene Tage rutschen. |
| **Zeit offen** | Nur der Kalendertag; `scheduled_at = null`, `requested_date` = gewähltes Datum. |

---

## Verknüpfte Hin- und Rückfahrt

- Ist nur **eine** Seite einer Verknüpfung ausgewählt, lädt der Server die **Partner-Zeile** (gleiche Logik wie `findPairedTrip` in `recurring-exceptions.actions.ts`) und dupliziert **beide** Beine genau einmal.
- Sind **beide** Seiten markiert, entsteht dennoch nur **ein** neues Paar (IDs werden zusammengeführt).
- Nach dem Einfügen: **Rückfahrt** mit `link_type = 'return'` und `linked_trip_id` → neue Hinfahrt; anschließend **Update** der Hinfahrt auf `link_type = 'outbound'` und `linked_trip_id` → neue Rückfahrt (wie Bulk-Upload / nachträgliche Rückfahrt).

Details zu `link_type`: [trip-linking-and-cancellation.md](./trip-linking-and-cancellation.md).

---

## Datenregeln

- **Kopiert u. a.:** Route (Adressen, Strukturfelder, Koordinaten), Kunde, Abrechnung (`payer_id`, `billing_variant_id`), Notizen, Fahrgast-Flags, Fahrstrecke/-dauer falls vorhanden.
- **Immer geleert / Standard:** `rule_id`, `driver_id`, Ist-Zeiten, Storno-Felder, `group_id` (v1), `ingestion_source = 'trip_duplicate'`, Status **offen** (`pending`) ohne Fahrer.
- **Warnung UI:** Wenn eine Quelle `rule_id` gesetzt hat — Hinweis, dass sich Kopien mit künftigen Fahrten aus derselben Regel überschneiden können.

---

## Technische Dateien

| Pfad | Rolle |
|------|--------|
| [`src/features/trips/lib/duplicate-trip-schedule.ts`](../src/features/trips/lib/duplicate-trip-schedule.ts) | Zeitlogik + Request-Parsing (ohne Supabase; gemeinsam mit Dialog) |
| [`src/features/trips/lib/duplicate-trips.ts`](../src/features/trips/lib/duplicate-trips.ts) | Expansion, Paar-Partitionierung, Insert-Reihenfolge |
| [`src/app/api/trips/duplicate/route.ts`](../src/app/api/trips/duplicate/route.ts) | Auth, `company_id`-Prüfung, Service-Role-Inserts |
| [`src/features/trips/api/trips.service.ts`](../src/features/trips/api/trips.service.ts) | `duplicateTrips` (Client `fetch`) |
| [`src/features/trips/components/trips-tables/duplicate-trips-dialog.tsx`](../src/features/trips/components/trips-tables/duplicate-trips-dialog.tsx) | Dialog |
| [`src/features/trips/components/trips-tables/trips-pagination-bulk-actions.tsx`](../src/features/trips/components/trips-tables/trips-pagination-bulk-actions.tsx) | Button „Duplizieren“ |

---

## Siehe auch

- [trip-linking-and-cancellation.md](./trip-linking-and-cancellation.md) — §3e Duplizieren
- [trips-rueckfahrt-detail-sheet.md](./trips-rueckfahrt-detail-sheet.md) — verwandtes Muster (Kopie ohne `rule_id` auf der Rückfahrt)
