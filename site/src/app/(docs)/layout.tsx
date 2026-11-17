import { Nav } from '@/components/nav';
import { Toc } from '@/components/toc';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { nav, navSections } from '@/site';

/**
 * The sidebar on the left, the content, and the TOC on the right. Only wide screens show the TOC.
 * The full-window demos in src/app/(full-window) do not use this layout.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        className="absolute -top-[100px] left-4 z-20 rounded-lg bg-fg px-3 py-2 text-bg focus:top-4"
        href="#content"
      >
        Skip to content
      </a>
      <SidebarProvider style={{ '--sidebar-width': '240px' } as React.CSSProperties}>
        <Nav sections={navSections} />
        <SidebarInset className="h-svh">
          <header className="flex h-bar shrink-0 items-center justify-end border-b border-line bg-bg px-4 md:hidden">
            <SidebarTrigger className="-mr-1.5" />
          </header>
          {/*
           * This element, not the window, scrolls. Thus, scroll-fade-y can fade its top and bottom edges.
           * It contains the TOC, so the scrollbar is at the right edge of the window.
           */}
          <div
            id="content"
            className="grid min-h-0 flex-1 scroll-fade-y items-start overflow-y-auto [scrollbar-gutter:stable] scroll-pt-10 max-md:scroll-pt-6 xl:grid-cols-[minmax(0,1fr)_240px]"
          >
            <div className="min-w-0 px-12 pt-10 pb-16 max-lg:px-8 max-md:px-4 max-md:pt-6 max-md:pb-12">
              <div className="mx-auto max-w-[680px]">{children}</div>
            </div>
            <Toc items={nav} />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </>
  );
}
