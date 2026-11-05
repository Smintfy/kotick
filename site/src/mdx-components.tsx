import { codeToTokens, isSupportedLanguage, type ThemedToken } from '@pierre/highlights';
import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';
import { type ComponentProps, Fragment, isValidElement, type ReactNode } from 'react';
import { codeTheme } from '@/code-theme';
import { CopyCodeButton } from '@/components/copy-button';
import { InstallTabs } from '@/components/install-tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Kbd } from '@/components/ui/kbd';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function DocLink({ href = '', children }: ComponentProps<'a'>) {
  return href.startsWith('/') ? <Link href={href}>{children}</Link> : <a href={href}>{children}</a>;
}

/** MDX compiles a fenced code block to a <pre> with one <code>. The <code> has the text and a "language-*" class. */
type FencedCode = { className?: string; children: string };

function readCode(children: ReactNode) {
  if (!isValidElement<FencedCode>(children)) throw new Error('A <pre> in the docs is not a fenced code block.');

  const { className = '', children: text } = children.props;
  const lang = /language-(\S+)/.exec(className)?.[1] ?? 'plain';

  if (!isSupportedLanguage(lang)) {
    throw new Error(`A code block in the docs has the language "${lang}", which Highlights does not support.`);
  }

  return { lang, text: text.replace(/\n$/, '') };
}

function tokenStyle({ color, fontStyle = 0 }: ThemedToken) {
  return { color, fontStyle: fontStyle & 1 ? 'italic' : undefined };
}

function CodeBlock({ children }: ComponentProps<'pre'>) {
  const { lang, text } = readCode(children);
  const { tokens } = codeToTokens(text, { lang, theme: codeTheme });

  return (
    <figure className="group relative mb-4">
      <pre
        tabIndex={0}
        data-language={lang}
        className="m-0 overflow-x-auto rounded-xl bg-surface px-5 py-4 text-[13px] leading-[1.6] [@media(hover:none)]:pt-10"
      >
        <code>
          {tokens.map((line, row) => (
            <Fragment key={row}>
              {row > 0 && '\n'}
              <span className="line">
                {line.map((token, column) => (
                  <span key={column} style={tokenStyle(token)}>
                    {token.content}
                  </span>
                ))}
              </span>
            </Fragment>
          ))}
        </code>
      </pre>
      <CopyCodeButton />
    </figure>
  );
}

function AnchorHeading({ as: Tag, id, children }: ComponentProps<'h2'> & { as: 'h2' | 'h3' }) {
  return (
    <Tag id={id}>
      <a href={`#${id}`} className="text-inherit no-underline hover:underline">
        {children}
      </a>
    </Tag>
  );
}

function Faq({ children }: { children: ReactNode }) {
  return (
    <Accordion multiple hiddenUntilFound>
      {children}
    </Accordion>
  );
}

function FaqItem({ id, children }: { id: string; children: ReactNode }) {
  return (
    <AccordionItem id={id} value={id}>
      {children}
    </AccordionItem>
  );
}

const components = {
  a: DocLink,
  pre: CodeBlock,
  h2: (props: ComponentProps<'h2'>) => <AnchorHeading as="h2" {...props} />,
  h3: (props: ComponentProps<'h3'>) => <AnchorHeading as="h3" {...props} />,
  table: (props: ComponentProps<'table'>) => <Table {...props} className="mb-4" />,
  thead: TableHeader,
  tbody: TableBody,
  tr: TableRow,
  th: TableHead,
  td: (props: ComponentProps<'td'>) => <TableCell {...props} className="whitespace-normal" />,
  Kbd,
  InstallTabs,
  Faq,
  FaqItem,
  FaqQuestion: AccordionTrigger,
  FaqAnswer: AccordionContent,
} satisfies MDXComponents;

export function useMDXComponents(): MDXComponents {
  return components;
}
