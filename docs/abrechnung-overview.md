# Abrechnung overview (`/dashboard/abrechnung`)

## Purpose

The Abrechnung dashboard surfaces high-signal billing KPIs and the ten most
recently created invoices, with a quick action to mark **sent** invoices as
**paid** without opening the detail page.

## KPI definitions

All invoice KPIs are computed **client-side** in
`useAbrechnungKpis` over the full list returned by `useInvoices({})` (no
filters). If invoice volume grows beyond roughly **500 rows**, consider a
Supabase RPC that returns pre-aggregated counts and totals.

### Offene Rechnungen

Invoices with `status === 'sent'` whose derived due date is **not** before
today.

### Überfällig

Invoices with `status === 'sent'` where:

`addDays(parseISO(created_at), payment_due_days ?? 14) < startOfToday()`

There is no `due_date` column; due date is always derived from creation date
plus payment terms.

### Diesen Monat

Invoices whose `sent_at` falls in the current calendar month
(`isSameMonth(parseISO(sent_at), new Date())`). If `sent_at` is null,
`created_at` is used instead.

### Angebote ausstehend

Count of rows in the Angebote list with `status === 'sent'`.

## Quick-pay (recent table)

For rows with `status === 'sent'`, the checkmark button calls
`useUpdateInvoiceStatus(invoiceId)` with `'paid'`. The shared hook applies an
**optimistic** patch to every cached invoice list query (`['invoices','list',…]`)
and rolls back on error; `onSettled` invalidates `invoiceKeys.all` so server
state is reconciled.

## Deep links to the invoice list

KPI cards navigate to `/dashboard/invoices` with query parameters:

- Offen: `?status=sent&bucket=open`
- Überfällig: `?status=sent&bucket=overdue`
- Diesen Monat: `?bucket=this_month`

`InvoiceListTable` reads these once on mount and maps them to
`InvoiceListFilter.kpi_bucket` plus `status` where applicable.
