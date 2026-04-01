/**
 * pdf-styles.ts
 *
 * All @react-pdf/renderer StyleSheet definitions for the invoice PDF.
 *
 * Design principle: ALL styling is centralized here.
 * To retheme the PDF (fonts, colors, spacing) edit ONLY this file.
 *
 * Color policy: use hex values matching the design system's neutral palette.
 * No theme CSS vars are available in @react-pdf (it renders server-side to PDF).
 *
 * Font: Helvetica (built-in to @react-pdf — no font loading needed)
 */

import { StyleSheet } from '@react-pdf/renderer';

/** Shared color palette for the PDF. Adjust here to retheme. */
export const PDF_COLORS = {
  /** Primary text color */
  text: '#0f172a',
  /** Muted / secondary text */
  muted: '#64748b',
  /** Light gray background for header and alternating rows */
  lightGray: '#f8fafc',
  /** Border color for table lines */
  border: '#e2e8f0',
  /** Primary brand accent. */
  primary: '#1e40af',
  /** Soft accent background for emphasis rows */
  accent: '#dbeafe',
  /** White */
  white: '#ffffff'
} as const;

/** Font sizes in pt. */
export const PDF_FONT_SIZES = {
  xs: 7,
  sm: 8,
  base: 9,
  md: 10,
  lg: 12,
  xl: 15,
  xxl: 20
} as const;

