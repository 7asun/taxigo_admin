'use client';

/**
 * Expand-and-navigate sidebar row: label links to parent route; chevron toggles submenu.
 * Controlled Collapsible so direct loads on child routes open the section, and navigating
 * to the parent expands the menu after the route change.
 */

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem
} from '@/components/ui/sidebar';
import type { NavItem } from '@/types';
import { IconChevronRight } from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

interface SidebarExpandNavItemProps {
  item: NavItem;
  Icon: React.ComponentType<{ className?: string }>;
}

export function SidebarExpandNavItem({
  item,
  Icon
}: SidebarExpandNavItemProps) {
  const pathname = usePathname();
  const parentUrl = item.url!;
  const [open, setOpen] = React.useState(() => pathname.startsWith(parentUrl));

  React.useEffect(() => {
    if (pathname.startsWith(parentUrl)) {
      setOpen(true);
    }
  }, [pathname, parentUrl]);

  return (
    <SidebarMenuItem>
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className='group/collapsible w-full'
      >
        <SidebarMenuButton
          asChild
          tooltip={item.title}
          isActive={pathname === parentUrl}
        >
          <Link href={parentUrl}>
            <Icon />
            <span>{item.title}</span>
          </Link>
        </SidebarMenuButton>
        <CollapsibleTrigger asChild>
          <SidebarMenuAction
            aria-label={`${item.title} aufklappen`}
            className='transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90'
          >
            <IconChevronRight className='h-4 w-4' />
          </SidebarMenuAction>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.items?.map((subItem) => (
              <SidebarMenuSubItem key={subItem.title}>
                <SidebarMenuSubButton
                  asChild
                  isActive={pathname === subItem.url}
                >
                  <Link href={subItem.url}>
                    <span>{subItem.title}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}
