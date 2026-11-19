import { pageMarkdown } from '@/content/markdown';
import { findPage, pages } from '@/site';

export const dynamicParams = false;

export function generateStaticParams() {
  return pages.filter(({ markdownHref }) => markdownHref).map(({ slug }) => ({ slug }));
}

export async function GET(_request: Request, { params }: RouteContext<'/docs/[slug]/md'>) {
  const page = findPage((await params).slug);

  if (!page?.markdownHref) return new Response('Not found', { status: 404 });

  return new Response(await pageMarkdown(page), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
