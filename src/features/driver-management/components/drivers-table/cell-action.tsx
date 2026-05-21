'use client';

/**
 * Row action dropdown for driver roster table: Edit, Credentials, Deactivate/Reactivate.
 */

import { AlertModal } from '@/components/modal/alert-modal';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useDriverFormStore } from '@/features/driver-management/stores/use-driver-form-store';
import type { DriverWithProfile } from '@/features/driver-management/types';
import { EditCredentialsDialog } from '@/features/driver-management/components/edit-credentials-dialog';
import { useUpdateStatus } from '@/features/driver-management/api/user-actions.service';
import type { CompanyUser } from '@/features/user-management/types';
import { createClient } from '@/lib/supabase/client';
import {
  IconDotsVertical,
  IconEdit,
  IconKey,
  IconUserCheck,
  IconUserOff
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface CellActionProps {
  data: DriverWithProfile;
}

function toCompanyUser(row: DriverWithProfile): CompanyUser {
  return {
    id: row.id,
    name: row.name,
    first_name: row.first_name ?? null,
    last_name: row.last_name ?? null,
    email: row.email ?? null,
    role: row.role,
    is_active: row.is_active,
    created_at: null,
    phone: row.phone ?? null
  };
}

export function CellAction({ data }: CellActionProps) {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const openForEdit = useDriverFormStore((s) => s.openForEdit);
  const updateStatus = useUpdateStatus();

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

  const isSelf = currentUserId != null && data.id === currentUserId;
  const companyUser = toCompanyUser(data);

  const onConfirmStatusChange = async () => {
    try {
      setLoading(true);
      await updateStatus.mutateAsync({ id: data.id, is_active: false });
      toast.success('Benutzer wurde deaktiviert.');
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Fehler beim Deaktivieren des Benutzers.'
      );
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  const onReactivate = async () => {
    try {
      setLoading(true);
      await updateStatus.mutateAsync({ id: data.id, is_active: true });
      toast.success('Benutzer wurde reaktiviert.');
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Fehler beim Reaktivieren des Benutzers.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <AlertModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onConfirm={onConfirmStatusChange}
        loading={loading}
        title='Benutzer deaktivieren?'
        description={`${data.name} wird deaktiviert und kann sich nicht mehr anmelden.`}
      />
      <EditCredentialsDialog
        open={credentialsOpen}
        onOpenChange={setCredentialsOpen}
        user={companyUser}
      />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' className='h-8 w-8 p-0'>
            <span className='sr-only'>Menü öffnen</span>
            <IconDotsVertical className='h-4 w-4' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuLabel>Aktionen</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => openForEdit(data)}>
            <IconEdit className='mr-2 h-4 w-4' /> Bearbeiten
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setCredentialsOpen(true)}>
            <IconKey className='mr-2 h-4 w-4' /> Zugangsdaten
          </DropdownMenuItem>
          {!isSelf && data.is_active && (
            <DropdownMenuItem
              onClick={() => setOpen(true)}
              className='text-destructive focus:text-destructive'
            >
              <IconUserOff className='mr-2 h-4 w-4' /> Deaktivieren
            </DropdownMenuItem>
          )}
          {!isSelf && !data.is_active && (
            <DropdownMenuItem
              onClick={() => void onReactivate()}
              disabled={loading}
            >
              <IconUserCheck className='mr-2 h-4 w-4' /> Reaktivieren
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
