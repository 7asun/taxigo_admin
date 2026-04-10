import { useQuery } from '@tanstack/react-query';
import { getInvoiceRevenueTotal } from '../api/invoices.api';
import { invoiceKeys } from '@/query/keys/invoices';

export function useInvoiceRevenueTotal() {
  return useQuery({
    queryKey: invoiceKeys.revenueTotal,
    queryFn: getInvoiceRevenueTotal,
    staleTime: 1000 * 60 * 5 // 5 minutes — stat does not need real-time precision
  });
}
