'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/logo';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
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
      <SidebarHeader className="mt-8 ml-5 flex-row items-center gap-2">
        <Link href="/" aria-label="shiru home" className="w-fit rounded-sm" onClick={() => setOpenMobile(false)}>
          <Logo className="size-5" />
        </Link>
        <Separator orientation="vertical" className="mx-0.5 bg-input data-vertical:h-4 data-vertical:self-center" />
        <span className="text-sm font-medium text-muted-foreground">Docs</span>
      </SidebarHeader>
      <SidebarContent role="navigation" aria-label="Docs" className="scroll-fade-y gap-6 px-2 pt-4 pb-10">
        {sections.map((section) => (
          <SidebarGroup key={section.title} className="py-0">
            <SidebarGroupLabel className="mb-1 h-auto px-3 text-[0.8rem] font-normal text-muted-foreground">
              {section.title}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {section.items.map((item) => {
                  const current = item.href === pathname;

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        size="sm"
                        isActive={current}
                        render={<Link href={item.href} aria-current={current ? 'page' : undefined} />}
                        className="h-7.5 px-3 text-[0.8rem] font-medium text-secondary-foreground transition-[background-color] duration-120 ease-[ease] hover:bg-muted active:bg-muted data-active:hover:bg-accent motion-reduce:transition-none"
                        onClick={() => setOpenMobile(false)}
                      >
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="px-7 pt-2 pb-4">
        <ThemeSwitcher />
      </SidebarFooter>
    </Sidebar>
  );
}
