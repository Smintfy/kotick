import type { Metadata } from 'next';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { nav, pitch, renderLicense } from '@/site';
import '@/app/site.css';

export const metadata: Metadata = {
  title: { default: 'state-viewer', template: '%s · state-viewer' },
  description: pitch,
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#content">
          Skip to content
        </a>
        <div className="shell">
          <Nav items={nav} />
          <div className="column">
            <main id="content">{children}</main>
            <footer className="footer">
              <nav aria-label="Footer">
                <ul>
                  {nav.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href}>{item.title}</Link>
                    </li>
                  ))}
                </ul>
              </nav>
              <div className="license">
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
