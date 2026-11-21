import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Nodes } from 'mdast';
import type { MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { adapters } from '@/content/adapters';
import { costs } from '@/content/costs';
import { packageManagers } from '@/content/package-managers';
import { skill } from '@/content/skill';
import { demoHref } from '@/site';

type JsxElement = MdxJsxFlowElement | MdxJsxTextElement;

const parser = unified().use(remarkParse).use(remarkMdx).use(remarkGfm);

const expressions: ReadonlyMap<string, string> = new Map(
  Object.entries(costs).map(([key, value]) => [`costs.${key}`, value]),
);

function isString<T>(value: T): value is T & string {
  return typeof value === 'string';
}

function optionalStringAttribute(element: JsxElement, name: string): string | undefined {
  const value = element.attributes.find((attribute) => 'name' in attribute && attribute.name === name)?.value;

  if (value === undefined) return undefined;

  if (!isString(value)) throw new Error(`<${element.name}> needs ${name} to be a string.`);

  return value;
}

function stringAttribute(element: JsxElement, name: string): string {
  const value = optionalStringAttribute(element, name);

  if (value === undefined) throw new Error(`<${element.name}> needs the string attribute ${name}.`);

  return value;
}

function childrenMarkdown(element: JsxElement, source: string): string {
  const first = element.children[0]?.position?.start;
  const end = element.children.at(-1)?.position?.end.offset;

  if (first?.offset === undefined || end === undefined) return '';
  // The slice starts at the first child. The lines after it keep the indentation of the JSX, which Markdown reads as code.
  const indentation = new RegExp(`^ {0,${first.column - 1}}`, 'gm');

  return mdxToMarkdown(source.slice(first.offset, end).replace(indentation, ''));
}

// A replacement starts at the column of its element. Its next lines need the same indentation, for example in a list item.
function atColumn(text: string, node: Nodes): string {
  const column = node.position?.start.column ?? 1;

  return text.replace(/\n(?=.)/g, `\n${' '.repeat(column - 1)}`);
}

function tableCell(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').replaceAll('|', '\\|');
}

function propsTable(element: JsxElement, source: string): string {
  const rows = element.children.flatMap((child) => {
    if (child.type !== 'mdxJsxFlowElement' || child.name !== 'Prop') return [];
    const name = stringAttribute(child, 'name');
    const type = optionalStringAttribute(child, 'detailedType') ?? stringAttribute(child, 'type');
    const value = optionalStringAttribute(child, 'default');
    const cells = [`\`${name}\``, `\`${type}\``, value === undefined ? 'None' : `\`${value}\``, childrenMarkdown(child, source)];

    return [`| ${cells.map(tableCell).join(' | ')} |`];
  });

  return ['| Prop | Type | Default | Description |', '|---|---|---|---|', ...rows].join('\n');
}

function stringArrayAttribute(element: JsxElement, name: string): string[] {
  const value = element.attributes.find((attribute) => 'name' in attribute && attribute.name === name)?.value;
  const program = isString(value) ? undefined : value?.data?.estree;
  const statement = program?.body[0];
  const array = statement?.type === 'ExpressionStatement' ? statement.expression : undefined;
  const items = array?.type === 'ArrayExpression' ? array.elements : [];
  const strings = items.flatMap((item) => (item?.type === 'Literal' && isString(item.value) ? [item.value] : []));

  if (strings.length === 0 || strings.length !== items.length) {
    throw new Error(`<${element.name}> needs ${name} to be an array of strings.`);
  }

  return strings;
}

/** The Markdown of each `<AdapterTab>` child, by adapter. */
function adapterTabMarkdown(element: JsxElement, source: string): Map<string, string> {
  const tabs = new Map<string, string>();

  for (const child of element.children) {
    if (child.type !== 'mdxJsxFlowElement' || child.name !== 'AdapterTab') continue;
    const id = stringAttribute(child, 'adapter');

    if (!adapters.some((adapter) => adapter.id === id)) {
      throw new Error(`<AdapterTab> has the adapter "${id}", which is not in src/content/adapters.ts.`);
    }

    tabs.set(id, childrenMarkdown(child, source));
  }

  return tabs;
}

function adapterTabs(element: JsxElement, source: string): string {
  const tabs = adapterTabMarkdown(element, source);

  return adapters
    .flatMap(({ id, entry }) => (tabs.has(id) ? [`With \`${entry}\`:\n\n${tabs.get(id)}`] : []))
    .join('\n\n');
}

function installMarkdown(packages: string): string {
  const [first, ...others] = packageManagers.map(({ add }) => `${add} ${packages}`);
  const alternatives = others.map((command) => `\`${command}\``).join(', ');

  return `\`\`\`bash\n${first}\n\`\`\`\n\nOther package managers: ${alternatives}.`;
}

const jsx = {
  AdapterTabs: adapterTabs,
  InstallTabs: (element, source) => {
    const packages = optionalStringAttribute(element, 'packages');

    if (packages !== undefined) return installMarkdown(packages);

    const notes = adapterTabMarkdown(element, source);

    return adapters
      .map(({ id, entry }) =>
        [`With \`${entry}\`:`, installMarkdown(stringAttribute(element, id)), notes.get(id)]
          .filter((part) => part !== undefined)
          .join('\n\n'),
      )
      .join('\n\n');
  },
  CheckoutDemo: () =>
    `The [checkout demo](${demoHref('checkout')}) runs the real overlay beside a checkout app, with a version for each adapter.`,
  ArchitectureDiagram: (element) => `*Figure: ${stringAttribute(element, 'caption')}*`,
  Kbd: (element) => `\`${toString(element)}\``,
  PanelFigure: (element) => {
    const caption = optionalStringAttribute(element, 'caption');

    if (caption !== undefined) return `*Figure: ${caption}*`;

    return adapters
      .map(({ id, entry }) => `With \`${entry}\`:\n\n*Figure: ${stringAttribute(element, `${id}Caption`)}*`)
      .join('\n\n');
  },
  PageAdapterTabs: () => '',
  PropsTable: propsTable,
  Shortcut: (element) =>
    `\`${stringArrayAttribute(element, 'other').join('+')}\` (\`${stringAttribute(element, 'mac')}\` on macOS)`,
} satisfies Record<string, (element: JsxElement, source: string) => string>;

function hasMarkdown(name: string): name is keyof typeof jsx {
  return Object.hasOwn(jsx, name);
}

function expression(value: string): string {
  const trimmed = value.trim();

  if (trimmed.startsWith('/*') && trimmed.endsWith('*/')) return '';

  const result = expressions.get(trimmed);

  if (result === undefined) throw new Error(`The Markdown copy cannot show the expression {${trimmed}}.`);

  return result;
}

function replacement(node: Nodes, source: string): string | undefined {
  switch (node.type) {
    case 'mdxjsEsm':
      return '';
    case 'mdxFlowExpression':
    case 'mdxTextExpression':
      return expression(node.value);
    case 'mdxJsxFlowElement':
    case 'mdxJsxTextElement': {
      const render = node.name && hasMarkdown(node.name) ? jsx[node.name] : undefined;

      if (!render) throw new Error(`The Markdown copy has no text for <${node.name ?? ''}>.`);

      return atColumn(render(node, source), node);
    }

    default:
      return undefined;
  }
}

export function mdxToMarkdown(source: string): string {
  const edits: Array<{ start: number; end: number; text: string }> = [];

  const walk = (node: Nodes) => {
    const text = replacement(node, source);

    if (text !== undefined) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;

      if (start === undefined || end === undefined) throw new Error(`The ${node.type} node has no position.`);

      // A block without text also takes the blank lines after it, so the copy has no gap.
      const block = node.type === 'mdxJsxFlowElement' || node.type === 'mdxFlowExpression' || node.type === 'mdxjsEsm';
      const gap = block && text === '' ? (/^\n*/.exec(source.slice(end))?.[0].length ?? 0) : 0;

      edits.push({ start, end: end + gap, text });

      return;
    }

    if ('children' in node) for (const child of node.children) walk(child);
  };

  walk(parser.parse(source));

  return edits.reduceRight((text, { start, end, text: value }) => text.slice(0, start) + value + text.slice(end), source).trim();
}

export async function pageMarkdown(page: { slug: string; title: string; description: string }): Promise<string> {
  const source = await readFile(path.join(process.cwd(), 'src/content/docs', `${page.slug}.mdx`), 'utf8');

  return `# ${page.title}\n\n${page.description}\n\n${mdxToMarkdown(source)}\n`;
}

/** The SKILL.md of the skill page: the frontmatter, then the text after the MDX comment that says SKILL.md. */
export async function skillMarkdown(): Promise<string> {
  const source = await readFile(path.join(process.cwd(), 'src/content/docs/agent-skill.mdx'), 'utf8');
  const [, body, ...others] = source.split('{/* SKILL.md */}');

  if (body === undefined || others.length > 0) throw new Error('src/content/docs/agent-skill.mdx must have one {/* SKILL.md */} comment.');

  return `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n# ${skill.name}\n\n${mdxToMarkdown(body)}\n`;
}
