# Audit: Brief-Modul (Briefe ohne Tabellen, Read-Only Kontext)

**Hinweis zu den angeforderten Pfaden:** Im Repo gibt es kein Verzeichnis `src/app/(dashboard)/abrechnung/`. Die Abrechnung-Routen liegen unter **`src/app/dashboard/abrechnung/`** (siehe u. a. `page.tsx`, `vorlagen/page.tsx`, `preise/page.tsx`, `rechnungsempfaenger/page.tsx`, `angebot-vorlagen/page.tsx`). Ebenso existiert **`src/app/(dashboard)/account/`** nicht; die Navigationsgruppe „Account“ verweist auf mehrere Routen unter `src/app/dashboard/…` (siehe Abschnitt 4–5).

---

## 1. Shared PDF primitives (Letterhead / Header / Footer)

**Befund:** Es gibt **kein** separates Verzeichnis `src/components/pdf/` oder `src/lib/pdf/`. Die gemeinsamen PDF-Bausteine liegen im **Invoices-Feature** und werden von **Angeboten** importiert.

**Gemeinsam genutzt:**

| Baustein | Pfad | Rolle |
|----------|------|--------|
| `InvoicePdfCoverHeader` | `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-header.tsx` | Digital: Logo/Senderzeile, Empfängerblock (flow), rechte Meta-Box |
| `InvoicePdfCoverHeaderBrief` | `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-header-brief.tsx` | Brief-Modus: nur Branding + Meta; Empfänger absolut auf `<Page>` |
| `InvoicePdfRecipientBlock` | `invoice-pdf-cover-header.tsx` (ab Zeile 174) | Fensteradresse |
| `InvoicePdfMetaGrid` | `invoice-pdf-cover-header.tsx` (ab Zeile 64) | Rechte Spalte (Nr., Datum, Kundennummer, ggf. Steuern, Zeitraum) |
| `InvoicePdfBrandingBlock` | `invoice-pdf-cover-header.tsx` (ab Zeile 22) | Logo + Slogan + Senderzeile |
| `InvoicePdfFooter` | `src/features/invoices/components/invoice-pdf/invoice-pdf-footer.tsx` | Fixer Footer (Absender/Kontakt/Bank), optional `notes` |

**Props von `InvoicePdfCoverHeader`:** `InvoicePdfCoverHeaderProps` ab Zeile **337** in `invoice-pdf-cover-header.tsx`:

- `companyProfile`, `senderFit`, optional `renderMode`
- `recipient` (strukturiertes Objekt mit u. a. `companyName`, `personName`, `street`, `zipCode`, `city`, optional `anrede`, `abteilung`, `firstName`, `lastName`)
- optional `secondaryLegalRecipient` (nur relevant für Rechnung `per_client` + Snapshot)
- `invoiceNumber`, `invoiceCreatedAtIso`, `periodFromIso`, `periodToIso`, `customerNumber`
- optional `isStorno`, optional `metaConfig` (`PdfCoverHeaderMetaConfig`, Zeilen **314–335**)

`AngebotPdfDocument` setzt dieselben Header-Komponenten mit **`metaConfig`** für Angebots-Labels (z. B. „Angebotsdaten“, ohne Steuer-IDs); siehe `AngebotPdfDocument.tsx` Zeilen **210–219** und **232–241**.

**Duplikation Letterhead:** Die **fachliche** Letterhead-Logik (Branding, Meta, Footer) ist **geteilt**. **Dupliziert** (absichtlich, Path C / DIN 5008) ist nur der **Brief-Modus-Block** auf der `<Page>`: Falzmarken + absolut positioniertes Adressfenster — in **`InvoicePdfDocument.tsx`** (ca. Zeilen **383–434**) und **`AngebotPdfDocument.tsx`** (ca. Zeilen **147–195**) nahezu parallel.

**Layout-Konstanten:** Beide Dokumenttypen beziehen Abstände aus `src/features/invoices/lib/pdf-layout-constants.ts` (in Doku: `docs/invoices-module.md` Abschnitt „PDF Layout System“, `docs/angebote-module.md` Abschnitt „PDF Layout System“).

---

## 2. Document data model (Supabase)

**Befund:** Es gibt **keine** gemeinsame Basistabelle `documents`. **`invoices`** und **`angebote`** sind **getrennte** Tabellen; jeweils eigene Kopfzeilen- und Positionsstruktur.

### `public.invoices` — Spalten (aus Migrationen zusammengesetzt)

**Kern:** `20260331120000_create_invoices.sql` (Zeilen **27–123** u. Kommentare).

