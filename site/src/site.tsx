import 'server-only';
import GithubSlugger from 'github-slugger';
import type { ElementContent } from 'hast';
import { raw } from 'hast-util-raw';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { Code, Heading as MdastHeading, Nodes, RootContent } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { toHast } from 'mdast-util-to-hast';
import { toString } from 'mdast-util-to-string';
import { gfm } from 'micromark-extension-gfm';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { createHighlighter } from 'shiki';
import { CopyCodeButton } from '@/components/CopyButton';
import readme from '../../packages/state-viewer/README.md';

export type Heading = { id: string; text: string; depth: 2 | 3 };

export type DocsPage = {
  slug: string;
  href: `/docs/${string}`;
  title: string;
  description: string;
  id: string;
  headings: readonly Heading[];
  markdown: string;
  render(): ReactNode;
};

export type NavItem = { href: string; title: string; headings: readonly Heading[] };

type PageEntry = {
  slug: string;
  title: string;
  description: string;
  sections: readonly [string, ...string[]];
};

const pageTable: readonly PageEntry[] = [
  {
    slug: 'getting-started',
    title: 'Getting started',
    sections: ['install', 'quick-start'],
    description: 'Install the package, mount the overlay, and import the XState hooks from state-viewer/xstate.',
  },
  {
    slug: 'concepts',
    title: 'Concepts',
    sections: ['concepts'],
    description: 'Machines and instances, leaf ids, previews, blocked events, and where a preview gets its context.',
  },
  {
    slug: 'panel',
    title: 'The panel',
    sections: ['the-panel', 'keyboard'],
    description: 'The machine list, the machine pages, Settings, and the keyboard shortcuts.',
  },
  {
    slug: 'fixtures',
    title: 'Fixtures',
    sections: ['fixtures'],
    description: 'Give context to the states that you have not recorded yet.',
  },
  {
    slug: 'deep-links',
    title: 'Deep links',
    sections: ['deep-links'],
    description: 'Copy a link that opens the page with the same previews.',
  },
  {
    slug: 'api',
    title: 'API',
    sections: ['api'],
    description: 'The props of <StateViewer /> and the exports of state-viewer/xstate.',
  },
  {
    slug: 'nextjs',
    title: 'Next.js',
    sections: ['nextjs-and-server-components'],
    description: 'Use state-viewer in the App Router, with server components.',
  },
  {
    slug: 'production',
    title: 'Production builds',
    sections: ['production-builds', 'performance-in-development'],
    description: 'What production builds keep, and what the adapter costs in development.',
  },
  {
    slug: 'limitations',
    title: 'Limitations and FAQ',
    sections: ['limitations', 'faq'],
    description: 'What state-viewer cannot do in this version, and answers to common questions.',
  },
];

const omitted: readonly string[] = ['contents'];

const footer = 'license';

export const landingHeadings = [
  { id: 'how-it-works', text: 'How it works', depth: 2 },
  { id: 'why', text: 'Why state-viewer', depth: 2 },
  { id: 'install', text: 'Install', depth: 2 },
  { id: 'explore', text: 'Explore', depth: 2 },
] as const satisfies readonly Heading[];

export type LandingId = (typeof landingHeadings)[number]['id'];

const themes = { light: 'github-light-high-contrast', dark: 'github-dark-default' } as const;

const languages = ['bash', 'diff', 'ts', 'tsx'] as const;

type ReadmeHeading = { id: string; text: string; depth: MdastHeading['depth'] };

type Section = ReadmeHeading & {
  node: MdastHeading;
  body: RootContent[];
  subheadings: ReadmeHeading[];
};

function* walk(node: Nodes): Generator<Nodes> {
  yield node;

  if ('children' in node) for (const child of node.children) yield* walk(child);
}

const duplicates = (values: readonly string[]) =>
  [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];

