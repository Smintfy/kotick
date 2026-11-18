import 'server-only';
import type { MDXContent } from 'mdx/types';
import * as api from '@/content/docs/api.mdx';
import * as concepts from '@/content/docs/concepts.mdx';
import * as faq from '@/content/docs/faq.mdx';
import * as fixtures from '@/content/docs/fixtures.mdx';
import * as install from '@/content/docs/install.mdx';
import * as limitations from '@/content/docs/limitations.mdx';
import * as nextjs from '@/content/docs/nextjs.mdx';
import * as overview from '@/content/docs/overview.mdx';
import * as panel from '@/content/docs/panel.mdx';
import * as production from '@/content/docs/production.mdx';

export type Heading = { id: string; text: string; depth: 2 | 3 };

export type NavItem = { href: string; title: string; headings: readonly Heading[] };

export type DocsPage = NavItem & {
  slug: string;
  description: string;
  /** The path of the Markdown copy of the page, or `undefined` when the page has none. */
  markdownHref: string | undefined;
  Content: MDXContent;
};

/** The docs pages at /docs/<slug>. Each file is in src/content/docs. navSections sets the sequence in the nav. */
const docs = [
  ['install', install],
  ['concepts', concepts],
  ['panel', panel],
  ['fixtures', fixtures],
  ['api', api],
  ['nextjs', nextjs],
  ['production', production],
  ['limitations', limitations],
  ['faq', faq],
] as const;

type DocsSlug = (typeof docs)[number][0];

/** These pages have no Markdown copy and no "Copy page" button. */
const withoutMarkdown: ReadonlySet<DocsSlug> = new Set(['faq', 'limitations']);

export const examplesHeadings = [
  { id: 'onboarding', text: 'Onboarding', depth: 2 },
] as const satisfies readonly Heading[];

export type ExampleId = (typeof examplesHeadings)[number]['id'];

/** The examples page is TSX, not MDX. Its route is src/app/docs/examples. */
export const examplesPage = {
  href: '/docs/examples',
  title: 'Examples',
  description: 'Apps with the real overlay docked beside them. Each example has a fixture for each state.',
  headings: examplesHeadings,
} as const satisfies NavItem & { description: string };

/**
 * The demo apps. Each demo has a full-window page at /docs/examples/<id>, where the panel has more space.
 * `from` is the docs section that shows the demo in a frame.
 */
export const demos = [
  { id: 'checkout', title: 'Checkout', from: '/#how-it-works' },
  { id: 'onboarding', title: 'Onboarding', from: '/docs/examples#onboarding' },
] as const;

export type DemoId = (typeof demos)[number]['id'];

export const demoHref = (id: DemoId) => `/docs/examples/${id}`;

function docsPage(
  slug: string,
  { metadata, headings, default: Content }: typeof overview,
  href: string,
  markdownHref: string | undefined,
): DocsPage {
  if (!metadata?.title || !metadata.description) {
    throw new Error(`src/content/docs/${slug}.mdx must export metadata with a title and a description.`);
  }

  return { slug, href, title: metadata.title, description: metadata.description, markdownHref, headings, Content };
}

/** The landing page. Its route is src/app/(docs)/page.tsx. next.config.ts rewrites /index.md to src/app/(docs)/md. */
export const overviewPage = docsPage('overview', overview, '/', '/index.md');

export const pitch = overviewPage.description;

export const pages: readonly DocsPage[] = docs.map(([slug, module]) =>
  docsPage(slug, module, `/docs/${slug}`, withoutMarkdown.has(slug) ? undefined : `/docs/${slug}.md`),
);

export function findPage(slug: string): DocsPage | undefined {
  return pages.find((page) => page.slug === slug);
}

export type NavSection = { title: string; items: readonly NavItem[] };

function docsItem(slug: DocsSlug): NavItem {
  const page = findPage(slug);

  if (!page) throw new Error(`No docs page has the slug ${slug}.`);

  return { href: page.href, title: page.title, headings: page.headings };
}

/** The sections of the sidebar. The pager goes through the pages in this sequence. */
export const navSections: readonly NavSection[] = [
  {
    title: 'Introduction',
    items: [
      { href: overviewPage.href, title: 'Overview', headings: overviewPage.headings },
      docsItem('install'),
      examplesPage,
    ],
  },
  {
    title: 'Guides',
    items: [docsItem('concepts'), docsItem('panel'), docsItem('fixtures'), docsItem('nextjs'), docsItem('production')],
  },
  {
    title: 'Reference',
    items: [docsItem('api'), docsItem('limitations'), docsItem('faq')],
  },
];

export const nav: readonly NavItem[] = navSections.flatMap(({ items }) => items);

const ids = new Map(nav.map(({ href, headings }) => [href, new Set(headings.map(({ id }) => id))]));

function brokenLink(href: string): string | undefined {
  const [path = '', id] = href.split('#');
  const pageIds = ids.get(path);

  if (pageIds === undefined) return `no page has the path ${path}`;

  if (id !== undefined && !pageIds.has(id)) return `${path} has no H2 or H3 with the id "${id}"`;

  return undefined;
}

const problems = [['overview', overview] as const, ...docs].flatMap(([slug, { links }]) =>
  links.flatMap((href) => {
    const problem = brokenLink(href);

    return problem ? [`src/content/docs/${slug}.mdx links to ${href}, but ${problem}.`] : [];
  }),
);

if (problems.length > 0) throw new Error(`The docs have broken links.\n${problems.map((line) => `- ${line}`).join('\n')}`);

/** Returns `href`. Fails the build when no page or heading has it. */
export function checkedHref(href: string): string {
  const problem = brokenLink(href);

  if (problem) throw new Error(`The link ${href} is broken: ${problem}.`);

  return href;
}
