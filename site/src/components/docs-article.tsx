import { PageAdapterTabsProvider } from '@/components/docs/adapter-tabs';
import { PageActions } from '@/components/page-actions';
import { Pager } from '@/components/pager';
import { pageMarkdown, skillMarkdown } from '@/content/markdown';
import { type DocsPage, repoHref } from '@/site';

export async function DocsArticle({ page }: { page: DocsPage }) {
  return (
    <>
      <article className="prose">
        <header className="mb-8">
          <h1 className="mb-3">{page.title}</h1>
          <PageActions
            copy={page.slug === 'agent-skill' ? { label: 'Copy skill', text: await skillMarkdown() } : { label: 'Copy page', text: await pageMarkdown(page) }}
            markdownHref={page.markdownHref}
            repoHref={repoHref}
          />
        </header>
        <PageAdapterTabsProvider enabled={page.adapterTabs}>
          <page.Content />
        </PageAdapterTabsProvider>
      </article>
      <Pager href={page.href} />
    </>
  );
}
