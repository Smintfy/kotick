import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Shiru } from 'shiru';
import { connect, useMachine } from 'shiru/xstate';
import { describe, expect, onTestFinished, test } from 'vitest';
import { assign, createActor, createMachine, sendTo, setup } from 'xstate';
import { watchConsole } from './support/console';
import { blockedEvents, flush, freshId, overlay, preview, release, show, shownKey } from './support/panel';

type PaymentContext = { note: string };

type PaymentEvent = { type: 'PAY' } | { type: 'FAIL'; note: string };

function createPaymentMachine() {
  return setup({
    // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
    types: { context: {} as PaymentContext, events: {} as PaymentEvent },
  }).createMachine({
    id: freshId('payment'),
    context: { note: 'none' },
    initial: 'editing',
    states: {
      editing: { on: { PAY: 'processing' } },
      processing: { on: { FAIL: { target: 'error', actions: assign({ note: ({ event }) => event.note }) } } },
      error: {},
    },
  });
}

type PaymentMachine = ReturnType<typeof createPaymentMachine>;

function Payment({ machine }: { machine: PaymentMachine }) {
  const [snapshot, send] = useMachine(machine);

  return (
    <>
      <output>{JSON.stringify({ value: snapshot.value, context: snapshot.context })}</output>
      <button type="button" onClick={() => send({ type: 'PAY' })}>
        Pay
      </button>
      <button type="button" onClick={() => send({ type: 'FAIL', note: 'card declined' })}>
        Fail
      </button>
    </>
  );
}

function clearButton(): HTMLButtonElement | undefined {
  return [...overlay().querySelectorAll('button')].find((button) => button.textContent === 'Clear');
}

/** The count, the rows and the Clear button that the log shows. The panel shows the count and Clear only with events. */
function eventLog() {
  return {
    count: overlay().querySelector('[data-part="count"]')?.textContent ?? '',
    rows: blockedEvents(),
    clear: clearButton() ? 'shown' : 'hidden',
  };
}

function times(): string[] {
  return [...overlay().querySelectorAll('[data-part="log-entry"] [data-part="time"]')].map((time) => time.textContent ?? '');
}

async function clear(): Promise<void> {
  const button = clearButton();

  if (button) fireEvent.click(button);
  await flush();
}

/**
 * Renders the app next to an open overlay, and shows the first machine that the panel lists.
 * Then it clears the blocked events that earlier tests in the file left. Each machine page lists the page's events.
 */
async function mount(app: ReactNode): Promise<void> {
  render(
    <>
      {app}
      <Shiru defaultOpen />
    </>,
  );
  await flush();
  const first = overlay().querySelector<HTMLElement>('button[data-machine]')?.dataset.machine;

  if (first === undefined) throw new Error('The app registers no machine.');
  await show(first);
  await clear();
}

async function press(name: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name }));
  await flush();
}

/**
 * Presses a button, and returns each local time from a Date.now() read before the click to one after it.
 * The times are HH:MM:SS, as a row of the log shows them.
 */
async function pressTimed(name: string): Promise<string[]> {
  const before = Date.now();
  fireEvent.click(screen.getByRole('button', { name }));
  const after = Date.now();
  await flush();
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');

  return Array.from({ length: after - before + 1 }, (_, offset) => {
    const date = new Date(before + offset);

    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  });
}

function shown() {
  return JSON.parse(screen.getByRole('status').textContent ?? 'null');
}

/**
 * Starts an actor outside React and connects it, as an app does.
 * The actor stops when the test ends.
 */
function startPayment(machine: PaymentMachine) {
  const real = createActor(machine).start();
  onTestFinished(() => {
    real.stop();
  });

  return { real, proxy: connect(real) };
}

function liveWarning(leaves: string, key: string) {
  return `[shiru] No recorded or fixture context for "${leaves}" on "${key}", so the preview uses the live context.`;
}

test('events sent during a preview are blocked and listed, newest first, and reach the actor again after the release', async () => {
  const output = watchConsole();
  const machine = createPaymentMachine();
  await mount(<Payment machine={machine} />);
  const empty = eventLog();

  await preview(machine.id, ['error']);
  const paid = await pressTimed('Pay');
  const failed = await pressTimed('Fail');
  const blocked = { shown: shown(), log: eventLog(), times: times() };
  await release(machine.id);
  const released = shown();
  await press('Pay');
  const rows = [`FAIL · ${machine.id} · 1 · in error · {"note":"card declined"}`, `PAY · ${machine.id} · 1 · in error`];
  expect({ empty, blocked, released, after: { shown: shown(), rows: eventLog().rows }, warnings: output.warn }).toEqual({
    empty: { count: '', rows: [], clear: 'hidden' },
    blocked: {
      shown: { value: 'error', context: { note: 'none' } },
      log: { count: '2', rows, clear: 'shown' },
      times: [expect.toBeOneOf(failed), expect.toBeOneOf(paid)],
    },
    released: { value: 'editing', context: { note: 'none' } },
    after: { shown: { value: 'processing', context: { note: 'none' } }, rows },
    warnings: [liveWarning('error', shownKey())],
  });
});