function parse() {
  const tree = fromMarkdown(readme, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const slugger = new GithubSlugger();
  const ids = new Set<string>();

  const identify = (node: MdastHeading): ReadmeHeading => {
    const text = toString(node);
    const id = slugger.slug(text);
    node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
    ids.add(id);

    return { id, text, depth: node.depth };
  };

  const intro: RootContent[] = [];
  const sections: Section[] = [];

  for (const node of tree.children) {
    if (node.type === 'heading') {
      const heading = identify(node);

      if (node.depth === 1) continue;

      if (node.depth === 2) {
        sections.push({ ...heading, node, body: [], subheadings: [] });
        continue;
      }

      sections.at(-1)?.subheadings.push(heading);
    } else {
      for (const child of walk(node)) if (child.type === 'heading') identify(child);
    }

    (sections.at(-1)?.body ?? intro).push(node);
  }

  return { ids, intro, sections };
}

function readPackageName(install: Section | undefined): string | undefined {
  for (const node of install?.body ?? []) {
    const name = node.type === 'code' ? /^npm install (\S+)$/.exec(node.value.trim())?.[1] : undefined;

    if (name) return name;
  }

  return undefined;
}

function readCost(section: Section | undefined, pattern: RegExp): string | undefined {
  const text = toString(section?.body ?? []).replace(/\s+/g, ' ');
  const found = [...text.matchAll(pattern)];

  return found.length === 1 ? found[0]?.[1] : undefined;
}

function loadOrThrow() {
  const { ids, intro, sections } = parse();
  const byId = new Map(sections.map((section) => [section.id, section]));
  const problems: string[] = [];

  const listed = [
    ...pageTable.flatMap((entry) => entry.sections.map((id) => ({ id, by: `The page "${entry.slug}"` }))),
    ...omitted.map((id) => ({ id, by: 'omitted' })),
    { id: footer, by: 'footer' },
  ];

  const listedIds = new Set(listed.map((item) => item.id));

  for (const section of sections) {
    if (listedIds.has(section.id)) continue;
    problems.push(
      `The README section "${section.text}" (#${section.id}) is on no page. ` +
        'Add its id to the sections of a page in pageTable, or to omitted.',
    );
  }

  for (const { id, by } of listed) {
    if (!byId.has(id)) problems.push(`${by} lists #${id}, but the README has no H2 with that id.`);
  }

  for (const id of duplicates(listed.map((item) => item.id))) problems.push(`#${id} is listed more than one time.`);

  for (const slug of duplicates(pageTable.map((entry) => entry.slug))) {
    problems.push(`More than one page has the slug "${slug}".`);
  }

  const hrefs = new Map<string, string>();

  for (const entry of pageTable) {
    const page = `/docs/${entry.slug}`;
    entry.sections.forEach((id, index) => {
      const section = byId.get(id);

      if (!section) return;
      hrefs.set(id, index === 0 ? page : `${page}#${id}`);

      for (const heading of section.subheadings) hrefs.set(heading.id, `${page}#${heading.id}`);
    });
  }

  const parts = [
    { name: 'the intro', nodes: intro, shown: true },
    ...sections.map((section) => ({
      name: `"${section.text}"`,
      nodes: [section.node, ...section.body],
      shown: !omitted.includes(section.id),
    })),
  ];

  const loaded = new Set<string>(languages);

  for (const part of parts) {
    for (const node of part.nodes.flatMap((child) => [...walk(child)])) {
      if (node.type === 'code' && node.lang && !loaded.has(node.lang)) {
        problems.push(
          `A code block in ${part.name} has the language "${node.lang}", which the highlighter does not load. ` +
            'Add it to languages.',
        );
      }

      if (node.type !== 'link' || !node.url.startsWith('#')) continue;
      const id = node.url.slice(1);

      if (!ids.has(id)) problems.push(`The README links to #${id} in ${part.name}, but no heading has that id.`);
      else if (part.shown && !hrefs.has(id)) {
        problems.push(`The README links to #${id} in ${part.name}, but no page shows that heading.`);
      }
    }
  }

  const [pitchNode, lead, bullets, ...more] = intro;

  if (
    pitchNode?.type !== 'paragraph' ||
    lead?.type !== 'paragraph' ||
    bullets?.type !== 'list' ||
    bullets.ordered ||
    more.length > 0
  ) {
    problems.push(
      'The README intro must be the pitch paragraph, one paragraph and one bullet list. ' +
        `It is: ${intro.map((node) => node.type).join(', ') || 'empty'}.`,
    );
  }

  const quickStart = byId.get('quick-start')?.body.slice(0, 2) ?? [];
  const [quickLead, quickList] = quickStart;

  if (quickLead?.type !== 'paragraph' || quickList?.type !== 'list' || !quickList.ordered) {
    problems.push('#quick-start must start with a paragraph and then a numbered list.');
  }

  const packageName = readPackageName(byId.get('install'));

  if (packageName === undefined) problems.push('#install must have a code block "npm install <name>".');
  const transition = readCost(byId.get('performance-in-development'), /a transition costs (approximately [\d.]+ µs)/g);

  if (transition === undefined) {
    problems.push('#performance-in-development must say "a transition costs approximately <number> µs" one time.');
  }

  const startup = readCost(byId.get('production-builds'), /(approximately \d+ to \d+ bytes)/g);

  if (startup === undefined) {
    problems.push('#production-builds must say "approximately <number> to <number> bytes" one time.');
  }

  if (problems.length > 0 || packageName === undefined || transition === undefined || startup === undefined) {
    throw new Error(
      'site/src/site.tsx and packages/state-viewer/README.md do not agree.\n' +
        problems.map((problem) => `- ${problem}`).join('\n'),
    );
  }

  return {
    pages: pageTable.map((entry) => toPage(entry, entry.sections.flatMap((id) => byId.get(id) ?? []))),
    hrefs,
    pitch: toString(pitchNode),
    intro: [lead, bullets],
    quickStart,
    license: byId.get(footer)?.body ?? [],
    packageName,
    costs: { transition, startup },
  };
}

const oneLevelUp = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 } as const satisfies Record<
  MdastHeading['depth'],
  MdastHeading['depth']
