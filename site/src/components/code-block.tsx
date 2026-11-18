import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area';
import { codeToTokens, isSupportedLanguage, type Lang, type ThemedToken } from '@pierre/highlights';
import { type ComponentProps, Fragment, isValidElement, type ReactNode } from 'react';
import { codeTheme } from '@/components/code-theme';
import { CopyCodeButton } from '@/components/copy-button';
import { ScrollBar } from '@/components/ui/scroll-area';

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
export function HighlightedCode({ text, lang }: { text: string; lang: Lang }) {
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

export function CodeBlock({ children }: ComponentProps<'pre'>) {
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
        <ScrollBar orientation="horizontal" className="p-0.5 opacity-0 transition-opacity data-hovering:opacity-100 data-scrolling:opacity-100 data-horizontal:border-t-0 *:bg-muted-foreground/35 *:transition-colors hover:*:bg-muted-foreground/70" />
      </ScrollAreaPrimitive.Root>
      <CopyCodeButton />
    </figure>
  );
}
