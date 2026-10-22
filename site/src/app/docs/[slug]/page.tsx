import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Pager } from '@/components/pager';
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
          <h1 id={page.id}>{page.title}</h1>
          <p className="mt-2 mb-4 text-muted">{page.description}</p>
        </header>
        {page.render()}
      </article>
      <Pager href={page.href} />
    </>
  );
}
