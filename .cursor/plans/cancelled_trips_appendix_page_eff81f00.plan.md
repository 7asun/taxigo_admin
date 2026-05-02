---
name: Cancelled trips appendix page
overview: Move cancelled-trip PDF output from [`invoice-pdf-cover-body.tsx`](src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx) to a dumb [`invoice-pdf-appendix.tsx`](src/features/invoices/components/invoice-pdf/invoice-pdf-appendix.tsx) section on a dedicated final appendix [`Page`](src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx), gated in the document parent; add `cancelledTripAppendixCell`, `getCanceledReasonNote` (`CancelledTripRow.canceled_reason_notes` — identical spelling to DB `trips.canceled_reason_notes`), appendix sub-lines per row; preserve billing paths and blank-appendix parity when no cancelled rows.
todos:
  - id: step1-cover
    content: Remove cancelled trips from invoice-pdf-cover-body (props, block, imports); bun run build
    status: completed
  - id: step2-appendix-cells
    content: Extend CancelledTripRow + fetchCancelledTripsForBuilder selects canceled_reason_notes; appendix cells with cancelledTripAppendixCell + getCanceledReasonNote; disposition main-cells/tests; bun run build
    status: completed
  - id: step3-appendix-ui
    content: "invoice-pdf-appendix: cancelledTrips prop, renderCancelledSection + per-row status + Stornierungsgrund (getCanceledReasonNote); no fixed on subsection; bun run build"
    status: completed
  - id: step4-document
    content: "InvoicePdfDocument: gate scoped array, billed appendix cancelledTrips=[], dedicated Page after appendix ternary + footer + comments; bun run build && bun test"
    status: completed
  - id: step5-docs
    content: Update docs/invoices-module.md, cancelled-trips-appendix-audit.md Implemented; finalize inline why comments
    status: completed
isProject: false
---

