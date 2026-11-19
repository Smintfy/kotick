import Link from 'next/link';
import { version } from 'konat/package.json';
import { Logo } from '@/components/logo';
import { Nav } from '@/components/nav';
import { Toc } from '@/components/toc';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { nav, navSections } from '@/site';

const contentId = 'content';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        className="absolute -top-[100px] left-4 z-20 rounded-lg bg-foreground px-3 py-2 text-background focus:top-4"
        href={`#${contentId}`}
      >
        Skip to content
      </a>
      <SidebarProvider style={{ '--sidebar-width': '240px' }}>
        <Nav sections={navSections} version={version} />
        <SidebarInset className="h-svh">
          <header className="flex h-bar shrink-0 items-center justify-between border-b bg-background px-4 md:hidden">
            <Link href="/" aria-label="konat home" className="rounded-sm">
              <Logo className="size-5" />
            </Link>
            <SidebarTrigger className="-mr-1.5" />
          </header>
          <div
            id={contentId}
            className="grid min-h-0 flex-1 items-start overflow-y-auto [scrollbar-gutter:stable] scroll-pt-10 max-md:scroll-pt-6 xl:grid-cols-[minmax(0,1fr)_240px]"
          >
            <div className="min-w-0 px-12 pt-10 pb-16 max-lg:px-8 max-md:px-4 max-md:pt-6 max-md:pb-12">
              <div className="mx-auto max-w-[680px]">{children}</div>
            </div>
            <Toc items={nav} scrollRootId={contentId} />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </>
  );
}
