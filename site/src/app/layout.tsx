import type { Metadata } from 'next';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { nav, pitch, renderLicense } from '@/site';
import '@/app/site.css';

export const metadata: Metadata = {
  title: { default: 'konat', template: '%s · konat' },
  description: pitch,
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>
        <a
          className="absolute -top-[100px] left-4 z-20 rounded-lg bg-fg px-3 py-2 text-bg focus:top-4"
          href="#content"
        >
          Skip to content
        </a>
        <div className="grid grid-cols-[176px_minmax(0,680px)] justify-center gap-x-16 px-8 max-md:block max-md:p-0">
          <Nav items={nav} />
          <div className="min-w-0 pt-10 pb-16 max-md:px-4 max-md:pt-6 max-md:pb-12">
            <main id="content">{children}</main>
            <footer className="mt-24 border-t border-line pt-6 text-[14px]">
              <nav aria-label="Footer">
                <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
                  {nav.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} className="text-muted no-underline hover:text-fg">
                        {item.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
              <div className="mt-4 flex flex-wrap gap-x-1.5 text-[13px] text-muted [&_p]:m-0">
                <strong>License</strong>
                {renderLicense()}
              </div>
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
