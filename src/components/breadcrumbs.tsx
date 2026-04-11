'use client';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb';
import { navItems } from '@/config/nav-config';
import { useBreadcrumbStore } from '@/hooks/use-breadcrumb-store';
import { buildBreadcrumbsFromNav } from '@/lib/build-breadcrumbs';
import { usePathname } from 'next/navigation';
import { Fragment, useMemo } from 'react';

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
    return buildBreadcrumbsFromNav(pathname, navItems, customTitles);
  }, [pathname, manualItems, customTitles]);

  if (items.length === 0) return null;

  return (
    <Breadcrumb className='max-w-full min-w-0'>
      <BreadcrumbList className='flex-nowrap overflow-x-auto'>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={`${item.link}-${index}`}>
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