>;

function toPage(entry: PageEntry, [first, ...others]: Section[]): DocsPage {
  const body = [
    ...first.body.map((node) => (node.type === 'heading' ? { ...node, depth: oneLevelUp[node.depth] } : node)),
    ...others.flatMap((section) => [section.node, ...section.body]),
  ];

  const headings = [
    ...first.subheadings.map((heading) => ({ ...heading, depth: oneLevelUp[heading.depth] })),
    ...others.flatMap((section) => [section, ...section.subheadings]),
  ].flatMap(({ id, text, depth }) => (depth === 2 || depth === 3 ? [{ id, text, depth }] : []));

  return {
    slug: entry.slug,
    href: `/docs/${entry.slug}`,
    title: entry.title,
    description: entry.description,
    id: first.id,
    headings,
    markdown: [first, ...others].map(sourceOf).join('\n\n'),
    render: () => render(body),
  };
}

function sourceOf(section: Section): string {
  const last = section.body.at(-1) ?? section.node;

  return readme.slice(section.node.position?.start.offset, last.position?.end.offset);
}

function render(nodes: RootContent[]): ReactNode {
  const tree = toHast({ type: 'root', children: nodes }, { allowDangerousHtml: true, handlers: { code: highlight } });

  return toJsxRuntime(raw(tree), { Fragment, jsx, jsxs, components });
}

function highlight(_state: unknown, node: Code): ElementContent[] {
  const root = highlighter.codeToHast(node.value, {
    lang: node.lang ?? 'text',
    themes,
    defaultColor: 'light-dark()',
    rootStyle: false,
  });

  return root.children.filter((child): child is ElementContent => child.type !== 'doctype');
}

function DocLink({ href = '', children }: ComponentProps<'a'>) {
  const target = href.startsWith('#') ? hrefFor(href.slice(1)) : href;

  return target.startsWith('/') ? <Link href={target}>{children}</Link> : <a href={target}>{children}</a>;
}

function CodeBlock(props: ComponentProps<'pre'>) {
  return (
    <figure className="code">
      <pre {...props} />
      <CopyCodeButton />
    </figure>
  );
}

function ScrollTable(props: ComponentProps<'table'>) {
  return (
    <div className="table-scroll">
      <table {...props} />
    </div>
  );
}

const components = {
  a: DocLink,
  pre: CodeBlock,
  table: ScrollTable,
  h2: ({ id, children }: ComponentProps<'h2'>) => (
    <h2 id={id}>
      <a href={`#${id}`}>{children}</a>
    </h2>
  ),
  h3: ({ id, children }: ComponentProps<'h3'>) => (
    <h3 id={id}>
      <a href={`#${id}`}>{children}</a>
    </h3>
  ),
};

const site = loadOrThrow();
const highlighter = await createHighlighter({ themes: Object.values(themes), langs: [...languages] });

export const pages: readonly DocsPage[] = site.pages;

export function findPage(slug: string): DocsPage | undefined {
  return pages.find((page) => page.slug === slug);
}

export const nav: readonly NavItem[] = [
  { href: '/', title: 'Introduction', headings: landingHeadings },
  ...pages.map(({ href, title, headings }) => ({ href, title, headings })),
];

export const pitch: string = site.pitch;

export const packageName: string = site.packageName;

export const costs: { transition: string; startup: string } = site.costs;

export const renderIntro = (): ReactNode => render(site.intro);

export const renderQuickStart = (): ReactNode => render(site.quickStart);

export const renderLicense = (): ReactNode => render(site.license);

export function hrefFor(id: string): string {
  const href = site.hrefs.get(id);

  if (href === undefined) throw new Error(`site/src/site.tsx: no page shows the README heading #${id}.`);

  return href;
}
