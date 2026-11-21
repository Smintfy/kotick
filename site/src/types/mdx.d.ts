declare module '*.mdx' {
  const Content: import('mdx/types').MDXContent;
  export default Content;

  export const metadata: { title: string; description: string } | undefined;

  export const headings: ReadonlyArray<{ id: string; text: string; depth: 2 | 3 }>;

  export const links: readonly string[];

  /** Whether the page has `<PageAdapterTabs />`. The blocks of such a page leave out their own adapter menu. */
  export const adapterTabs: boolean;
}
