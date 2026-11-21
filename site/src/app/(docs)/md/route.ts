import { pageMarkdown } from '@/content/markdown';
import { overviewPage } from '@/site';

export const dynamic = 'force-static';

export async function GET() {
  return new Response(await pageMarkdown(overviewPage), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
