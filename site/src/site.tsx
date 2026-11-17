import 'server-only';
import type { MDXContent } from 'mdx/types';
import * as api from '@/content/docs/api.mdx';
import * as concepts from '@/content/docs/concepts.mdx';
import * as faq from '@/content/docs/faq.mdx';
import * as fixtures from '@/content/docs/fixtures.mdx';
import * as install from '@/content/docs/install.mdx';
import * as limitations from '@/content/docs/limitations.mdx';
import * as nextjs from '@/content/docs/nextjs.mdx';
import * as panel from '@/content/docs/panel.mdx';
import * as production from '@/content/docs/production.mdx';

export type Heading = { id: string; text: string; depth: 2 | 3 };

export type NavItem = { href: string; title: string; headings: readonly Heading[] };

export type DocsPage = NavItem & {
  slug: string;
  description: string;
  Content: MDXContent;
};

/** The docs pages. Each file is in src/content/docs. navSections sets the sequence in the nav. */
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

export const pitch = 'See every state of every state machine on the page, and preview any of them in place.';

export const landingHeadings = [
  { id: 'konat', text: 'Konat', depth: 2 },
  { id: 'how-it-works', text: 'How it works', depth: 2 },
  { id: 'why', text: 'Why konat', depth: 2 },
] as const satisfies readonly Heading[];

export type LandingId = (typeof landingHeadings)[number]['id'];

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

export const pages: readonly DocsPage[] = docs.map(([slug, { metadata, headings, default: Content }]) => {
  if (!metadata?.title || !metadata.description) {
    throw new Error(`src/content/docs/${slug}.mdx must export metadata with a title and a description.`);
  }

  return { slug, href: `/docs/${slug}`, title: metadata.title, description: metadata.description, headings, Content };
});

export function findPage(slug: string): DocsPage | undefined {
  return pages.find((page) => page.slug === slug);
}

export type NavSection = { title: string; items: readonly NavItem[] };

function docsItem(slug: (typeof docs)[number][0]): NavItem {
  const page = findPage(slug);

  if (!page) throw new Error(`No docs page has the slug ${slug}.`);

  return { href: page.href, title: page.title, headings: page.headings };
}

/** The sections of the sidebar. The pager goes through the pages in this sequence. */
export const navSections: readonly NavSection[] = [
  {
    title: 'Introduction',
    items: [
      { href: '/', title: 'Overview', headings: landingHeadings },
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

const problems = docs.flatMap(([slug, { links }]) =>
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