export const styles = StyleSheet.create({
  // ── Document / Page ────────────────────────────────────────────────────────
  // DIN 5008: ~20 mm oberer Rand; Empfängeranschrift erste Zeile ~50 mm vom Blattanfang
  page: {
    fontFamily: 'Helvetica',
    fontSize: PDF_FONT_SIZES.base,
    color: PDF_COLORS.text,
    paddingTop: 57,
    paddingBottom: 96,
    paddingLeft: 45,
    paddingRight: 45,
    lineHeight: 1.45
  },

  // ── Kopf: Logo, Slogan darunter (links) | Meta + Steuer rechts; Absenderzeile; Empfänger (Fenster)
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20
  },
  headerLeft: {
    width: '52%',
    paddingRight: 10
  },
  headerRight: {
    width: '44%',
    alignItems: 'stretch',
    paddingTop: 14
  },
  /** Logo oben, Slogan direkt darunter (nicht daneben) */
  brandStack: {
    marginBottom: 10,
    width: '100%'
  },
  sloganBelowLogo: {
    fontSize: PDF_FONT_SIZES.sm,
    color: PDF_COLORS.muted,
    lineHeight: 1.4,
    marginTop: 5,
    maxWidth: 260
  },
  rightTaxLine: {
    fontSize: PDF_FONT_SIZES.xs,
    color: PDF_COLORS.muted,
    textAlign: 'right',
    marginTop: 0,
    marginBottom: 1
  },
  /** DIN: kompakte Absenderzeile (fontSize dynamisch via fitSenderLine) */
  senderOneLine: {
    color: PDF_COLORS.muted,
    borderBottomWidth: 0.4,
    borderBottomColor: PDF_COLORS.border,
    paddingBottom: 3,
    marginBottom: 8,
    lineHeight: 1.35
  },
  recipientBlock: {
    width: '100%',
    marginTop: 4
  },
  addressCompanySecondary: {
    fontSize: PDF_FONT_SIZES.base,
    color: PDF_COLORS.text,
    marginBottom: 2
  },
  addressBlock: {
    width: '100%'
  },
  rightTaxBlock: {
    alignItems: 'flex-end',
    paddingTop: 2
  },
  addressCompanyName: {
    fontSize: PDF_FONT_SIZES.md,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2
  },
  addressPersonName: {
    fontSize: PDF_FONT_SIZES.base,
    color: PDF_COLORS.text,
    marginBottom: 4
  },
  addressLine: {
    fontSize: PDF_FONT_SIZES.base,
    color: PDF_COLORS.text,
    marginBottom: 2
  },

  // ── Logo (links oben im Kopf, nicht absolut)
  logoLeft: {
    width: 100,
    height: 48,
    objectFit: 'contain'
  },

  metaContainer: {
    width: '100%',
    marginTop: 0,
    backgroundColor: '#f8fafc',
    borderWidth: 0.8,
    borderColor: PDF_COLORS.border,
    borderRadius: 6,
    paddingVertical: 9,
    paddingHorizontal: 10
  },
  metaHeading: {
    fontSize: PDF_FONT_SIZES.xs,
    color: PDF_COLORS.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 1
  },
  metaItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 0,
    paddingVertical: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e5edf6'
  },
  metaItemLast: {
    borderBottomWidth: 0,
    paddingBottom: 0
  },
  metaLabel: {
    fontSize: PDF_FONT_SIZES.xs,
    color: PDF_COLORS.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    width: 92,
    paddingTop: 1,
    paddingRight: 8
  },
  metaValue: {
    fontSize: PDF_FONT_SIZES.sm,
    color: PDF_COLORS.text,
    flex: 1,
    textAlign: 'right',
    lineHeight: 1.35,
    maxWidth: '58%'
  },

  // ── Invoice title ──────────────────────────────────────────────────────────
  invoiceTitle: {
    fontSize: PDF_FONT_SIZES.xl,
    fontFamily: 'Helvetica-Bold',
    color: PDF_COLORS.primary,
    marginBottom: 4
  },
  invoiceNumber: {
    fontSize: PDF_FONT_SIZES.md,
    color: PDF_COLORS.muted,
    marginBottom: 20
  },

  subject: {
    fontSize: PDF_FONT_SIZES.lg,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 10
  },
  salutation: {
    fontSize: PDF_FONT_SIZES.base,
    marginBottom: 8,
    lineHeight: 1.5
  },
  bodyText: {
    fontSize: PDF_FONT_SIZES.base,
    lineHeight: 1.6,
    color: PDF_COLORS.text,
    marginBottom: 16
  },

  // ── Line items table ───────────────────────────────────────────────────────
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderBottomWidth: 1.5,
    borderBottomColor: '#94a3b8',
    paddingVertical: 6,
    paddingHorizontal: 8
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: PDF_COLORS.border
  },
  tableRowAlt: {
    backgroundColor: PDF_COLORS.lightGray
  },

  // Summary Table tweaks
  colQty: { width: '9%', fontSize: PDF_FONT_SIZES.sm, textAlign: 'center' },
  colRoute: { width: '55%', paddingRight: 8 },
  routePrimary: {
    fontSize: PDF_FONT_SIZES.sm,
    color: PDF_COLORS.text,
    lineHeight: 1.35
  },
  routeSecondary: {
    fontSize: PDF_FONT_SIZES.xs,
    color: PDF_COLORS.muted,
    lineHeight: 1.3,
    marginTop: 2
  },

  // Column widths (appendix widths must sum to 100%)
  colPos: { width: '5%', fontSize: PDF_FONT_SIZES.sm },
  colDate: { width: '10%', fontSize: PDF_FONT_SIZES.sm },
  colDesc: { width: '38%', paddingRight: 8 },
  colKm: { width: '8%', fontSize: PDF_FONT_SIZES.sm, textAlign: 'right' },
  colMwst: { width: '12%', fontSize: PDF_FONT_SIZES.sm, textAlign: 'right' },
  colTotal: { width: '19%', fontSize: PDF_FONT_SIZES.sm, textAlign: 'right' },
  colGross: { width: '16%', fontSize: PDF_FONT_SIZES.sm, textAlign: 'right' },

  tableHeaderText: {
    color: '#334155',
    fontSize: PDF_FONT_SIZES.sm,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.4
  },

  // ── Totals block ───────────────────────────────────────────────────────────
  totalsSection: {
    marginTop: 12,
    alignItems: 'flex-end'
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    width: '53%',
    paddingVertical: 3,
    paddingHorizontal: 8
  },
  totalsLabel: {
    fontSize: PDF_FONT_SIZES.sm,
    color: PDF_COLORS.muted,
    flex: 1,
    textAlign: 'right',
    paddingRight: 12
  },
  totalsValue: {
    fontSize: PDF_FONT_SIZES.sm,
    width: '35%',
    textAlign: 'right'
  },
  totalsDivider: {
    borderTopWidth: 1,
    borderTopColor: PDF_COLORS.border,
    width: '53%',
    marginVertical: 4,
    marginRight: 8
  },
  totalsGrandRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    width: '53%',
    backgroundColor: PDF_COLORS.accent,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 3
  },
  totalsGrandLabel: {
    fontSize: PDF_FONT_SIZES.md,
    fontFamily: 'Helvetica-Bold',
    flex: 1,
    textAlign: 'right',
    paddingRight: 12,
    color: PDF_COLORS.text
  },
  totalsGrandValue: {
    fontSize: PDF_FONT_SIZES.md,
    fontFamily: 'Helvetica-Bold',
    width: '35%',
    textAlign: 'right'
  },

  // ── Notes ──────────────────────────────────────────────────────────────────
  notesSection: {
    marginTop: 16,
    padding: 8,
    backgroundColor: PDF_COLORS.lightGray,
    borderRadius: 4
  },
  notesLabel: {
    fontSize: PDF_FONT_SIZES.xs,
    color: PDF_COLORS.muted,
    marginBottom: 4
  },
  notesText: {
    fontSize: PDF_FONT_SIZES.sm
  },

  // ── Payment Instructions ───────────────────────────────────────────────────
  paymentInstructions: {
    marginTop: 18,
    paddingTop: 12,
    paddingBottom: 2,
    borderTopWidth: 0.5,
    borderTopColor: PDF_COLORS.border
  },
  paymentContentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: 8
  },
  paymentTextCol: {
    flex: 1,
    minWidth: 200,
    paddingRight: 10
  },
  paymentQrWrap: {
    alignItems: 'center',
    marginLeft: 12,
    width: 113
  },
  /** ~40 mm — gut scannbar in Banking-Apps */
  paymentQr: {
    width: 113,
    height: 113
  },
  paymentDetailRow: {
    flexDirection: 'row',
    marginTop: 6,
    paddingLeft: 2
  },
  paymentLabel: {
    fontSize: PDF_FONT_SIZES.sm,
    fontFamily: 'Helvetica-Bold',
    color: PDF_COLORS.text,
    width: '32%'
  },
  paymentValue: {
    fontSize: PDF_FONT_SIZES.sm,
    color: PDF_COLORS.text,
    width: '68%'
  },
  boldText: {
    fontFamily: 'Helvetica-Bold',
    fontSize: PDF_FONT_SIZES.lg,
    color: PDF_COLORS.text,
    marginBottom: 4
  },
  normalText: {
    fontSize: PDF_FONT_SIZES.base,
    lineHeight: 1.5,
    color: PDF_COLORS.text
  },

  appendixHeaderFixed: {
    position: 'absolute',
    top: 57,
    left: 45,
    right: 45
  },
  appendixContentSpacer: {
    height: 94
  },

  // ── Header Top Right ───────────────────────────────────────────────────────
  topRightBlock: {
    alignItems: 'flex-end'
  },
  topRightText: {
    fontSize: PDF_FONT_SIZES.sm,
    color: PDF_COLORS.muted,
    marginBottom: 2
  },

  // ── Footer ─────────────────────────────────────────────────────────────────
  footer: {
    position: 'absolute',
    bottom: 38,
    left: 45,
    right: 45,
    borderTopWidth: 0.5,
    borderTopColor: PDF_COLORS.border,
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  footerCol: {
    flex: 1,
    paddingRight: 10
  },
  /** Dreispaltiger Fuß: gleiche Breite */
  footerColThird: {
    width: '32%',
    paddingRight: 8
  },
  footerKontaktHeading: {
    fontFamily: 'Helvetica-Bold',
    fontSize: PDF_FONT_SIZES.xs,
    color: PDF_COLORS.text,
    marginBottom: 3
  },
  footerNote: {
    fontSize: 6,
    color: PDF_COLORS.muted,
    marginTop: 4
  },
  footerText: {
    fontSize: PDF_FONT_SIZES.xs,
    color: PDF_COLORS.muted,
    marginBottom: 2
  },
  footerBold: {
    fontFamily: 'Helvetica-Bold',
    fontSize: PDF_FONT_SIZES.xs,
    color: PDF_COLORS.text,
    marginBottom: 2
  },
  footerPageNumber: {
    position: 'absolute',
    bottom: 16,
    left: 45,
    right: 45,
    fontSize: PDF_FONT_SIZES.xs,
    color: PDF_COLORS.muted,
    textAlign: 'center'
  }
});
