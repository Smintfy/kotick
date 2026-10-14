'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PAGES = [
  { href: '/', title: 'Newsletter' },
  { href: '/preferences', title: 'Preferences' },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Pages">
      {PAGES.map((page) => (
        <Link key={page.href} href={page.href} aria-current={pathname === page.href ? 'page' : undefined}>
          {page.title}
        </Link>
      ))}
    </nav>
  );
}
