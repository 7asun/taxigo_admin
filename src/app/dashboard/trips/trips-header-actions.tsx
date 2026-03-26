'use client';

import dynamic from 'next/dynamic';

const PrintTripsButton = dynamic(
  async () => {
    const { PrintTripsButton: Btn } = await import(
      '@/features/trips/components/print-trips-button'
    );
    return { default: Btn };
  },
  {
    ssr: false,
    loading: () => (
      <div
        className='border-border bg-muted/40 h-9 w-[148px] shrink-0 animate-pulse rounded-md border'
        aria-hidden
      />
    )
  }
);

const BulkUploadDialog = dynamic(
  async () => {
    const { BulkUploadDialog: Dlg } = await import(
      '@/features/trips/components/bulk-upload-dialog'
    );
    return { default: Dlg };
  },
  {
    ssr: false,
    loading: () => (
      <div
        className='border-border bg-muted/40 h-9 w-[118px] shrink-0 animate-pulse rounded-md border'
        aria-hidden
      />
    )
  }
);

/**
 * Client-only Radix toolbar actions: `dynamic(..., { ssr: false })` is not allowed
 * in Server Components; wrapping here avoids Popover/Dialog hydration mismatches.
 */
export function TripsPageHeaderActions() {
  return (
    <div className='flex shrink-0 flex-nowrap items-center justify-end gap-2'>
      <PrintTripsButton />
      <BulkUploadDialog />
    </div>
  );
}
