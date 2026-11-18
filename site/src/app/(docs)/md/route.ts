import { pageMarkdown } from '@/content/markdown';
import { overviewPage } from '@/site';

/** next.config.ts rewrites /index.md to this route. */
export const dynamic = 'force-static';

export async function GET() {
  // text/plain, not text/markdown, because some browsers download text/markdown instead of showing it.
  return new Response(await pageMarkdown(overviewPage), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
