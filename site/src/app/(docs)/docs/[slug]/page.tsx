import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocsArticle } from '@/components/docs-article';
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

  return <DocsArticle page={page} />;
}
