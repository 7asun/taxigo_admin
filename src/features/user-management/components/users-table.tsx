'use client';

import { Icons } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTableSkeleton } from '@/components/ui/table/data-table-skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  useUpdateStatus,
  useUsers
} from '@/features/user-management/api/users.service';
import type { CompanyUser } from '@/features/user-management/types';
import { createClient } from '@/lib/supabase/client';
import { IconEdit, IconUserCheck, IconUserOff } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EditCredentialsDialog } from '@/features/user-management/components/edit-credentials-dialog';

function formatName(row: CompanyUser): string {
  const parts = [row.last_name, row.first_name].filter(
    (p) => p && String(p).trim()
  ) as string[];
  if (parts.length > 0) {
    return parts.join(', ');
  }
  return row.name;
}

export function UsersTable() {
  const { data: users, isLoading, isError, error } = useUsers();
  const updateStatus = useUpdateStatus();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [editUser, setEditUser] = useState<CompanyUser | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (!cancelled && user) {
        setCurrentUserId(user.id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggleStatus(user: CompanyUser) {
    const next = !user.is_active;
    try {
      await updateStatus.mutateAsync({ id: user.id, is_active: next });
      toast.success(
        next ? 'Benutzer wurde reaktiviert.' : 'Benutzer wurde deaktiviert.'
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Status konnte nicht geändert werden'
      );
    }
  }

  if (isLoading) {
    return <DataTableSkeleton columnCount={5} rowCount={8} filterCount={0} />;
  }

  if (isError) {
    return (
      <div className='text-destructive text-sm' role='alert'>
        {error?.message ?? 'Benutzer konnten nicht geladen werden.'}
      </div>
    );
  }

  const rows = users ?? [];

  if (rows.length === 0) {
    return (
      <div className='text-muted-foreground flex flex-col items-center justify-center gap-3 py-16 text-center'>
        <Icons.teams className='size-12 opacity-40' aria-hidden />
        <p className='text-sm font-medium'>Keine Benutzer gefunden</p>
      </div>
    );
  }

  return (
    <>
      <div className='rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>E-Mail</TableHead>
              <TableHead>Rolle</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className='text-right'>Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u) => {
              const isSelf = currentUserId != null && u.id === currentUserId;
              return (
                <TableRow key={u.id}>
                  <TableCell className='font-medium'>{formatName(u)}</TableCell>
                  <TableCell className='text-muted-foreground text-sm'>
                    {u.email ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant='secondary'>
                      {u.role === 'admin' ? 'Admin' : 'Fahrer'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.is_active ? 'default' : 'outline'}>
                      {u.is_active ? 'Aktiv' : 'Inaktiv'}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-right'>
                    <div className='flex justify-end gap-1'>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        className='size-8'
                        title='Zugangsdaten bearbeiten'
                        onClick={() => {
                          setEditUser(u);
                          setDialogOpen(true);
                        }}
                      >
                        <IconEdit className='size-4' />
                        <span className='sr-only'>Zugangsdaten bearbeiten</span>
                      </Button>
                      {!isSelf ? (
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon'
                          className='size-8'
                          disabled={updateStatus.isPending}
                          title={
                            u.is_active
                              ? 'Benutzer deaktivieren'
                              : 'Reaktivieren'
                          }
                          onClick={() => void handleToggleStatus(u)}
                        >
                          {u.is_active ? (
                            <IconUserOff className='size-4' />
                          ) : (
                            <IconUserCheck className='size-4' />
                          )}
                          <span className='sr-only'>
                            {u.is_active ? 'Deaktivieren' : 'Reaktivieren'}
                          </span>
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <EditCredentialsDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditUser(null);
          }
        }}
        user={editUser}
      />
    </>
  );
}
