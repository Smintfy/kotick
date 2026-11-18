import { PageActions } from '@/components/page-actions';
import { Pager } from '@/components/pager';
import { pageMarkdown } from '@/content/markdown';
import type { DocsPage } from '@/site';

/** The title, the description, the "Copy page" button, the content, and the pager of a docs page. */
export async function DocsArticle({ page }: { page: DocsPage }) {
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
