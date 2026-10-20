import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CopyButton } from '@/components/CopyButton';
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
    <article className="prose">
      <header className="page-header">
        <h1 id={page.id}>{page.title}</h1>
        <p className="description">{page.description}</p>
        <CopyButton text={page.markdown} label="Copy Markdown" />
      </header>
      {page.render()}
    </article>
  );
}
