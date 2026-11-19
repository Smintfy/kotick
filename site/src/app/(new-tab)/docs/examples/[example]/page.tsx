import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DemoPage } from '@/demo/demo-page';
import { checkedHref, demos } from '@/site';

export const dynamicParams = false;

export function generateStaticParams() {
  return demos.map(({ id }) => ({ example: id }));
}

const findDemo = (id: string) => demos.find((demo) => demo.id === id);

export async function generateMetadata({ params }: PageProps<'/docs/examples/[example]'>): Promise<Metadata> {
  const demo = findDemo((await params).example);

  return { title: demo && `${demo.title} example` };
}

export default async function FullWindowDemo({ params }: PageProps<'/docs/examples/[example]'>) {
  const demo = findDemo((await params).example);

  if (!demo) notFound();

  return <DemoPage id={demo.id} title={demo.title} backHref={checkedHref(demo.backHref)} />;
}
