'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { invoiceKeys } from '@/query/keys';
import { saveInvoiceEmailDraft } from '../api/invoices.api';

export function useSaveInvoiceEmailDraft(invoiceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (draft: { email_subject: string; email_body: string }) =>
      saveInvoiceEmailDraft(invoiceId, draft),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: invoiceKeys.full(invoiceId)
      });
    }
  });
}