test('Clear empties the list, and events blocked later start a new one', async () => {
  const machine = createPaymentMachine();
  await mount(<Payment machine={machine} />);
  await preview(machine.id, ['error']);
  await press('Pay');

  await clear();
  const cleared = eventLog();
  await press('Fail');
  expect({ cleared, later: eventLog() }).toEqual({
    cleared: { count: '', rows: [], clear: 'hidden' },
    later: {
      count: '1',
      rows: [`FAIL · ${machine.id} · 1 · in error · {"note":"card declined"}`],
      clear: 'shown',
    },
  });
});

test('an event sent again right after the same one shows once, with a count', async () => {
  const machine = createPaymentMachine();
  await mount(<Payment machine={machine} />);
  await preview(machine.id, ['error']);

  await press('Pay');
  await press('Pay');
  const repeated = eventLog();
  await press('Fail');
  await press('Pay');
  expect({ repeated, apart: eventLog() }).toEqual({
    repeated: { count: '2', rows: [`PAY ×2 · ${machine.id} · 1 · in error`], clear: 'shown' },
    apart: {
      count: '4',
      rows: [
        `PAY · ${machine.id} · 1 · in error`,
        `FAIL · ${machine.id} · 1 · in error · {"note":"card declined"}`,
        `PAY ×2 · ${machine.id} · 1 · in error`,
      ],
      clear: 'shown',
    },
  });
});

describe('the limit', () => {
  test('the list keeps the newest 200 events, so the oldest goes first, also after Clear', async () => {
    const machine = createPaymentMachine();
    const { proxy } = startPayment(machine);
    await mount(null);
    await preview(machine.id, ['error']);
    const { send } = proxy;

    const failUpTo = async (from: number, to: number) => {
      act(() => {
        for (let n = from; n <= to; n++) send({ type: 'FAIL', note: `#${n}` });
      });
      await flush();
    };

    const row = (n: number) => `FAIL · ${machine.id} · 1 · in error · {"note":"#${n}"}`;

    const newest = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, offset) => row(to - offset));

    // 607 events fill the list of 200 more than three times.
    await failUpTo(1, 607);
    const laps = eventLog();
    await clear();
    await failUpTo(1001, 1201);
    expect({ laps, afterClear: eventLog() }).toEqual({
      laps: { count: '200', rows: newest(408, 607), clear: 'shown' },
      afterClear: { count: '200', rows: newest(1002, 1201), clear: 'shown' },
    });
  });
});

describe('events that are not objects with a string type', () => {
  test("a string event throws XState's error, and one without a string type is dropped with a warning", async () => {
    const output = watchConsole();
    const machine = createPaymentMachine();
    const { real, proxy } = startPayment(machine);
    await mount(null);
    await preview(machine.id, ['processing']);
    const key = shownKey();
    let thrown = 'nothing thrown';

    try {
      // @ts-expect-error an event is an object, and the test sends a string as a JavaScript app can
      proxy.send('PAY');
    } catch (error) {
      thrown = error instanceof Error ? error.message : String(error);
    }

    // @ts-expect-error the type of an event is a string, and the test sends a number as a JavaScript app can
    act(() => proxy.send({ type: 42 }));
    await flush();
    expect({ thrown, log: eventLog(), real: real.getSnapshot().value, warnings: output.warn }).toEqual({
      thrown: 'Only event objects may be sent to actors; use .send({ type: "PAY" }) instead',
      log: { count: '', rows: [], clear: 'hidden' },
      real: 'editing',
      warnings: [
        liveWarning('processing', key),
        `[shiru] Dropped an event without a string type sent to "${key}" during a preview. { type: 42 }`,
      ],
    });
  });
});

describe('events from another actor', () => {
  test('an event sent with sendTo is blocked too, and reaches the actor once the preview is released', async () => {
    const machine = createPaymentMachine();
    const { real, proxy } = startPayment(machine);
    const sender = createActor(createMachine({ on: { PING: { actions: sendTo(proxy, { type: 'PAY' }) } } })).start();
    onTestFinished(() => {
      sender.stop();
    });
    await mount(null);
    await preview(machine.id, ['error']);

    const ping = async () => {
      await act(async () => {
        sender.send({ type: 'PING' });
      });
    };

    await ping();
    const blocked = { rows: eventLog().rows, real: real.getSnapshot().value };
    await release(machine.id);
    await ping();
    expect({ blocked, delivered: real.getSnapshot().value }).toEqual({
      blocked: { rows: [`PAY · ${machine.id} · 1 · in error`], real: 'editing' },
      delivered: 'processing',
    });
  });
});
