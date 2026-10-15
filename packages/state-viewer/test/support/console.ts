import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { format } from 'node:util';
import { onTestFinished } from 'vitest';

type ConsoleOutput = { warn: string[]; error: string[] };

/**
 * Records each line written with console.warn and console.error until the test ends, as the console prints it.
 * Node publishes each call on a diagnostics channel, so nothing is replaced and the lines still print.
 */
export function watchConsole(): ConsoleOutput {
  const output: ConsoleOutput = { warn: [], error: [] };
  for (const level of ['warn', 'error'] as const) {
    const channel = `console.${level}`;
    const record = (args: unknown) => output[level].push(format(...(args as unknown[])));
    subscribe(channel, record);
    onTestFinished(() => {
      unsubscribe(channel, record);
    });
  }
  return output;
}
