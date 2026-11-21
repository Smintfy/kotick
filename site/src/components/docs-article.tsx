import { PageAdapterTabsProvider } from '@/components/docs/adapter-tabs';
import { PageActions } from '@/components/page-actions';
import { Pager } from '@/components/pager';
import { pageMarkdown } from '@/content/markdown';
import type { DocsPage } from '@/site';

export async function DocsArticle({ page }: { page: DocsPage }) {
  return (
    <>
      <article className="prose">
        <header className="mb-8">
          <h1 className="mb-3">{page.title}</h1>
          {page.markdownHref && <PageActions markdown={await pageMarkdown(page)} markdownHref={page.markdownHref} />}
        </header>
        <PageAdapterTabsProvider enabled={page.adapterTabs}>
          <page.Content />
        </PageAdapterTabsProvider>
      </article>
      <Pager href={page.href} />
    </>
  );
}
