import 'server-only';
import { codeToTokens, isSupportedLanguage, type ThemedToken } from '@pierre/highlights';
import GithubSlugger from 'github-slugger';
import type { Element, ElementContent } from 'hast';
import { raw } from 'hast-util-raw';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { Code, Heading as MdastHeading, Node, Nodes, Paragraph, Parent, PhrasingContent, RootContent } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { toHast, type State } from 'mdast-util-to-hast';
import { toString } from 'mdast-util-to-string';
import { gfm } from 'micromark-extension-gfm';
import konatPackage from 'konat/package.json';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { AccordionItem, AccordionTrigger } from '@/components/accordion';
import { codeTheme } from '@/code-theme';
import { CopyCodeButton } from '@/components/copy-button';
import { InstallTabs } from '@/components/install-tabs';
import readme from '../../packages/konat/README.md';

export type Heading = { id: string; text: string; depth: 2 | 3 };

export type DocsPage = {
  slug: string;
  href: `/docs/${string}`;
  title: string;
  description: string;
  id: string;
  headings: readonly Heading[];
  render(): ReactNode;
};

export type NavItem = { href: string; title: string; headings: readonly Heading[]; version?: string };

type PageEntry = {
  slug: string;
  title: string;
  description: string;
  sections: readonly [string, ...string[]];
};

const pageTable: readonly PageEntry[] = [
  {
    slug: 'install',
    title: 'Install',
    sections: ['install', 'quick-start'],
    description: 'Install the package, mount the overlay, and import the XState hooks from konat/xstate.',
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
    slug: 'api',
    title: 'API',
    sections: ['api'],
    description: 'The props of <Konat /> and the exports of konat/xstate.',
  },
  {
    slug: 'nextjs',
    title: 'Next.js',
    sections: ['nextjs-and-server-components'],
    description: 'Use konat in the App Router, with server components.',
  },
  {
    slug: 'production',
    title: 'Production builds',
    sections: ['production-builds', 'performance-in-development'],
    description: 'What production builds keep, and what the adapter costs in development.',
  },
  {
    slug: 'limitations',
    title: 'Limitations',
    sections: ['limitations'],
    description: 'What konat cannot do in this version.',
  },
  {
    slug: 'faq',
    title: 'FAQ',
    sections: ['faq'],
    description: 'Answers to common questions.',
  },
];

const omitted: readonly string[] = ['contents', 'license'];

const accordion = 'faq';

const installSection = 'install';

export const landingHeadings = [
  { id: 'konat', text: 'Konat', depth: 2 },
  { id: 'how-it-works', text: 'How it works', depth: 2 },
  { id: 'why', text: 'Why konat', depth: 2 },
] as const satisfies readonly Heading[];

export type LandingId = (typeof landingHeadings)[number]['id'];

/** A FAQ question and its answer, without the "Q: " and "A: " that the README writes. */
interface Question extends Parent {
  type: 'question';
  id: string;
  question: PhrasingContent[];
}

/** The "npm install <name>" block of the README. The site shows it as one tab for each package manager. */
interface InstallCommand extends Node {
  type: 'installCommand';
  name: string;
}

declare module 'mdast' {
  interface RootContentMap {
    question: Question;
    installCommand: InstallCommand;
  }
}

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

function readInstall(install: Section | undefined): { name: string; node: Code } | undefined {
  for (const node of install?.body ?? []) {
    const name = node.type === 'code' ? /^npm install (\S+)$/.exec(node.value.trim())?.[1] : undefined;

    if (name && node.type === 'code') return { name, node };
  }

  return undefined;
}

function readCost(section: Section | undefined, pattern: RegExp): string | undefined {
  const text = toString(section?.body ?? []).replace(/\s+/g, ' ');
  const found = [...text.matchAll(pattern)];

  return found.length === 1 ? found[0]?.[1] : undefined;
}

