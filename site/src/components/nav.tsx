'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import type { NavSection } from '@/site';

export function Nav({ sections }: { sections: readonly NavSection[] }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar className="group-data-[side=left]:border-r-0">
      <SidebarContent role="navigation" aria-label="Docs" className="gap-6 px-2 py-10">
        {sections.map((section) => (
          <SidebarGroup key={section.title} className="py-0">
            <SidebarGroupLabel className="mb-1 h-auto px-3 text-[13px] font-normal text-muted-foreground">
              {section.title}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      size="sm"
                      isActive={item.href === pathname}
                      render={<Link href={item.href} aria-current={item.href === pathname ? 'page' : undefined} />}
                      className="h-7.5 px-3 text-[13px] data-active:font-normal transition-[background-color] duration-120 ease-[ease] hover:bg-surface active:bg-surface data-active:hover:bg-selected motion-reduce:transition-none"
                      onClick={() => setOpenMobile(false)}
                    >
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
