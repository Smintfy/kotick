import type { Theme } from '@pierre/highlights';

const plain = '#343740';
const comment = '#828790';
const punctuation = '#717784';
const keyword = '#8b42bd';
const string = '#16816b';
const fn = '#286cb7';
const constant = '#c46524';
const tag = '#ba4162';

/** The syntax palette of agentation.com, from its prism-react-renderer theme, in the Zed syntax names of Highlights. */
export const codeTheme = {
  name: 'konat light',
  appearance: 'light',
  style: {
    'editor.foreground': plain,
    syntax: {
      primary: plain,
      variable: plain,
      property: plain,
      embedded: plain,
      comment,
      punctuation,
      'punctuation.bracket': punctuation,
      'punctuation.delimiter': punctuation,
      'punctuation.special': punctuation,
      operator: punctuation,
      keyword,
      'keyword.operator': keyword,
      preproc: keyword,
      string,
      'string.escape': string,
      'string.regex': string,
      'string.special': string,
      'text.literal': string,
      function: fn,
      attribute: fn,
      number: constant,
      boolean: constant,
      constant,
      tag,
      type: tag,
      'type.builtin': tag,
      constructor: tag,
      enum: tag,
      'diff.minus': tag,
      'diff.plus': string,
      emphasis: { font_style: 'italic' },
      'emphasis.strong': { font_weight: 700 },
    },
  },
} satisfies Theme;
