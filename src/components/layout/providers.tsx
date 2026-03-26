'use client';
import React, { useState } from 'react';
import { ActiveThemeProvider } from '../themes/active-theme';
import { QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '../ui/tooltip';
import { createQueryClient } from '@/query/query-client';

export default function Providers({
  activeThemeValue,
  children
}: {
  activeThemeValue: string;
  children: React.ReactNode;
}) {
  /** Single app-wide client — defaults live in `@/query/query-client`. */
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ActiveThemeProvider initialTheme={activeThemeValue}>
        <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
      </ActiveThemeProvider>
    </QueryClientProvider>
  );
}
