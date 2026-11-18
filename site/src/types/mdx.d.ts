declare module '*.mdx' {
  const Content: import('mdx/types').MDXContent;
  export default Content;

  /** Each docs page exports this. site.tsx checks it when the site builds. */
  export const metadata: { title: string; description: string } | undefined;

  /** From src/mdx/remark-headings.mjs. */
  export const headings: ReadonlyArray<{ id: string; text: string; depth: 2 | 3 }>;

  /** From src/mdx/remark-headings.mjs. Each Markdown link whose URL starts with "/". */
  export const links: readonly string[];
}
