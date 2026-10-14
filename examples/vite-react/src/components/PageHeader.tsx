import type { Example } from '@/examples.ts';

export function PageHeader({ example }: { example: Example }) {
  return (
    <header className="page-header">
      <h1>{example.title}</h1>
      <p className="pattern">
        <code>{example.api}</code>
      </p>
      <p className="muted">{example.summary}</p>
    </header>
  );
}
