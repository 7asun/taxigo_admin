'use client';

/**
 * Edit Supabase Auth email / password for a tenant user.
 *
 * The password field is intentionally never pre-filled — browser autofill would be a footgun
 * and we must not surface previous passwords in the DOM.
 */

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpdateCredentials } from '@/features/driver-management/api/user-actions.service';
import type { CompanyUser } from '@/features/user-management/types';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

const MIN_PASSWORD_LENGTH = 8;

export interface EditCredentialsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: CompanyUser | null;
}

export function EditCredentialsDialog({
  open,
  onOpenChange,
  user
}: EditCredentialsDialogProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const updateCredentials = useUpdateCredentials();

  useEffect(() => {
    if (open && user) {
      setEmail(user.email ?? '');
      setPassword('');
      setInlineError(null);
    }
  }, [open, user]);

  const trimmedPassword = password.trim();
  const trimmedEmail = email.trim();
  const originalEmail = (user?.email ?? '').trim().toLowerCase();

  const passwordTooShort =
    trimmedPassword !== '' && trimmedPassword.length < MIN_PASSWORD_LENGTH;
  const emailChanged =
    trimmedEmail.toLowerCase() !== originalEmail && trimmedEmail !== '';
  const passwordChangeOk =
    trimmedPassword !== '' && trimmedPassword.length >= MIN_PASSWORD_LENGTH;

  const canSubmit = emailChanged || passwordChangeOk;
  const submitDisabled =
    !canSubmit || passwordTooShort || updateCredentials.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || submitDisabled) return;
    setInlineError(null);
    const body: { email?: string; password?: string } = {};
    if (emailChanged) {
      body.email = trimmedEmail;
    }
    if (passwordChangeOk) {
      body.password = trimmedPassword;
    }
    if (Object.keys(body).length === 0) {
      return;
    }
    try {
      await updateCredentials.mutateAsync({ id: user.id, body });
      toast.success('Zugangsdaten wurden aktualisiert.');
      onOpenChange(false);
    } catch (err) {
      setInlineError(
        err instanceof Error ? err.message : 'Aktualisierung fehlgeschlagen'
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Zugangsdaten bearbeiten</DialogTitle>
            <DialogDescription>
              Änderungen gelten für die Anmeldung (Supabase Auth). Das
              Passwort-Feld bleibt leer, wenn es unverändert bleiben soll.
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-4 py-4'>
            {inlineError ? (
              <Alert variant='destructive'>
                <AlertDescription>{inlineError}</AlertDescription>
              </Alert>
            ) : null}
            <div className='grid gap-2'>
              <Label htmlFor='edit-user-email'>E-Mail-Adresse</Label>
              <Input
                id='edit-user-email'
                type='email'
                autoComplete='off'
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setInlineError(null);
                }}
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='edit-user-password'>Neues Passwort</Label>
              <Input
                id='edit-user-password'
                type='password'
                autoComplete='new-password'
                placeholder='Leer lassen = unverändert'
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setInlineError(null);
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              Abbrechen
            </Button>
            <Button
              type='submit'
              disabled={submitDisabled || updateCredentials.isPending}
            >
              {updateCredentials.isPending ? 'Speichern…' : 'Speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
