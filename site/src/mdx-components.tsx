import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { AdapterTab, AdapterTabs } from '@/components/docs/adapter-tabs';
import { CodeBlock, HighlightedCode } from '@/components/docs/code-block';
import { InstallTabs } from '@/components/docs/install-tabs';
import { Prop, PropsTable } from '@/components/docs/props-table';
import { Shortcut } from '@/components/docs/shortcut';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Kbd } from '@/components/ui/kbd';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { packageManagers } from '@/content/package-managers';
import { CheckoutExample } from '@/demo/checkout/example';
import { demoSources } from '@/demo/source';
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

function FaqQuestion({ children }: { children: ReactNode }) {
  return <AccordionTrigger className="text-[15px]/[1.6]">{children}</AccordionTrigger>;
}

function FaqAnswer({ children }: { children: ReactNode }) {
  return <AccordionContent className="text-[15px]/[1.6]">{children}</AccordionContent>;
}

function Install({ packages }: { packages: string }) {
  const commands = packageManagers.map(({ manager, add }) => {
    const text = `${add} ${packages}`;

    return { manager, text, code: <HighlightedCode text={text} lang="bash" /> };
  });

  return <InstallTabs commands={commands} />;
}

function CheckoutDemo() {
  return (
    <CheckoutExample fixturesHref={checkedHref('/docs/fixtures')} pageHref={demoHref('checkout')} sources={demoSources('checkout')} />
  );
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
  AdapterTabs,
  AdapterTab,
  CheckoutDemo,
  PropsTable,
  Prop,
  Faq,
  FaqItem,
  FaqQuestion,
  FaqAnswer,
} satisfies MDXComponents;

export function useMDXComponents(): MDXComponents {
  return components;
}
