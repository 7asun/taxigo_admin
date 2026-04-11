'use client';

/**
 * Central pricing catalog. Data from `useAllPricingRules` (company-scoped). All filtering is
 * client-side — rule count per company is bounded and never requires server-side pagination.
 */

import { useMemo, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  pricingRuleRowToScope,
  type BillingPricingRuleWithContext,
  type PricingRuleScopeLevel
} from '@/features/payers/api/billing-pricing-rules.api';
import { PRICING_STRATEGY_LABELS_DE } from '@/features/invoices/lib/pricing-strategy-labels-de';
import {
  PRICING_STRATEGIES,
  type PricingStrategy
} from '@/features/invoices/types/pricing.types';
import {
  formatPricingRuleConfigSummary,
  isPricingStrategy
} from '@/features/payers/lib/format-pricing-rule-config-summary';
import {
  invalidatePricingRuleCaches,
  useAllPricingRules
} from '@/features/payers/hooks/use-all-pricing-rules';
import { PricingRuleDialog } from '@/features/payers/components/pricing-rule-dialog';
import { toast } from 'sonner';
import type { ClientForPricing } from '@/features/clients/api/clients-pricing.api';
import { clientDisplayName } from '@/features/clients/lib/client-display-name';
import {
  useClientsForPricing,
  useSetClientPriceTag
} from '@/features/clients/hooks/use-clients-for-pricing';
import { referenceKeys } from '@/query/keys/reference';

const LEVEL_FILTER_ALL = 'all' as const;
const LEVEL_FILTER_CLIENT = 'client' as const;
const STRATEGY_FILTER_ALL = 'all' as const;

type PricingRow =
  | { kind: 'rule'; data: BillingPricingRuleWithContext }
  | { kind: 'client'; data: ClientForPricing };

const SCOPE_LEVEL_LABELS: Record<PricingRuleScopeLevel, string> = {
  payer: 'Kostenträger',
  billing_type: 'Familie',
  billing_variant: 'Unterart'
};

