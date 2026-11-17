import { pageMarkdown } from '@/content/markdown';
import { findPage, pages } from '@/site';

/** next.config.ts rewrites /docs/<slug>.md to this route. */
export const dynamicParams = false;

export function generateStaticParams() {
  return pages.filter(({ markdownHref }) => markdownHref).map(({ slug }) => ({ slug }));
}

export async function GET(_request: Request, { params }: RouteContext<'/docs/[slug]/md'>) {
  const page = findPage((await params).slug);

  if (!page?.markdownHref) return new Response('Not found', { status: 404 });

  // text/plain, not text/markdown, because some browsers download text/markdown instead of showing it.
  return new Response(await pageMarkdown(page), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
