/**
 * useAbrechnungKpis
 *
 * Derives four billing KPIs from the full invoice + Angebote lists.
 * All computation is client-side over the fetched lists (no server aggregate
 * endpoint exists). If invoice volume grows beyond ~500 rows, replace with
 * a dedicated Supabase RPC that returns pre-aggregated values.
 *
 * KPI definitions:
 *
 *  openCount / openTotal:
 *    Invoices where status === 'sent' AND NOT overdue.
 *
 *  overdueCount / overdueTotal:
 *    Invoices where status === 'sent' AND
 *    addDays(parseISO(inv.created_at), inv.payment_due_days ?? 14) < startOfToday().
 *    (No due_date column exists — derive from created_at + payment_due_days.)
 *
 *  thisMonthCount / thisMonthTotal:
 *    Invoices where sent_at is within the current calendar month
 *    (isSameMonth(parseISO(inv.sent_at), new Date())).
 *    Falls back to created_at if sent_at is null.
 *
 *  pendingAngeboteCount:
 *    Angebote where status === 'sent'.
 *
 * Uses existing hooks:
 *   useInvoices() — from src/features/invoices/hooks/use-invoices.ts
 *   useAngeboteList — from src/features/angebote/hooks/use-angebote.ts
 *
 * Returns totals as number (euros) — matches InvoiceRow.total (Brutto).
 */

'use client';

import { useMemo } from 'react';
import {
  addDays,
  isBefore,
  isSameMonth,
  parseISO,
  startOfToday
} from 'date-fns';

import { useAngeboteList } from '@/features/angebote/hooks/use-angebote';
import { useInvoices } from '@/features/invoices/hooks/use-invoices';

export interface AbrechnungKpis {
  openCount: number;
  openTotal: number;
  overdueCount: number;
  overdueTotal: number;
  thisMonthCount: number;
  thisMonthTotal: number;
  pendingAngeboteCount: number;
  isLoading: boolean;
}

export function useAbrechnungKpis(): AbrechnungKpis {
  const { invoices, isLoading: invLoading } = useInvoices({});
  const { data: angebote = [], isLoading: angLoading } = useAngeboteList();

  return useMemo(() => {
    const today = startOfToday();
    const now = new Date();
    let openCount = 0;
    let openTotal = 0;
    let overdueCount = 0;
    let overdueTotal = 0;
    let thisMonthCount = 0;
    let thisMonthTotal = 0;

    for (const inv of invoices ?? []) {
      const due = addDays(parseISO(inv.created_at), inv.payment_due_days ?? 14);
      const overdue = inv.status === 'sent' && isBefore(due, today);
      if (inv.status === 'sent' && !overdue) {
        openCount += 1;
        openTotal += inv.total ?? 0;
      }
      if (inv.status === 'sent' && overdue) {
        overdueCount += 1;
        overdueTotal += inv.total ?? 0;
      }
      const sentRef = inv.sent_at ?? inv.created_at;
      if (isSameMonth(parseISO(sentRef), now)) {
        thisMonthCount += 1;
        thisMonthTotal += inv.total ?? 0;
      }
    }

    const pendingAngeboteCount = angebote.filter(
      (a) => a.status === 'sent'
    ).length;

    return {
      openCount,
      openTotal,
      overdueCount,
      overdueTotal,
      thisMonthCount,
      thisMonthTotal,
      pendingAngeboteCount,
      isLoading: invLoading || angLoading
    };
  }, [invoices, angebote, invLoading, angLoading]);
}
