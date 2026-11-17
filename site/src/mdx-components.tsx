import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area';
import { codeToTokens, isSupportedLanguage, type Lang, type ThemedToken } from '@pierre/highlights';
import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';
import { type ComponentProps, Fragment, isValidElement, type ReactNode } from 'react';
import { codeTheme } from '@/code-theme';
import { CopyCodeButton } from '@/components/copy-button';
import { InstallTabs } from '@/components/install-tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Shortcut } from '@/components/shortcut';
import { packageManagers } from '@/content/package-managers';
import { Kbd } from '@/components/ui/kbd';
import { ScrollBar } from '@/components/ui/scroll-area';
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

/** The lines of `text` in the syntax colors. Each line is a `.line` span, so that the code blocks can number it. */
function HighlightedCode({ text, lang }: { text: string; lang: Lang }) {
  const { tokens } = codeToTokens(text, { lang, theme: codeTheme });

  return tokens.map((line, row) => (
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
  ));
}

function CodeBlock({ children }: ComponentProps<'pre'>) {
  const { lang, text } = readCode(children);

  return (
    <figure className="group relative mb-4">
      {/*
       * The ScrollArea component of shadcn has only a vertical scrollbar and does not accept other scrollbars.
       * Thus, the code block uses the parts, with the classes of the shadcn component.
       */}
      <ScrollAreaPrimitive.Root data-slot="scroll-area" className="relative overflow-clip rounded-xl shadow-code">
        <ScrollAreaPrimitive.Viewport
          data-slot="scroll-area-viewport"
          className="size-full scroll-fade-x overflow-y-hidden! overscroll-x-none rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-1"
        >
          <pre
            data-language={lang}
            className="m-0 w-max min-w-full px-4 py-4 text-[13px] leading-[1.6] [@media(hover:none)]:pt-10"
          >
            <code>
              <HighlightedCode text={text} lang={lang} />
            </code>
          </pre>
        </ScrollAreaPrimitive.Viewport>
        <ScrollBar orientation="horizontal" className="p-0.5 data-horizontal:border-t-0 *:bg-faint/50 *:transition-colors hover:*:bg-faint" />
      </ScrollAreaPrimitive.Root>
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

/** The install command of each package manager. The server colors the commands, so the client gets no highlighter. */
function Install({ name }: { name: string }) {
  const commands = packageManagers.map(({ manager, add }) => {
    const text = `${add} ${name}`;

    return { manager, text, code: <HighlightedCode text={text} lang="bash" /> };
  });

  return <InstallTabs commands={commands} />;
}

const components = {
  a: DocLink,
  pre: CodeBlock,
  h2: (props: ComponentProps<'h2'>) => <AnchorHeading as="h2" {...props} />,
  h3: (props: ComponentProps<'h3'>) => <AnchorHeading as="h3" {...props} />,
  table: Table,
  thead: TableHeader,
  tbody: TableBody,
  tr: TableRow,
  th: TableHead,
  td: TableCell,
  Kbd,
  Shortcut,
  InstallTabs: Install,
  Faq,
  FaqItem,
  FaqQuestion: AccordionTrigger,
  FaqAnswer: AccordionContent,
} satisfies MDXComponents;

export function useMDXComponents(): MDXComponents {
  return components;
}
