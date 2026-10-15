// @vitest-environment node
// <StateViewer /> renders on the server like any client component, and does nothing there.

import { renderToString } from 'react-dom/server';
import { StateViewer } from 'state-viewer';
import { expect, test } from 'vitest';
import { watchConsole } from './support/console';

test('renders nothing, loads no fixtures, and leaves globalThis as it was', () => {
  const output = watchConsole();
  const loads: string[] = [];
  const globals = Reflect.ownKeys(globalThis);

  const html = renderToString(
    <StateViewer
      defaultOpen
      fixtures={() => {
        loads.push('fixtures');
        return [];
      }}
    />,
  );
  const added = Reflect.ownKeys(globalThis).filter((key) => !globals.includes(key));
  expect({ html, loads, added, output }).toEqual({ html: '', loads: [], added: [], output: { warn: [], error: [] } });
});