| Spalte | Quelle |
|--------|--------|
| `id`, `company_id`, `invoice_number`, `payer_id`, `billing_type_id`, `mode`, `client_id`, `period_from`, `period_to`, `status`, `subtotal`, `tax_amount`, `total`, `notes`, `payment_due_days`, `created_by`, `created_at`, `updated_at`, `sent_at`, `paid_at`, `cancelled_at`, `cancels_invoice_id` | `create_invoices` |
| `intro_block_id`, `outro_block_id` | `20260401193000_add_invoice_text_block_columns.sql` |
| `pdf_column_override` | `20260408120001_pdf_vorlagen.sql` |
| `rechnungsempfaenger_id`, `rechnungsempfaenger_snapshot` | `20260405100003_invoices_recipient_snapshot.sql` |
| `billing_variant_id` | `20260410120000_invoices_billing_variant_id.sql` |
| `client_reference_fields_snapshot` | `20260410140100_invoices_client_reference_fields_snapshot.sql` |
| `email_subject`, `email_body` | `20260410190000_invoices_email_draft.sql` |

Positionen liegen in **`invoice_line_items`** (`20260331130000_create_invoice_line_items.sql` und Folgemigrationen).

### `public.angebote` — Spalten

**Kern:** `20260409150000_create_angebote.sql` (Zeilen **16–50**).

Zusätzlich: `recipient_first_name`, `recipient_last_name` (`20260409160000_angebote_split_recipient_name.sql`); `angebot_vorlage_id`, `table_schema_snapshot` (`20260413120000_angebot_flexible_table.sql`).

Positionen: **`angebot_line_items`** (inkl. `data` jsonb in derselben Migration).

### Gemeinsame Konzepte (kein gemeinsames DB-Schema)

- **`company_id`** (Mandant)
- **Empfänger:** Rechnung über `payer`/`client` + `rechnungsempfaenger_snapshot`; Angebot über `recipient_*` Textfelder
- **Datum:** Rechnung `created_at` + Periode; Angebot `offer_date`, `valid_until`
- **Betreff / Freitext:** Angebot `subject`, `intro_text`, `outro_text`; Rechnung eher `intro_block`/`outro_block` + Standardfließtext + `notes` (Footer)

**TypeScript-DB-Typen:** `src/types/database.types.ts` enthält in der geprüften Fassung **keine** Tabellen `invoices` / `angebote` — die generierten Types wirken **veraltet** gegenüber den Migrationen; für Schema ist die **Migrations-Historie** maßgeblich.

---

## 3. PDF body structure — Tabelle optional?

### Rechnung (`InvoicePdfCoverBody`)

Datei: `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx`.

- Nach Betreff, Anrede und Intro (**Zeilen 146–155**) wird **immer** ein **Tabellenkopf** gerendert (**Zeilen 157–187**).
- Datenzeilen folgen aus `summaryItems` (gruppiert / single_row / grouped_by_billing_type) oder aus `invoice.line_items` (flat) (**Zeilen 189–290**).
- Anschließend **immer** Summen, Zahlungsblock, Outro (**Zeilen 292–405**).

**Fazit:** Die **Haupttabelle ist strukturell Pflicht** (mindestens Kopfzeile); ein „nur Brieftext ohne Tabellenbereich“ ist mit dem aktuellen `InvoicePdfCoverBody` **nicht** vorgesehen. Ein leeres `line_items` würde weiterhin Kopf + Summen/Zahlungsinformation erzeugen (fachlich untypisch; Builder verlangt i. d. R. Zeilen).

### Angebot (`AngebotPdfCoverBody`)

Datei: `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx`.

- Tabelle nur wenn **`lineItems.length > 0 && effectiveColumns.length > 0`** (**Zeilen 294–379**).
- Intro (HTML) **oberhalb**, Outro **unterhalb** der optionalen Tabelle (**Zeilen 276–292**, **381–397**).

**Fazit:** Beim Angebot ist die **Tabelle bereits optional** — ein „Brief ohne Tabelle“ ist dort **architektonisch näher** als bei der Rechnung.

---

## 4. Navigation schema

**Definition:** `src/config/nav-config.ts`, exportiertes Array `navItems` (**Zeilen 25–155**).

- **Abrechnung:** `url: '#'` (**Zeile 52**) — **Collapse-only group** (Typ 2 laut `docs/navigation.md`); Kinder u. a. Rechnungen `/dashboard/invoices`, Angebote `/dashboard/angebote`, …
- **Account:** ebenfalls `url: '#'` (**Zeile 91**) mit Kindern (`/dashboard/clients`, `/dashboard/drivers`, `shift-reconciliations`, `payers`, `fremdfirmen`).

