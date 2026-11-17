import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageActions } from '@/components/page-actions';
import { Pager } from '@/components/pager';
import { pageMarkdown } from '@/content/markdown';
import { findPage, pages } from '@/site';

export const dynamicParams = false;

export function generateStaticParams() {
  return pages.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<'/docs/[slug]'>): Promise<Metadata> {
  const page = findPage((await params).slug);

  return { title: page?.title, description: page?.description };
}

export default async function DocsPage({ params }: PageProps<'/docs/[slug]'>) {
  const page = findPage((await params).slug);

  if (!page) notFound();

  return (
    <>
      <article className="prose">
        <header className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <h1>{page.title}</h1>
            {page.markdownHref && <PageActions markdown={await pageMarkdown(page)} markdownHref={page.markdownHref} />}
          </div>
          <p className="mt-2 mb-4 text-muted-foreground">{page.description}</p>
        </header>
        <page.Content />
      </article>
      <Pager href={page.href} />
    </>
  );
}
