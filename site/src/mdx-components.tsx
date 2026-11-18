import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { CodeBlock, HighlightedCode } from '@/components/code-block';
import { InstallTabs } from '@/components/install-tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Shortcut } from '@/components/shortcut';
import { packageManagers } from '@/content/package-managers';
import { Kbd } from '@/components/ui/kbd';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CheckoutExample } from '@/demo/checkout/example';
import { checkedHref, demoHref } from '@/site';

function DocLink({ href = '', children }: ComponentProps<'a'>) {
  return href.startsWith('/') ? <Link href={href}>{children}</Link> : <a href={href}>{children}</a>;
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

/** The checkout demo on the landing page. */
function CheckoutDemo() {
  return <CheckoutExample fixturesHref={checkedHref('/docs/fixtures')} pageHref={demoHref('checkout')} />;
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
  CheckoutDemo,
  Faq,
  FaqItem,
  FaqQuestion: AccordionTrigger,
  FaqAnswer: AccordionContent,
} satisfies MDXComponents;

export function useMDXComponents(): MDXComponents {
  return components;
}