function withoutPrefix(node: MdastHeading | Paragraph, prefix: string): PhrasingContent[] | undefined {
  const [first, ...rest] = node.children;

  return first?.type === 'text' && first.value.startsWith(prefix)
    ? [{ ...first, value: first.value.slice(prefix.length) }, ...rest]
    : undefined;
}

function readQuestions(section: Section | undefined): Question[] | undefined {
  if (section === undefined) return undefined;
  const questions: Question[] = [];

  for (const node of section.body) {
    const current = questions.at(-1);

    if (node.type === 'heading') {
      const heading = section.subheadings[questions.length];
      const question = withoutPrefix(node, 'Q: ');

      if (heading === undefined || question === undefined) return undefined;
      questions.push({ type: 'question', id: heading.id, question, children: [] });
    } else if (current !== undefined && current.children.length > 0) {
      current.children.push(node);
    } else {
      const answer = current !== undefined && node.type === 'paragraph' ? withoutPrefix(node, 'A: ') : undefined;

      if (current === undefined || answer === undefined) return undefined;
      current.children.push({ type: 'paragraph', children: answer });
    }
  }

  return questions.length > 0 ? questions : undefined;
}

function loadOrThrow() {
  const { ids, intro, sections } = parse();
  const byId = new Map(sections.map((section) => [section.id, section]));
  const problems: string[] = [];

  const listed = [
    ...pageTable.flatMap((entry) => entry.sections.map((id) => ({ id, by: `The page "${entry.slug}"` }))),
    ...omitted.map((id) => ({ id, by: 'omitted' })),
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

  for (const part of parts) {
    for (const node of part.nodes.flatMap((child) => [...walk(child)])) {
      if (node.type === 'code' && node.lang && !isSupportedLanguage(node.lang)) {
        problems.push(`A code block in ${part.name} has the language "${node.lang}", which Highlights does not support.`);
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

  const install = readInstall(byId.get(installSection));

  if (install === undefined) problems.push(`#${installSection} must have a code block "npm install <name>".`);
  const transition = readCost(byId.get('performance-in-development'), /a transition costs (approximately [\d.]+ µs)/g);

  if (transition === undefined) {
    problems.push('#performance-in-development must say "a transition costs approximately <number> µs" one time.');
  }

  const startup = readCost(byId.get('production-builds'), /(approximately \d+ to \d+ bytes)/g);

  if (startup === undefined) {
    problems.push('#production-builds must say "approximately <number> to <number> bytes" one time.');
  }

  const questions = readQuestions(byId.get(accordion));

  if (questions === undefined) {
    problems.push(`#${accordion} must be headings "Q: <question>", and each heading must start with a paragraph "A: <answer>".`);
  }

  if (
    problems.length > 0 ||
    install === undefined ||
    transition === undefined ||
    startup === undefined ||
    questions === undefined
  ) {
    throw new Error(
      'site/src/site.tsx and packages/konat/README.md do not agree.\n' +
        problems.map((problem) => `- ${problem}`).join('\n'),
    );
  }

  return {
    pages: pageTable.map((entry) =>
      toPage(
        entry,
        entry.sections.flatMap((id) => byId.get(id) ?? []).map((section) => {
          if (section.id === accordion) return { ...section, body: questions, subheadings: [] };

          if (section.id !== installSection) return section;
          const tabs: InstallCommand = { type: 'installCommand', name: install.name };

          return { ...section, body: section.body.map((node) => (node === install.node ? tabs : node)) };
        }),
      ),
    ),
    hrefs,
    pitch: toString(pitchNode),
    lead: [lead],
    benefits: [bullets],
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
    render: () => render(body),
  };
}

function render(nodes: RootContent[]): ReactNode {
  const tree = toHast({ type: 'root', children: nodes }, {
    allowDangerousHtml: true,
    handlers: { code: highlight, question: toDetails, installCommand: toInstallTabs },
  });

  return toJsxRuntime(raw(tree), { Fragment, jsx, jsxs, components });
}

function highlight(_state: State, node: Code): Element {
  const lang = node.lang && isSupportedLanguage(node.lang) ? node.lang : 'plain';
  const { tokens } = codeToTokens(node.value, { lang, theme: codeTheme });

  const lines = tokens.map((line): Element => ({
    type: 'element',
    tagName: 'span',
    properties: { className: ['line'] },
    children: line.map(toSpan),
  }));

  return {
    type: 'element',
    tagName: 'pre',
    properties: { tabIndex: 0 },
    children: [
      {
        type: 'element',
        tagName: 'code',
        properties: {},
        children: lines.flatMap((line, index): ElementContent[] => (index === 0 ? [line] : [{ type: 'text', value: '\n' }, line])),
      },
    ],
  };
}

function toSpan({ content, color, fontStyle = 0 }: ThemedToken): Element {
  const style = [
    color && `color:${color}`,
    fontStyle & 1 && 'font-style:italic',
    fontStyle & 2 && 'font-weight:bold',
  ].filter(Boolean);

  return {
    type: 'element',
    tagName: 'span',
    properties: style.length > 0 ? { style: style.join(';') } : {},
    children: [{ type: 'text', value: content }],
  };
}

function toDetails(state: State, node: Question): Element {
  return {
    type: 'element',
    tagName: 'details',
    properties: { id: node.id },
    children: [
      {
        type: 'element',
        tagName: 'summary',
        properties: {},
        children: state.all({ type: 'paragraph', children: node.question }),
      },
      { type: 'element', tagName: 'div', properties: {}, children: state.all(node) },
    ],
  };
}

function toInstallTabs(_state: State, node: InstallCommand): Element {
  return { type: 'element', tagName: 'install-tabs', properties: { name: node.name }, children: [] };
}

function DocLink({ href = '', children }: ComponentProps<'a'>) {
  const target = href.startsWith('#') ? hrefFor(href.slice(1)) : href;

  return target.startsWith('/') ? <Link href={target}>{children}</Link> : <a href={target}>{children}</a>;
}

function CodeBlock({ className = '', ...props }: ComponentProps<'pre'>) {
  return (
    <figure className="group relative mb-4">
      <pre
        {...props}
        className={`m-0 overflow-x-auto rounded-xl bg-surface px-5 py-4 text-[13px] leading-[1.6] [@media(hover:none)]:pt-10 ${className}`}
      />
      <CopyCodeButton />
    </figure>
  );
}

function ScrollTable(props: ComponentProps<'table'>) {
  return (
    <div className="my-6 overflow-x-auto rounded-xl border border-line">
      <table {...props} />
    </div>
  );
}

const components = {
  a: DocLink,
  pre: CodeBlock,
  table: ScrollTable,
  details: AccordionItem,
  summary: AccordionTrigger,
  'install-tabs': InstallTabs,
  h2: ({ id, children }: ComponentProps<'h2'>) => (
    <h2 id={id}>
      <a href={`#${id}`} className="text-inherit no-underline hover:underline">
        {children}
      </a>
    </h2>
  ),
  h3: ({ id, children }: ComponentProps<'h3'>) => (
    <h3 id={id}>
      <a href={`#${id}`} className="text-inherit no-underline hover:underline">
        {children}
      </a>
    </h3>
  ),
};

const site = loadOrThrow();

export const pages: readonly DocsPage[] = site.pages;

export function findPage(slug: string): DocsPage | undefined {
  return pages.find((page) => page.slug === slug);
}

export const nav: readonly NavItem[] = [
  { href: '/', title: 'Overview', headings: landingHeadings },
  ...pages.map(({ slug, href, title, headings }) => ({
    href,
    title,
    headings,
    version: slug === 'install' ? `v${konatPackage.version}` : undefined,
  })),
];

export const pitch: string = site.pitch;

export const costs: { transition: string; startup: string } = site.costs;

export const renderLead = (): ReactNode => render(site.lead);

export const renderBenefits = (): ReactNode => render(site.benefits);

export function hrefFor(id: string): string {
  const href = site.hrefs.get(id);

  if (href === undefined) throw new Error(`site/src/site.tsx: no page shows the README heading #${id}.`);

  return href;
}
