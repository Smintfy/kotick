import 'react';

declare module 'react' {
  /** Lets a style object set a CSS custom property, such as `--sidebar-width`, without a type assertion. */
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined;
  }
}
