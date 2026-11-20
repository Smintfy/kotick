import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { nav, type NavItem } from '@/site';

function PagerLink({ item, direction }: { item: NavItem; direction: 'previous' | 'next' }) {
  const next = direction === 'next';

  return (
    <Link
      href={item.href}
      rel={next ? 'next' : 'prev'}
      className={`grid gap-1 rounded-xl shadow-edge px-5 py-4 text-inherit no-underline transition-[background-color] duration-120 ease-[ease] hover:bg-muted motion-reduce:transition-none ${next ? 'col-start-2 justify-items-end text-right' : ''}`}
    >
      <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
        {!next && <ChevronLeft className="size-3.5" />}
        {next ? 'Next' : 'Previous'}
        {next && <ChevronRight className="size-3.5" />}
      </span>
      <span className="font-medium">{item.title}</span>
    </Link>
  );
}

export function Pager({ href }: { href: string }) {
  const index = nav.findIndex((item) => item.href === href);
  const previous = nav[index - 1];
  const next = nav[index + 1];

  return (
    <nav aria-label="Pages" className="mt-16 grid grid-cols-2 gap-3">
      {previous && <PagerLink item={previous} direction="previous" />}
      {next && <PagerLink item={next} direction="next" />}
    </nav>
  );
}
