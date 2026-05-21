'use client';

/**
 * DriverDetailPanel — Column 2 of the Fahrer Miller Columns view.
 *
 * Create (driverId='new') or edit driver. Uses DriverFormBody for shared form fields.
 */

import { useEffect, useState, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Panel, PanelHeader, PanelBody } from '@/components/panels';
import { loadDriverForPanel } from '@/features/driver-management/api/get-roster';
import { useUpdateStatus } from '@/features/driver-management/api/user-actions.service';
import { EditCredentialsDialog } from '@/features/driver-management/components/edit-credentials-dialog';
import type { DriverWithProfile } from '@/features/driver-management/types';
import type { CompanyUser } from '@/features/user-management/types';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { DriverFormBody } from './driver-form-body';

interface DriverDetailPanelProps {
  driverId: string;
  onClose: () => void;
  onRefresh?: () => void;
}

export function DriverDetailPanel({
  driverId,
  onClose,
  onRefresh
}: DriverDetailPanelProps) {
  const isNew = driverId === 'new';
  const formRef = useRef<{ submit: () => void }>(null);
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [driver, setDriver] = useState<DriverWithProfile | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
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

  useEffect(() => {
    if (isNew) {
      setDriver(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    loadDriverForPanel(driverId)
      .then(setDriver)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Fehler beim Laden';
        toast.error('Fehler beim Laden des Fahrers: ' + msg);
      })
      .finally(() => setLoading(false));
  }, [driverId, isNew]);

  const getDisplayName = (d: DriverWithProfile) => {
    const u = d as { first_name?: string | null; last_name?: string | null };
    if (u?.first_name || u?.last_name) {
      return [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
    }
    return d.name;
  };
  const displayName = isNew
    ? 'Neuer Fahrer'
    : driver
      ? getDisplayName(driver)
      : '...';

  const isSelf =
    !isNew &&
    currentUserId != null &&
    driver != null &&
    driver.id === currentUserId;

  const handleSuccess = (saved?: DriverWithProfile) => {
    if (saved) {
      setDriver(saved);
      if (isNew) {
        onRefresh?.();
      }
      if (isNew) {
        const url = new URL(window.location.href);
        url.searchParams.set('driverId', saved.id);
        window.history.replaceState(null, '', url.toString());
      }
    }
  };

  const handleConfirmStatusChange = async () => {
    if (!driver) return;
    const nextActive = !driver.is_active;
    try {
      setStatusLoading(true);
      await updateStatus.mutateAsync({ id: driver.id, is_active: nextActive });
      toast.success(
        nextActive
          ? 'Benutzer wurde reaktiviert.'
          : 'Benutzer wurde deaktiviert.'
      );
      setDriver({ ...driver, is_active: nextActive });
      onRefresh?.();
      setStatusDialogOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Status konnte nicht geändert werden.'
      );
    } finally {
      setStatusLoading(false);
    }
  };

  const panelActions = !loading && (
    <div className='flex items-center gap-1'>
      {!isNew && driver && (
        <>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            className='h-6 px-2 text-xs'
            onClick={() => setCredentialsOpen(true)}
          >
            Zugangsdaten
          </Button>
          <Button
            type='button'
            size='sm'
            variant={driver.is_active ? 'destructive' : 'default'}
            className='h-6 px-2 text-xs'
            disabled={isSelf || statusLoading}
            onClick={() => setStatusDialogOpen(true)}
          >
            {driver.is_active ? 'Deaktivieren' : 'Reaktivieren'}
          </Button>
        </>
      )}
      <Button
        size='sm'
        variant={isFormDirty ? 'default' : 'ghost'}
        className='h-6 px-2 text-xs'
        disabled={!isFormDirty}
        onClick={() => formRef.current?.submit()}
      >
        {isNew ? 'Anlegen' : 'Aktualisieren'}
      </Button>
    </div>
  );

  return (
    <Panel className='flex-1'>
      <PanelHeader
        title={displayName}
        description={isNew ? 'Neuen Fahrer anlegen' : 'Fahrer bearbeiten'}
        onClose={onClose}
        actions={panelActions}
      />

      <PanelBody padded>
        {loading ? (
          <div className='flex h-24 items-center justify-center'>
            <Loader2 className='text-muted-foreground h-4 w-4 animate-spin' />
          </div>
        ) : (
          <DriverFormBody
            ref={formRef}
            initialData={driver}
            mode={isNew ? 'create' : 'edit'}
            onSuccess={handleSuccess}
            onDirtyChange={setIsFormDirty}
          />
        )}
      </PanelBody>

      {!isNew && driver && (
        <>
          <EditCredentialsDialog
            open={credentialsOpen}
            onOpenChange={setCredentialsOpen}
            user={mapToCompanyUser(driver)}
          />
          <AlertDialog
            open={statusDialogOpen}
            onOpenChange={setStatusDialogOpen}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {driver.is_active
                    ? 'Benutzer deaktivieren?'
                    : 'Benutzer reaktivieren?'}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {driver.is_active
                    ? `${driver.name} wird deaktiviert und kann sich nicht mehr anmelden.`
                    : `${driver.name} kann sich wieder anmelden.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={statusLoading}>
                  Abbrechen
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={statusLoading}
                  onClick={(e) => {
                    e.preventDefault();
                    void handleConfirmStatusChange();
                  }}
                >
                  {statusLoading ? '…' : 'Bestätigen'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </Panel>
  );
}

function mapToCompanyUser(d: DriverWithProfile): CompanyUser {
  return {
    id: d.id,
    name: d.name,
    first_name: d.first_name ?? null,
    last_name: d.last_name ?? null,
    email: d.email ?? null,
    role: d.role,
    is_active: d.is_active,
    created_at: null,
    phone: d.phone ?? null
  };
}