**Sidebar-Rendering:** laut `docs/navigation.md` — Leaf vs. Collapse-only vs. Expand-and-navigate; **Abrechnung** ist in der Doku als **Expand-and-navigate** mit Parent-URL `/dashboard/abrechnung` beschrieben — im aktuellen `nav-config` steht für Abrechnung jedoch **`url: '#'`** (reine Collapse-Gruppe ohne Parent-Page-Link in der Konfiguration). Die Übersichtsseite existiert dennoch: `src/app/dashboard/abrechnung/page.tsx`.

**Neuer Eintrag „Briefe“ unter „Account“:** In `nav-config.ts` innerhalb des `items`-Arrays des Account-Objekts (**ab Zeile 94**) ein neues Objekt `{ title: 'Briefe', url: '...', icon?: …, shortcut?: … }` ergänzen. Anschließend Route/Page unter `src/app/dashboard/...` anlegen; optional **kbar** bleibt kompatibel, sofern es `navItems` flatteniert (`docs/navigation.md` Zeilen 48–52).

---

## 5. Account-Bereich — aktueller Zustand

**Unter „Account“ in der Nav** (nicht ein Ordner `account/`, sondern **Gruppe** in `nav-config.ts` **Zeilen 89–125**):

- Fahrgäste, Fahrer, Schichtzettel-Abgleich, Kostenträger, Fremdfirmen

Das sind **überwiegend Stammdaten / operative Objekte**, nicht nur „User/Company Settings“ (die liegen unter **Einstellungen**, z. B. `Unternehmen` → `/dashboard/settings/company`).

**Ein Modul „Briefe“** würde sich **nicht** widersprechen: Es gibt bereits **funktionale** Module unter Account (z. B. Schichtzettel-Abgleich). Alternativ wäre **Abrechnung** ebenfalls logisch (alle PDF-Dokumente an einem Ort); das ist eine Produktentscheidung.

---

## 6. Freitext / Anmerkungen im PDF

### Rechnung

- **`invoices.notes`:** werden im **Footer** als „Hinweis: …“ gerendert (`invoice-pdf-footer.tsx` **Zeilen 52–54**).
- **Intro:** Standard- oder Text aus `intro_block` / Override — im Body als **plain `<Text>`** (`invoice-pdf-cover-body.tsx` **Zeile 154**), **oberhalb der Tabelle** (**Zeilen 146–155** vor **157**).
- **Outro:** unterhalb Zahlungsblock (`invoice-pdf-cover-body.tsx` **Zeilen 392–404**); Plain-Text mit optionalem Telefon-Satz.
- **E-Mail-Entwurf** (`email_subject` / `email_body`): separat von der PDF (siehe `docs/invoices-module.md` „Invoice Email Draft“).

### Angebot

- **`intro_text` / `outro_text`:** **HTML (Tiptap)** via `react-pdf-html` `<Html>` mit Stylesheet `ANGEBOT_HTML_STYLESHEET` (`AngebotPdfCoverBody.tsx` **Zeilen 19–70**, **276–291**, **381–396**). Intro **vor** optionaler Tabelle, Outro **danach**.

---

## 7. Supabase „Collections“ / Muster für `briefe`

**Befund:** Es gibt **kein** generisches `documents`-Enum in den geprüften Migrationen. Neue Dokumentarten folgen dem etablierten Muster:

- **Eigene Kopftabelle** (`invoices`, `angebote`) mit `company_id`, Status, Nummerierung, ggf. RPC für fortlaufende Nummern
- **Optional eigene Positionstabelle** (Rechnung/Angebot) oder **keine**, wenn rein prose

**Minimales `briefe`-Schema (orientiert an Angebot, ohne Positions-Tabelle):**

- `id` (uuid, PK), `company_id` (FK `companies`)
- `brief_number` (text, unique) oder anderes Nummernschema + ggf. `SECURITY DEFINER` RPC analog `angebot_numbers_max_for_prefix`
- `status` (enum oder text)
- Empfänger-Felder analog `angebote.recipient_*` **oder** FK zu `clients` / Freitext — je nach Produkt
- `subject` (text, nullable), `body_html` oder `body_text` (text), `letter_date` (date)
- `created_at`, `updated_at`, `created_by` (optional)
- RLS: gleiches Muster `current_user_is_admin()` + `current_user_company_id()` wie `angebote`

