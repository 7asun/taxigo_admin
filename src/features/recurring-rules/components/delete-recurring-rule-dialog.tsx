'use client';

import * as React from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
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
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { recurringRulesService } from '@/features/trips/api/recurring-rules.service';

interface DeleteRecurringRuleDialogProps {
  ruleId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function DeleteRecurringRuleDialog({
  ruleId,
  isOpen,
  onOpenChange,
  onSuccess
}: DeleteRecurringRuleDialogProps) {
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteFutureTrips, setDeleteFutureTrips] = React.useState(true);

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await recurringRulesService.deleteRule(ruleId, deleteFutureTrips);
      toast.success(
        deleteFutureTrips
          ? 'Regel und zukünftige Fahrten gelöscht'
          : 'Regelfahrt gelöscht'
      );
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      toast.error(`Fehler beim Löschen: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Regelfahrt löschen?</AlertDialogTitle>
          <AlertDialogDescription className='space-y-4 pt-2'>
            <p>
              Möchten Sie diese wiederkehrende Regel wirklich löschen? Diese
              Aktion kann nicht rückgängig gemacht werden.
            </p>

            <div className='bg-muted/50 flex items-center justify-between rounded-lg border p-3'>
              <div className='space-y-0.5'>
                <Label
                  htmlFor='delete-future-trips'
                  className='text-sm font-medium'
                >
                  Zukünftige Fahrten löschen
                </Label>
                <p className='text-muted-foreground text-xs'>
                  Entfernt alle bereits generierten Fahrten in der Zukunft.
                </p>
              </div>
              <Switch
                id='delete-future-trips'
                checked={deleteFutureTrips}
                onCheckedChange={setDeleteFutureTrips}
              />
            </div>

            <p className='text-muted-foreground text-xs italic'>
              Hinweis: Bereits abgeschlossene oder stornierte Fahrten bleiben
              erhalten.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            disabled={isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Wird gelöscht...
              </>
            ) : (
              'Endgültig löschen'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
