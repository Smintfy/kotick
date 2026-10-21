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
    <header
      className="group sticky top-0 h-dvh overflow-y-auto py-10 max-md:z-10 max-md:h-auto max-md:overflow-visible max-md:border-b max-md:border-line max-md:bg-bg max-md:p-0"
      data-open={open || undefined}
    >
      <div className="flex items-center justify-between max-md:h-bar max-md:px-4">
        <Link href="/" className="inline-flex items-center gap-2.5 font-medium no-underline" onClick={close}>
          <Mark size={24} />
          konat
        </Link>
        <button
          type="button"
          className="hidden cursor-pointer rounded-lg bg-surface px-3 py-1.5 text-[14px] max-md:block"
          aria-expanded={open}
          aria-controls="nav"
          onClick={() => setOpen(!open)}
        >
          Menu
        </button>
      </div>
      <nav
        id="nav"
        aria-label="Docs"
        className="mt-8 text-[14px] max-md:absolute max-md:inset-x-0 max-md:top-full max-md:m-0 max-md:hidden max-md:max-h-[calc(100dvh-var(--spacing-bar))] max-md:overflow-y-auto max-md:border-b max-md:border-line max-md:bg-bg max-md:px-4 max-md:pt-2 max-md:pb-6 max-md:group-data-open:block"
      >
        <ul>
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={item === current ? 'page' : undefined}
                className="block py-1 text-muted no-underline hover:text-fg aria-[current=page]:font-medium aria-[current=page]:text-fg"
                onClick={close}
              >
                {item.title}
              </Link>
              {item === current && item.headings.length > 0 && (
                <ul className="mt-0.5 mb-2 border-l border-line pl-3">
                  {item.headings.map((heading) => (
                    <li key={heading.id}>
                      <a
                        href={`#${heading.id}`}
                        data-active={heading.id === active || undefined}
                        className={`relative block py-[3px] text-muted no-underline hover:text-fg data-active:text-fg data-active:before:absolute data-active:before:top-1/2 data-active:before:-left-[15.5px] data-active:before:-mt-[3px] data-active:before:size-1.5 data-active:before:rounded-full data-active:before:bg-live ${heading.depth === 3 ? 'pl-3' : ''}`}
                        onClick={close}
                      >
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
