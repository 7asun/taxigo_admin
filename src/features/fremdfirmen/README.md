# Feature: Fremdfirmen

## Module

- `api/fremdfirmen.service.ts` — Liste, Anlegen, Aktualisieren (Supabase, `company_id` aus `accounts`).
- `hooks/use-fremdfirmen-admin.ts` — Admin-Liste + Mutationen, invalidiert auch `referenceKeys.fremdfirmen()` für Trip-Formulare.
- `lib/fremdfirma-payment-mode-labels.ts` — Deutsche Labels und Optionen für Abrechnungsarten (Trip, Regel, **Fahrten-Tabelle** Spalte „Abrechnung Fremdfirma“).
- `components/fremdfirmen-page.tsx` / `fremdfirma-form-dialog.tsx` — Verwaltungs-UI.
- `components/trip-fremdfirma-section.tsx` — Fremdfirma-Block in der Fahrt-Detailmaske (sofortiges Speichern, Recurring-Scope-Dialog).

## Route

`/dashboard/fremdfirmen` — Eintrag in `nav-config.ts` unter Account.

## Abhängigkeiten

- `trips` und `recurring_rules` referenzieren `fremdfirmen` per FK.
- Referenzliste für aktive Partner: `fetchActiveFremdfirmen` in `trip-reference-data.ts` + `useFremdfirmenQuery`.
- **Fahrten-Liste (Desktop):** Spalten **Fremdfirma** / **Abrechnung Fremdfirma** / zentrierter **Fahrer**-Hinweis „Extern · …“ — [`trips-tables/columns.tsx`](../trips/components/trips-tables/columns.tsx), [`driver-select-cell.tsx`](../trips/components/trips-tables/driver-select-cell.tsx); Überblick [`docs/fremdfirma.md`](../../../docs/fremdfirma.md).
