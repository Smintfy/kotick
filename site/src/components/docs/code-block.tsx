import { codeToTokens, isSupportedLanguage, type Lang, type ThemedToken } from '@pierre/highlights';
import { cn } from 'cn';
import { type ComponentProps, Fragment, isValidElement, type ReactNode } from 'react';
import { CopyCodeButton } from '@/components/copy-button';
import { codeTheme } from '@/components/docs/code-theme';
import { ScrollArea } from '@/components/ui/scroll-area';

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

export function HighlightedPre({ text, lang, className }: { text: string; lang: Lang; className?: string }) {
  return (
    <pre
      data-line-numbers={(lang !== 'plain' && text.includes('\n')) || undefined}
      className={cn('m-0 w-max min-w-full p-(--code-padding) text-[13px] leading-[1.6]', className)}
    >
      <code>
        <HighlightedCode text={text} lang={lang} />
      </code>
    </pre>
  );
}

export function CodeBlock({ children }: ComponentProps<'pre'>) {
  const { lang, text } = readCode(children);

  return (
    <figure className="group relative my-6">
      <ScrollArea
        scrollbars="horizontal"
        className="overflow-clip rounded-xl shadow-edge"
        viewportClassName="scroll-fade-x overflow-y-hidden! overscroll-x-none focus-visible:ring-inset"
      >
        <HighlightedPre text={text} lang={lang} className="[@media(hover:none)]:pt-10" />
      </ScrollArea>
      <CopyCodeButton />
    </figure>
  );
}