Wiederverwendung von **`invoice_text_blocks`** wäre möglich (wie Rechnung/Angebots-Vorlagen), ist für „Briefe“ aber nicht zwingend.

---

## 8. React-PDF Renderer — Version und Constraints

- **Version:** `@react-pdf/renderer` **`^4.3.2`** in `package.json` (**Zeile 63**).
- **Workarounds / dokumentierte Constraints im Code:**
  - **Helvetica** als Font, kein externes Font-Loading (`pdf-styles.ts` **Zeilen 12–13**, **51–54**).
  - **Footer / Page-Nummer:** Kommentar zu `bottom` vs. `top` in `invoice-pdf-footer.tsx` **Zeilen 1–4** (react-pdf 4.3.x).
  - **Logo:** `width` + `maxHeight` statt fester `height` wegen Leerraum bei `objectFit: 'contain'` (`docs/invoices-module.md` Abschnitt „Logo im PDF-Header“; `InvoicePdfBrandingBlock` **Zeilen 34–36**).
  - **JSONB von PostgREST** kann als String ankommen — Coercion in PDF-Hilfen (`invoice-pdf-cover-body.tsx` Kommentar; `AngebotPdfCoverBody` `coerceLineItemData` **Zeilen 94–114**).
  - **Tabellen / Flex:** Hinweise in `docs/invoices-module.md` (Breiten, `minWidth: 0`, `width: '100%'`).
  - **Rechnungs-Intro/outro:** geplant für Rich-Text analog Angebot via `react-pdf-html` (`invoice-pdf-cover-body.tsx` **Zeilen 18–21**).
  - **Angebote:** `react-pdf-html` für Intro/Outro (`AngebotPdfCoverBody.tsx` **Zeilen 10–11**).

---

## Empfehlung des Auditors

**Reuse vs. Neuentwicklung**

- **Stark wiederverwendbar:** `InvoicePdfCoverHeader` / `InvoicePdfCoverHeaderBrief`, `InvoicePdfFooter`, `pdf-styles.ts`, `pdf-layout-constants.ts`, `InvoicePdfBrandingBlock` / `MetaGrid` / `RecipientBlock`, sowie das **Angebots-Pattern** für optionalen Tabellenblock und **HTML-Briefkörper** (`AngebotPdfCoverBody` + `react-pdf-html`).
- **Nicht sinnvoll 1:1:** `InvoicePdfCoverBody` für einen reinen Brief — er ist auf **Pflicht-Haupttabelle**, **MwSt.-Summen** und **Zahlungs-/QR-Block** zugeschnitten. Ein „LetterDocument“ sollte eher **einen schlanken Body** haben (Betreff, Anrede, Fließtext/HTML, ggf. kein QR) und nur Header/Footer teilen.

**Tabellen-optional**

- **Angebot-PDF:** bereits sauber optional.
- **Rechnungs-PDF:** Tabelle und Folgeblöcke sind **nicht** optional ohne Refactor. Für „Briefe“ sollte man **nicht** `InvoicePdfCoverBody` leeren, sondern eine **dedizierte Body-Komponente** oder eine klar abgegrenzte „mode“-API einführen.

**Risiken / Blocker**

- **`src/types/database.types.ts`** scheint **hinter den Migrationen** zurückzubleiben — vor größeren DB-Features `bun run db:types` bzw. Pipeline abstimmen.
- **Brief-Modus + sekundärer Rechtsempfänger:** `InvoicePdfCoverHeaderBrief` rendert keinen Secondary-Block im Header (by design); für komplexe Rechnungs-Szenarien ist das geklärt — für allgemeine „Briefe“ irrelevant.
- Produkt/Orchestration: „Briefe“ unter **Account** vs. **Abrechnung** — beides technisch machbar; Abrechnung bündelt bereits PDF-/Vorlagen-Domain.

**Empfohlene DB-Strategie**

- **Eigene Tabelle `briefe` (oder `letters`)** mit `company_id`, Status, Nummer, Empfängerfeldern und Body — analog **`angebote`**, aber **ohne** `angebot_line_items`, sofern bewusst tabellenfrei.
- Eine **polymorphe `documents`-Tabelle mit `type`** lohnt sich erst bei vielen gemeinsamen Queries/Reports; aktuell sind Rechnung und Angebot **zu unterschiedlich** (Line Items, Steuern, Storno, §14), sodass ein gemeinsames Modell eher **Komplexität** als **Vereinfachung** brächte.

---

*Audit durchgeführt als Read-Only; keine Code-Änderungen außer dieser Datei.*
