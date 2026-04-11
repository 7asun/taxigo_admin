'use client';

/**
 * Admin-CRUD für den Rechnungsempfänger-Katalog (`/dashboard/abrechnung/rechnungsempfaenger`).
 * Cache: `useRechnungsempfaengerAdmin` + Invalidierung von `referenceKeys.rechnungsempfaenger()`.
 */

import { useMemo, useState } from 'react';
import { Pencil, Plus, Search } from 'lucide-react';
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
import { useRechnungsempfaengerAdmin } from '../hooks/use-rechnungsempfaenger-admin';
import type { RechnungsempfaengerRow } from '../types';
import { RechnungsempfaengerFormDialog } from './rechnungsempfaenger-form-dialog';

export function RechnungsempfaengerPage() {
  const {
    data: rows,
    isLoading,
    error,
    createRecipient,
    updateRecipient,
    deleteRecipient,
    isCreating,
    isUpdating,
    isDeleting,
    refetch
  } = useRechnungsempfaengerAdmin();
  const [q, setQ] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RechnungsempfaengerRow | null>(null);

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter(
      (r) =>
        r.name.toLowerCase().includes(t) ||
        (r.city?.toLowerCase().includes(t) ?? false) ||
        (r.postal_code?.toLowerCase().includes(t) ?? false)
    );
  }, [rows, q]);

  return (
    <div className='mx-auto w-full max-w-5xl flex-1 space-y-6 pb-10'>
      <div className='flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
        <div>
          <h2 className='text-3xl font-bold tracking-tight'>
            Rechnungsempfänger
          </h2>
          <p className='text-muted-foreground mt-1'>
            Katalog für Rechnungsadressen — Zuweisung je Kostenträger, Familie
            oder Unterart.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
          className='shrink-0 gap-2'
        >
          <Plus className='h-4 w-4' />
          Neuer Eintrag
        </Button>
      </div>

      <div className='bg-card overflow-hidden rounded-xl border shadow-sm'>
        <div className='bg-muted/20 border-b p-4'>
          <div className='relative max-w-md'>
            <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
            <Input
              placeholder='Suchen…'
              className='bg-background pl-9'
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        <div className='bg-background min-h-[320px] p-4'>
          {isLoading ? (
            <div className='space-y-2'>
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className='h-10 w-full' />
              ))}
            </div>
          ) : error ? (
            <p className='text-destructive text-sm'>Laden fehlgeschlagen.</p>
          ) : filtered.length === 0 ? (
            <div className='text-muted-foreground py-16 text-center text-sm'>
              {q ? 'Keine Treffer.' : 'Noch keine Einträge.'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Ort</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='w-[100px]' />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className='font-medium'>{r.name}</TableCell>
                    <TableCell className='text-muted-foreground text-sm'>
                      {[r.postal_code, r.city].filter(Boolean).join(' ') || '—'}
                    </TableCell>
                    <TableCell>
                      {r.is_active ? (
                        <Badge variant='secondary'>Aktiv</Badge>
                      ) : (
                        <Badge variant='outline'>Inaktiv</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant='ghost'
                        size='icon'
                        onClick={() => {
                          setEditing(r);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil className='h-4 w-4' />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <RechnungsempfaengerFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => void refetch()}
        onDeleted={() => void refetch()}
        createRecipient={createRecipient}
        updateRecipient={updateRecipient}
        deleteRecipient={deleteRecipient}
        isSaving={isCreating || isUpdating}
        isDeleting={isDeleting}
      />
    </div>
  );
}
