import type { Metadata } from 'next';
import { Geist_Mono, Inter } from 'next/font/google';
import { Nav } from '@/components/nav';
import { nav, pitch } from '@/site';
import '@/app/site.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: { default: 'konat', template: '%s · konat' },
  description: pitch,
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`}>
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
            <footer className="mt-24 flex flex-wrap justify-between gap-x-6 gap-y-1.5 border-t border-line pt-6 text-[13px] text-muted">
              <p className="m-0">
                Made by <a href="https://x.com/smintfy" target="_blank" rel="noreferrer">Smintfy</a>
              </p>
              <p className="m-0">MIT License</p>
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}
