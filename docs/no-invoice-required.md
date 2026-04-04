# Keine Rechnung (`no_invoice_required`)

## Kaskade

Die Voreinstellung folgt derselben Reihenfolge wie KTS: **Unterart → Abrechnungsfamilie (`behavior_profile`) → Kostenträger → aus**.

Implementierung: `resolveNoInvoiceRequiredDefault` in `src/features/trips/lib/resolve-no-invoice-required.ts`.

## Persistenz

- `trips.no_invoice_required`, `trips.no_invoice_source` (`variant` | `familie` | `payer` | `system_default` | `manual`).
- Wiederkehrende Regeln: `recurring_rules` spiegelt dieselben Spalten; Cron schreibt sie auf generierte Fahrten.
- **Duplikat Fahrt:** Flags werden übernommen, `no_invoice_source = manual`. **Rückfahrt:** Flags vom Hinflug kopiert, keine Fremdfirma auf der Rückfahrt.

## UI

- **Neue Fahrt:** Schalter „Keine Rechnung“ nur wenn die Kaskade für den gewählten Kostenträger (ggf. mit Unterart) **tatsächlich „Keine Rechnung“** vorsieht; sonst ausgeblendet und beim Speichern `no_invoice_source = system_default`. Kein Fremdfirma-Block beim Anlegen (Zuweisung im Fahrt-Detail).
- Fahrt-Detail, Regel-Editor: Schalter „Keine Rechnung“ mit Katalog-Hinweis; bei gleichzeitigem KTS erscheint ein Hinweis zur Prüfung.
- **Rechnungs-Builder:** Positionen mit gesetztem Flag erhalten ein Badge und einen Sammelhinweis in Schritt 3.
