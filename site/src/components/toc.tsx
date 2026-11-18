'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Heading, NavItem } from '@/site';

const noHeadings: readonly Heading[] = [];

const readingLinePercent = 30;

/** Returns the id of the last heading above the reading line. */
function useHeadingInView(headings: readonly Heading[]): string | undefined {
  const [active, setActive] = useState<string>();

  useEffect(() => {
    // The docs layout scrolls the content column, not the window.
    const root = document.getElementById('content');
    const elements = headings.flatMap(({ id }) => document.getElementById(id) ?? []);

    if (!root) return;

    const update = () => {
      const { top, height } = root.getBoundingClientRect();
      const line = top + (height * readingLinePercent) / 100;
      setActive(elements.filter((element) => element.getBoundingClientRect().top < line).at(-1)?.id);
    };

    // The observed area is everything above the line, not only the part in the content column.
    // Thus, each heading that crosses the line calls update, also on a long scroll step.
    const observer = new IntersectionObserver(update, {
      root,
      rootMargin: `100000px 0px -${100 - readingLinePercent}% 0px`,
    });

    for (const element of elements) observer.observe(element);

    return () => observer.disconnect();
  }, [headings]);

  return active;
}

/** The headings of the current page, on the right of the content. Only wide screens show it. */
export function Toc({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  const headings = items.find((item) => item.href === pathname)?.headings ?? noHeadings;
  const active = useHeadingInView(headings);

  return (
    <aside className="sticky top-0 max-h-full overflow-y-auto py-10 pr-8 max-xl:hidden">
      {headings.length > 0 && (
        <nav aria-labelledby="toc-title">
          <h2 id="toc-title" className="m-0 mb-3 text-[13px]">
            On this page
          </h2>
          <ul className="border-l text-[13px]">
            {headings.map((heading) => (
              <li key={heading.id}>
                <a
                  href={`#${heading.id}`}
                  data-active={heading.id === active || undefined}
                  className={`-ml-px block border-l border-transparent py-1 text-muted-foreground no-underline hover:text-foreground data-active:border-primary data-active:text-foreground ${heading.depth === 3 ? 'pl-7' : 'pl-4'}`}
                >
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </aside>
  );
}
