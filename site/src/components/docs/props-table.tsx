import type { ReactNode } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export function PropsTable({ children }: { children: ReactNode }) {
  return (
    <Accordion multiple hiddenUntilFound>
      <Table className="min-w-140 table-fixed [--prop-column:28%]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-(--prop-column)">Prop</TableHead>
            <TableHead className="w-[38%]">Type</TableHead>
            <TableHead>Default</TableHead>
            <TableHead className="w-11">
              <span className="sr-only">Details</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        {children}
      </Table>
    </Accordion>
  );
}

type PropProps = {
  name: string;
  type: string;
  detailedType?: string;
  default?: string;
  children: ReactNode;
};

function DefaultValue({ value }: { value: string | undefined }) {
  return value === undefined ? 'None' : <code>{value}</code>;
}

function RowTrigger({ label }: { label: string }) {
  return (
    <AccordionTrigger className="static py-0 after:absolute after:inset-0">
      <span className="sr-only">{label}</span>
    </AccordionTrigger>
  );
}

export function Prop({ name, type, detailedType = type, default: defaultValue, children }: PropProps) {
  const id = `prop-${name}`;

  return (
    <AccordionItem id={id} value={name} render={<TableBody />} className="border-b last:border-b-0">
      <TableRow className="relative border-b-0">
        <TableCell>
          <code>{name}</code>
        </TableCell>
        <TableCell>
          <code>{type}</code>
        </TableCell>
        <TableCell>
          <DefaultValue value={defaultValue} />
        </TableCell>
        <TableCell>
          <RowTrigger label={name} />
        </TableCell>
      </TableRow>
      <TableRow className="border-b-0">
        <TableCell colSpan={4} className="h-auto p-0 first:pl-0 last:pr-0">
          <AccordionContent className="pt-2 pb-4 text-sm">
            <dl className="grid grid-cols-[var(--prop-column)_minmax(0,1fr)] items-baseline gap-y-2 [&_dd]:pr-4 [&_dd]:pl-2 [&_dt]:pr-2 [&_dt]:pl-4 [&_dt]:text-muted-foreground [&_p]:m-0">
              <dt>Name</dt>
              <dd>
                <a href={`#${id}`}>
                  <code>{name}</code>
                </a>
              </dd>
              <dt>Description</dt>
              <dd>{children}</dd>
              <dt>Type</dt>
              <dd>
                <code>{detailedType}</code>
              </dd>
              <dt>Default</dt>
              <dd>
                <DefaultValue value={defaultValue} />
              </dd>
            </dl>
          </AccordionContent>
        </TableCell>
      </TableRow>
    </AccordionItem>
  );
}
