'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Mark } from '@/components/Mark';
import type { Heading, NavItem } from '@/site';

const noHeadings: readonly Heading[] = [];

const readingLinePercent = 30;

function useHeadingInView(headings: readonly Heading[]): string | undefined {
  const [active, setActive] = useState<string>();

  useEffect(() => {
    const elements = headings.flatMap(({ id }) => document.getElementById(id) ?? []);

    const update = () => {
      const line = (window.innerHeight * readingLinePercent) / 100;
      setActive(elements.filter((element) => element.getBoundingClientRect().top < line).at(-1)?.id);
    };

    // The observed area is everything above the line, not only the part in the window.
    // Thus, each heading that crosses the line calls update, also on a long scroll step.
    const observer = new IntersectionObserver(update, {
      rootMargin: `100000px 0px -${100 - readingLinePercent}% 0px`,
    });

    for (const element of elements) observer.observe(element);

    return () => observer.disconnect();
  }, [headings]);

  return active;
}

export function Nav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = items.find((item) => item.href === pathname);
  const active = useHeadingInView(current?.headings ?? noHeadings);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header className="sidebar" data-open={open || undefined}>
      <div className="bar">
        <Link href="/" className="wordmark" onClick={close}>
          <Mark size={24} />
          state-viewer
        </Link>
        <button type="button" className="menu" aria-expanded={open} aria-controls="nav" onClick={() => setOpen(!open)}>
          Menu
        </button>
      </div>
      <nav id="nav" aria-label="Docs">
        <ul>
          {items.map((item) => (
            <li key={item.href}>
              <Link href={item.href} aria-current={item === current ? 'page' : undefined} onClick={close}>
                {item.title}
              </Link>
              {item === current && item.headings.length > 0 && (
                <ul>
                  {item.headings.map((heading) => (
                    <li key={heading.id} data-depth={heading.depth}>
                      <a href={`#${heading.id}`} data-active={heading.id === active || undefined} onClick={close}>
                        {heading.text}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
