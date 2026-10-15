import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { format } from 'node:util';
import { onTestFinished } from 'vitest';

type ConsoleOutput = { warn: string[]; error: string[] };

/**
 * Node publishes each console.warn and console.error call on a diagnostics channel.
 * So the console methods stay as they are, and the lines still print.
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
