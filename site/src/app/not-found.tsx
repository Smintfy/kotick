import type { Metadata } from 'next';
import Link from 'next/link';
import DocsLayout from '@/app/(docs)/layout';
import { checkedHref } from '@/site';

export const metadata: Metadata = { title: 'Page not found' };

const links = [
  { href: checkedHref('/'), title: 'Overview' },
  { href: checkedHref('/docs/install'), title: 'Installation' },
  { href: checkedHref('/docs/troubleshooting'), title: 'Troubleshooting' },
];

export default function NotFound() {
  return (
    <DocsLayout>
      <article className="prose">
        <header className="mb-8">
          <h1>Page not found</h1>
          <p className="mt-2 mb-4 text-muted-foreground">No page has this address.</p>
        </header>
        <p>Use the navigation, or go to one of these pages:</p>
        <ul>
          {links.map(({ href, title }) => (
            <li key={href}>
              <Link href={href}>{title}</Link>
            </li>
          ))}
        </ul>
      </article>
    </DocsLayout>
  );
}
