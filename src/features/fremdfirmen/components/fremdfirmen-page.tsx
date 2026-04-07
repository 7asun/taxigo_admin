'use client';

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
import { useFremdfirmenAdmin } from '@/features/fremdfirmen/hooks/use-fremdfirmen-admin';
import { fremdfirmaPaymentModeLabel } from '@/features/fremdfirmen/lib/fremdfirma-payment-mode-labels';
import type { FremdfirmaRow } from '@/features/fremdfirmen/api/fremdfirmen.service';
import { FremdfirmaFormDialog } from '@/features/fremdfirmen/components/fremdfirma-form-dialog';

export function FremdfirmenPage() {
  const {
    data: rows,
    isLoading,
    error,
    createFremdfirma,
    updateFremdfirma,
    isCreating,
    isUpdating,
    refetch
  } = useFremdfirmenAdmin();
  const [q, setQ] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FremdfirmaRow | null>(null);

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter(
      (r) =>
        r.name.toLowerCase().includes(t) ||
        (r.number?.toLowerCase().includes(t) ?? false)
    );
  }, [rows, q]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (r: FremdfirmaRow) => {
    setEditing(r);
    setDialogOpen(true);
  };

  return (
    <div className='mx-auto w-full max-w-5xl flex-1 space-y-6 pb-10'>
      <div className='flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
        <div>
          <h2 className='text-3xl font-bold tracking-tight'>Fremdfirmen</h2>
          <p className='text-muted-foreground mt-1'>
            Externe Partner für ausgelagerte Fahrten — Zuweisung in der
            Fahrtmaske.
          </p>
        </div>
        <Button onClick={openCreate} className='shrink-0 gap-2'>
          <Plus className='h-4 w-4' />
          Neue Fremdfirma
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
            <p className='text-destructive text-sm'>
              Fremdfirmen konnten nicht geladen werden.
            </p>
          ) : filtered.length === 0 ? (
            <div className='text-muted-foreground py-16 text-center text-sm'>
              {q ? 'Keine Treffer.' : 'Noch keine Fremdfirmen angelegt.'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Nummer</TableHead>
                  <TableHead>Standard-Abrechnung</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='w-[100px]' />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className='font-medium'>{r.name}</TableCell>
                    <TableCell className='text-muted-foreground'>
                      {r.number ?? '—'}
                    </TableCell>
                    <TableCell>
                      {fremdfirmaPaymentModeLabel(r.default_payment_mode)}
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
                        type='button'
                        variant='ghost'
                        size='icon'
                        className='h-8 w-8'
                        onClick={() => openEdit(r)}
                        aria-label='Bearbeiten'
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

      <FremdfirmaFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => void refetch()}
        createFremdfirma={createFremdfirma}
        updateFremdfirma={updateFremdfirma}
        isSaving={isCreating || isUpdating}
      />
    </div>
  );
}
