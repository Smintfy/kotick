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

type JsxElement = MdxJsxFlowElement | MdxJsxTextElement;

const parser = unified().use(remarkParse).use(remarkMdx).use(remarkGfm);

/** The values of the expressions that the docs can use in the text, such as `{costs.startup}`. */
const expressions: ReadonlyMap<string, string> = new Map(
  Object.entries(costs).map(([key, value]) => [`costs.${key}`, value]),
);

function stringAttribute(element: JsxElement, name: string): string {
  const value = element.attributes.find((attribute) => 'name' in attribute && attribute.name === name)?.value;

  if (typeof value !== 'string') throw new Error(`<${element.name}> needs the string attribute ${name}.`);

  return value;
}

/** Reads an attribute such as `other={['Alt', 'S']}`. Only an array of string literals is accepted. */
function stringArrayAttribute(element: JsxElement, name: string): string[] {
  const value = element.attributes.find((attribute) => 'name' in attribute && attribute.name === name)?.value;
  const program = typeof value === 'object' ? value?.data?.estree : undefined;
  const statement = program?.body[0];
  const array = statement?.type === 'ExpressionStatement' ? statement.expression : undefined;
  const items = array?.type === 'ArrayExpression' ? array.elements : [];
  const strings = items.flatMap((item) => (item?.type === 'Literal' && typeof item.value === 'string' ? [item.value] : []));

  if (strings.length === 0 || strings.length !== items.length) {
    throw new Error(`<${element.name}> needs ${name} to be an array of strings.`);
  }

  return strings;
}

/** The Markdown for each component that a page with a Markdown copy can use. */
const jsx: Record<string, (element: JsxElement) => string> = {
  InstallTabs: (element) => {
    const name = stringAttribute(element, 'name');
    const commands = packageManagers.map(({ add }) => `${add} ${name}`).join('\n');

    return `\`\`\`bash\n${commands}\n\`\`\``;
  },
  Kbd: (element) => `\`${toString(element)}\``,
  PanelFigure: (element) => `*Figure: ${stringAttribute(element, 'caption')}*`,
  Shortcut: (element) =>
    `\`${stringArrayAttribute(element, 'other').join('+')}\` (\`${stringAttribute(element, 'mac')}\` on macOS)`,
};

function expression(value: string): string {
  const trimmed = value.trim();

  if (trimmed.startsWith('/*') && trimmed.endsWith('*/')) return '';

  const result = expressions.get(trimmed);

  if (result === undefined) throw new Error(`The Markdown copy cannot show the expression {${trimmed}}.`);

  return result;
}

/** The Markdown for a node, or `undefined` to keep its source text. */
function replacement(node: Nodes): string | undefined {
  switch (node.type) {
    case 'mdxjsEsm':
      return '';
    case 'mdxFlowExpression':
    case 'mdxTextExpression':
      return expression(node.value);
    case 'mdxJsxFlowElement':
    case 'mdxJsxTextElement': {
      const render = node.name ? jsx[node.name] : undefined;

      if (!render) throw new Error(`The Markdown copy has no text for <${node.name ?? ''}>.`);

      return render(node);
    }
    default:
      return undefined;
  }
}

/**
 * Turns MDX into Markdown that an LLM or a person can read without the site.
 * The text outside the MDX parts stays the same as in the source. Thus, the code blocks and the tables keep their format.
 */
export function mdxToMarkdown(source: string): string {
  const edits: Array<{ start: number; end: number; text: string }> = [];

  const walk = (node: Nodes) => {
    const text = replacement(node);

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

/** The Markdown copy of a docs page: the title, the description, and the content. */
export async function pageMarkdown(page: { slug: string; title: string; description: string }): Promise<string> {
  const source = await readFile(path.join(process.cwd(), 'src/content/docs', `${page.slug}.mdx`), 'utf8');

  return `# ${page.title}\n\n${page.description}\n\n${mdxToMarkdown(source)}\n`;
}