export function PricingRulesPage() {
  const qc = useQueryClient();
  const eur = useMemo(
    () =>
      new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }),
    []
  );
  const {
    data: rows = [],
    isLoading,
    error,
    deleteRule,
    refetch
  } = useAllPricingRules();

  const { data: clients = [], isLoading: clientsLoading } =
    useClientsForPricing();

  const { mutateAsync: setClientPriceTag } = useSetClientPriceTag();

  const [scopeFilter, setScopeFilter] = useState<
    typeof LEVEL_FILTER_ALL | typeof LEVEL_FILTER_CLIENT | PricingRuleScopeLevel
  >(LEVEL_FILTER_ALL);
  const [strategyFilter, setStrategyFilter] = useState<
    typeof STRATEGY_FILTER_ALL | PricingStrategy
  >(STRATEGY_FILTER_ALL);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BillingPricingRuleWithContext | null>(
    null
  );
  const [dialogInitialStrategy, setDialogInitialStrategy] = useState<
    PricingStrategy | undefined
  >(undefined);
  const [dialogInitialClientId, setDialogInitialClientId] = useState<
    string | null
  >(null);

  const allRows: PricingRow[] = useMemo(
    () => [
      ...rows.map((r) => ({ kind: 'rule' as const, data: r })),
      ...clients
        .filter((c) => c.price_tag != null)
        .map((c) => ({ kind: 'client' as const, data: c }))
    ],
    [rows, clients]
  );

  // Scope → strategy (rules only) → search (breadcrumb / Fahrgastname)
  const filtered = useMemo(() => {
    let list = allRows;
    list = list.filter((row) => {
      if (row.kind === 'client') {
        return (
          scopeFilter === LEVEL_FILTER_ALL ||
          scopeFilter === LEVEL_FILTER_CLIENT
        );
      }
      if (scopeFilter === LEVEL_FILTER_CLIENT) return false;
      if (scopeFilter === LEVEL_FILTER_ALL) return true;
      return row.data.scope_level === scopeFilter;
    });
    if (strategyFilter !== STRATEGY_FILTER_ALL) {
      list = list.filter((row) => {
        if (row.kind === 'client') return true;
        return row.data.strategy === strategyFilter;
      });
    }
    const t = search.trim().toLowerCase();
    if (t) {
      list = list.filter((row) => {
        if (row.kind === 'client') {
          return clientDisplayName(row.data).toLowerCase().includes(t);
        }
        return row.data.breadcrumb.toLowerCase().includes(t);
      });
    }
    return list;
  }, [allRows, scopeFilter, strategyFilter, search]);

  const tableLoading = isLoading || clientsLoading;

  const handleSaved = () => {
    invalidatePricingRuleCaches(qc);
    void qc.invalidateQueries({ queryKey: referenceKeys.clients() });
    void refetch();
  };

  const openNewRule = () => {
    setEditing(null);
    setDialogInitialStrategy(undefined);
    setDialogInitialClientId(null);
    setDialogOpen(true);
  };

  const openClientPriceEditor = (clientId: string) => {
    setEditing(null);
    setDialogInitialStrategy('client_price_tag');
    setDialogInitialClientId(clientId);
    setDialogOpen(true);
  };

  return (
    <div className='mx-auto w-full max-w-6xl flex-1 space-y-6 pb-10'>
      <div className='flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
        <div>
          <h2 className='text-3xl font-bold tracking-tight'>Preisregeln</h2>
          <p className='text-muted-foreground mt-1'>
            Alle Preisregeln je Kostenträger, Familie und Unterart — zentral
            bearbeiten.
          </p>
        </div>
        <Button onClick={() => openNewRule()} className='shrink-0 gap-2'>
          <Plus className='h-4 w-4' />
          Neu Preisregel
        </Button>
      </div>

      <div className='space-y-4'>
        <div className='flex flex-wrap items-center gap-2'>
          <Select
            value={scopeFilter}
            onValueChange={(v) => {
              if (v === LEVEL_FILTER_ALL) setScopeFilter(LEVEL_FILTER_ALL);
              else if (v === LEVEL_FILTER_CLIENT)
                setScopeFilter(LEVEL_FILTER_CLIENT);
              else setScopeFilter(v as PricingRuleScopeLevel);
            }}
          >
            <SelectTrigger className='h-8 w-auto min-w-[140px] text-sm'>
              <SelectValue placeholder='Alle Ebenen' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={LEVEL_FILTER_ALL}>Alle Ebenen</SelectItem>
              <SelectItem value='payer'>Kostenträger</SelectItem>
              <SelectItem value='billing_type'>Familie</SelectItem>
              <SelectItem value='billing_variant'>Unterart</SelectItem>
              <SelectItem value={LEVEL_FILTER_CLIENT}>Fahrgast</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={strategyFilter}
            onValueChange={(v) =>
              setStrategyFilter(
                v === STRATEGY_FILTER_ALL
                  ? STRATEGY_FILTER_ALL
                  : (v as PricingStrategy)
              )
            }
          >
            <SelectTrigger className='h-8 w-auto min-w-[140px] text-sm'>
              <SelectValue placeholder='Alle Strategien' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={STRATEGY_FILTER_ALL}>
                Alle Strategien
              </SelectItem>
              {PRICING_STRATEGIES.map((s) => (
                <SelectItem key={s} value={s}>
                  {PRICING_STRATEGY_LABELS_DE[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className='h-8 w-[200px] text-sm'
            placeholder='Suchen…'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className='text-muted-foreground ml-auto text-xs'>
            {filtered.length} Eintrag{filtered.length !== 1 ? 'e' : ''}
          </span>
        </div>

        <div className='min-h-[320px] overflow-x-auto rounded-lg border'>
          {tableLoading ? (
            <div className='space-y-2 p-4'>
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className='h-10 w-full' />
              ))}
            </div>
          ) : error ? (
            <div className='p-4'>
              <p className='text-destructive text-sm'>Laden fehlgeschlagen.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className='flex flex-col items-center gap-4 py-16 text-center'>
              <p className='text-muted-foreground max-w-md text-sm'>
                {allRows.length === 0
                  ? 'Noch keine Preisregeln oder Kunden-Preise. Legen Sie Regeln oder Fahrgast-Preise an — ohne in jeden Kostenträger springen zu müssen.'
                  : 'Keine Treffer für die aktuellen Filter.'}
              </p>
              {allRows.length === 0 && (
                <Button className='gap-2' onClick={() => openNewRule()}>
                  <Plus className='h-4 w-4' />
                  Neue Regel erstellen
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-[120px] py-2'>Ebene</TableHead>
                  <TableHead className='py-2'>Zugeordnet zu</TableHead>
                  <TableHead className='w-[200px] py-2'>
                    Strategie & Status
                  </TableHead>
                  <TableHead className='py-2'>Konfiguration</TableHead>
                  <TableHead className='w-10 py-2' />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) =>
                  row.kind === 'client' ? (
                    <TableRow key={`client-${row.data.id}`}>
                      <TableCell className='py-2 align-top'>
                        <Badge
                          variant='outline'
                          className='text-xs whitespace-nowrap'
                        >
                          Fahrgast
                        </Badge>
                      </TableCell>
                      <TableCell className='py-2 align-top'>
                        <span className='text-sm font-medium'>
                          {clientDisplayName(row.data)}
                        </span>
                      </TableCell>
                      <TableCell className='py-2 align-top'>
                        <span className='text-sm'>Kunden-Preis</span>
                      </TableCell>
                      <TableCell className='py-2 align-top'>
                        <span className='text-muted-foreground font-mono text-xs'>
                          {row.data.price_tag != null
                            ? `${eur.format(row.data.price_tag)} brutto`
                            : '—'}
                        </span>
                      </TableCell>
                      <TableCell className='w-10 py-2 text-right align-top'>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant='ghost'
                              size='icon'
                              className='h-8 w-8'
                            >
                              <MoreHorizontal className='h-4 w-4' />
                              <span className='sr-only'>Aktionen</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end'>
                            <DropdownMenuItem
                              onSelect={() =>
                                openClientPriceEditor(row.data.id)
                              }
                            >
                              Bearbeiten
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className='text-destructive focus:text-destructive'
                              onSelect={() => {
                                if (
                                  !window.confirm(
                                    'Kunden-Preis wirklich entfernen?'
                                  )
                                ) {
                                  return;
                                }
                                void setClientPriceTag({
                                  clientId: row.data.id,
                                  price: null
                                })
                                  .then(() => {
                                    toast.success('Kunden-Preis entfernt');
                                  })
                                  .catch(() => {
                                    toast.error('Entfernen fehlgeschlagen');
                                  });
                              }}
                            >
                              Preis entfernen
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={row.data.id}>
                      <TableCell className='py-2 align-top'>
                        <Badge
                          variant='outline'
                          className='text-xs whitespace-nowrap'
                        >
                          {SCOPE_LEVEL_LABELS[row.data.scope_level]}
                        </Badge>
                      </TableCell>
                      <TableCell className='py-2 align-top'>
                        <div className='flex flex-col gap-0.5'>
                          {row.data.breadcrumb.split(' › ').map((part, idx) => (
                            <span
                              key={`${row.data.id}-bc-${idx}`}
                              className={
                                idx === 0
                                  ? 'text-sm font-medium'
                                  : 'text-muted-foreground pl-3 text-xs'
                              }
                            >
                              {idx > 0 ? '↳ ' : ''}
                              {part}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className='py-2 align-top'>
                        <div className='flex flex-col gap-1'>
                          <span className='text-sm'>
                            {isPricingStrategy(row.data.strategy)
                              ? PRICING_STRATEGY_LABELS_DE[row.data.strategy]
                              : row.data.strategy}
                          </span>
                          <Badge
                            variant={
                              row.data.is_active ? 'secondary' : 'outline'
                            }
                            className='w-fit text-xs'
                          >
                            {row.data.is_active ? 'Aktiv' : 'Inaktiv'}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className='text-muted-foreground max-w-[180px] truncate py-2 align-top font-mono text-xs'>
                        {isPricingStrategy(row.data.strategy)
                          ? formatPricingRuleConfigSummary(
                              row.data.strategy,
                              row.data.config
                            )
                          : '—'}
                      </TableCell>
                      <TableCell className='w-10 py-2 text-right align-top'>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant='ghost'
                              size='icon'
                              className='h-8 w-8'
                            >
                              <MoreHorizontal className='h-4 w-4' />
                              <span className='sr-only'>Aktionen</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end'>
                            <DropdownMenuItem
                              onSelect={() => {
                                setEditing(row.data);
                                setDialogInitialStrategy(undefined);
                                setDialogInitialClientId(null);
                                setDialogOpen(true);
                              }}
                            >
                              Bearbeiten
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className='text-destructive focus:text-destructive'
                              onSelect={() => void deleteRule(row.data.id)}
                            >
                              Löschen
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <PricingRuleDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) {
            setEditing(null);
            setDialogInitialStrategy(undefined);
            setDialogInitialClientId(null);
          }
        }}
        scope={editing ? pricingRuleRowToScope(editing) : null}
        editing={editing}
        onSaved={handleSaved}
        initialStrategy={dialogInitialStrategy}
        initialClientId={dialogInitialClientId}
      />
    </div>
  );
}
