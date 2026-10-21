import { act } from '@testing-library/react';
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

/**
 * Runs `run`, waits one real tick, and returns the errors that reached the page uncaught meanwhile.
 * XState throws an error that no observer handles from a timer, so the tick lets that timer run.
 * React runs the effects of a render in `run` when its act() ends, so the tick comes after that act().
 */
export async function uncaught(run: () => unknown): Promise<unknown[]> {
  const errors: unknown[] = [];

  const record = (error: unknown) => {
    errors.push(error);
  };

  process.on('uncaughtException', record);

  try {
    await act(async () => {
      await run();
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  } finally {
    process.off('uncaughtException', record);
  }

  return errors;
}
