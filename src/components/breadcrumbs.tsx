'use client';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb';
import { useBreadcrumbStore } from '@/hooks/use-breadcrumb-store';
import { usePathname } from 'next/navigation';
import { Fragment, useMemo } from 'react';

const SEGMENT_MAP: Record<string, string> = {
  dashboard: 'Dashboard',
  invoices: 'Rechnungen',
  preview: 'Vorschau',
  new: 'Neu',
  edit: 'Bearbeiten',
  products: 'Produkte',
  product: 'Produkt',
  profile: 'Profil',
  settings: 'Einstellungen',
  billing: 'Abrechnung',
  kanban: 'Fahrtenplan'
};

interface BreadcrumbsProps {
  items?: {
    title: string;
    link: string;
  }[];
}

export function Breadcrumbs({ items: manualItems }: BreadcrumbsProps) {
  const pathname = usePathname();
  const { customTitles } = useBreadcrumbStore();

  const items = useMemo(() => {
    if (manualItems) return manualItems;

    // Auto-generate from pathname
    const segments = pathname.split('/').filter(Boolean);
    return segments.map((segment, index) => {
      const link = `/${segments.slice(0, index + 1).join('/')}`;
      const normalizedLink = link.toLowerCase().replace(/\/+$/, '') || '/';

      // 1. Check if there is a custom title for this specific link (e.g., from a resource hook)
      if (customTitles[normalizedLink]) {
        return { title: customTitles[normalizedLink], link };
      }

      // 2. Check if the segment is in our translation map
      const lowerSegment = segment.toLowerCase();
      if (SEGMENT_MAP[lowerSegment]) {
        return { title: SEGMENT_MAP[lowerSegment], link };
      }

      // 3. Fallback to capitalization
      const title = segment
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (l) => l.toUpperCase());
      return { title, link };
    });
  }, [pathname, manualItems, customTitles]);

  if (items.length === 0) return null;

  return (
    <Breadcrumb className='max-w-full min-w-0'>
      <BreadcrumbList className='flex-nowrap overflow-x-auto'>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={item.link}>
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{item.title}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={item.link}>{item.title}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
