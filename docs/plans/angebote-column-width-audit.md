# PDF column width audit — Angebote

## 1. Current preset fixed widths (COLUMN_PRESET_SPECS)

| preset | mode | pt | flex |
|---|---|---:|---:|
| beschreibung | fill |  |  |
| betrag | fixed | 80 |  |
| preis_km | fixed | 80 |  |
| notiz | auto |  | 2 |
| anzahl | fixed | 48 |  |
| percent | fixed | 60 |  |

## 2. ANGEBOT_POSITION_COLUMN resolved width

- preset: anzahl
- mode: fixed
- pt: 48

## 3. Full width simulation — default 5-column template (+ injected Pos.)

Columns (in effectiveColumns order):

- col_position → anzahl (fixed 48)
- col_leistung → beschreibung (fill)
- col_anfahrtkosten → betrag (fixed 80)
- col_price_first_5km → preis_km (fixed 80)
- col_price_per_km_after_5 → preis_km (fixed 80)
- col_notes → notiz (auto flex 2)

calcAngebotColumnWidths inputs:

- ANGEBOT_PDF_AVAILABLE_WIDTH: 515
- minFloor: 20

Fixed total (including Pos.):

- 48 + 80 + 80 + 80 = 288

Remaining after fixed:

- 515 − 288 = 227

Fill columns resolved width:

- fill column count: 1
- col_leistung: 227

Auto columns resolved width (before minFloor clamp):

- remaining-after-fill: 0
- col_notes: (2 / 2) × 0 = 0

Final width map (after Step 8 minFloor clamp):

- col_position: 48
- col_leistung: 227
- col_anfahrtkosten: 80
- col_price_first_5km: 80
- col_price_per_km_after_5: 80
- col_notes: 20

Sum confirmation:

- 48 + 227 + 80 + 80 + 80 + 20 = 535
- equals 515: no

## 4. Cell padding

In `AngebotPdfCoverBody.tsx`:

- header cell wrapper View: paddingRight = 4, paddingLeft = 0
- data cell wrapper View: paddingRight = 4, paddingLeft = 0
- symmetric left/right: no

Total horizontal padding across all 6 columns (paddingLeft + paddingRight per cell, summed across 6 columns):

- (0 + 4) × 6 = 24

## 5. The Notiz problem

- notiz (col_notes) resolves to 20
- reason: fixed columns consume 288 and the single fill column consumes the full remaining 227, leaving 0 for auto columns before the minFloor clamp
