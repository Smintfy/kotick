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
import { costs } from '@/content/costs';
import { packageManagers } from '@/content/package-managers';
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
  const start = element.children[0]?.position?.start.offset;
  const end = element.children.at(-1)?.position?.end.offset;

  if (start === undefined || end === undefined) return '';

  return mdxToMarkdown(source.slice(start, end));
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

const jsx = {
  InstallTabs: (element) => {
    const packages = stringAttribute(element, 'packages');
    const [first, ...others] = packageManagers.map(({ add }) => `${add} ${packages}`);
    const alternatives = others.map((command) => `\`${command}\``).join(', ');

    return `\`\`\`bash\n${first}\n\`\`\`\n\nOther package managers: ${alternatives}.`;
  },
  CheckoutDemo: () => `The [checkout demo](${demoHref('checkout')}) runs the real overlay beside a checkout app.`,
  ArchitectureDiagram: (element) => `*Figure: ${stringAttribute(element, 'caption')}*`,
  Kbd: (element) => `\`${toString(element)}\``,
  PanelFigure: (element) => `*Figure: ${stringAttribute(element, 'caption')}*`,
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

      return render(node, source);
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

      edits.push({ start, end, text });

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
