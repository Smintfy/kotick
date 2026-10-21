import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { StateViewer } from 'state-viewer';
import { connect, useActorRef, useMachine, useSelector } from 'state-viewer/xstate';
import { describe, expect, onTestFinished, test } from 'vitest';
import { assign, createActor, sendTo, setup, type AnyActorRef } from 'xstate';
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

function clearButton(): HTMLButtonElement {
  const found = [...overlay().querySelectorAll('button')].find((button) => button.textContent === 'Clear');

  if (!found) throw new Error('The panel has no Clear button.');

  return found;
}

/** The Blocked events section: its title, its rows newest first, and whether Clear can be clicked. */
function eventLog() {
  const titles = [...overlay().querySelectorAll('section h3')].map((title) => title.textContent ?? '');

  return {
    title: titles.find((title) => title.startsWith('Blocked events')),
    rows: blockedEvents(),
    clear: clearButton().disabled ? 'disabled' : 'enabled',
  };
}

/** The time each row shows, newest first. */
function times(): string[] {
  return [...overlay().querySelectorAll('[data-part="log-entry"] [data-part="time"]')].map((time) => time.textContent ?? '');
}

async function clear(): Promise<void> {
  fireEvent.click(clearButton());
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
      <StateViewer defaultOpen />
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
 * The times are HH:MM:SS.mmm.
 */
async function pressTimed(name: string): Promise<string[]> {
  const before = Date.now();
  fireEvent.click(screen.getByRole('button', { name }));
  const after = Date.now();
  await flush();
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');

  return Array.from({ length: after - before + 1 }, (_, offset) => {
    const date = new Date(before + offset);
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

    return `${time}.${pad(date.getMilliseconds(), 3)}`;
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
  return `[state-viewer] No recorded or fixture context for "${leaves}" on "${key}", so the preview uses the live context.`;
}

test('events sent during a preview are blocked and listed, newest first, and the actor never gets them', async () => {
  const output = watchConsole();
  const machine = createPaymentMachine();
  await mount(<Payment machine={machine} />);
  const empty = eventLog();

  await preview(machine.id, ['error']);
  const paid = await pressTimed('Pay');
  const failed = await pressTimed('Fail');
  const blocked = { shown: shown(), log: eventLog(), times: times() };
  await release(machine.id);
  expect({ empty, blocked, released: shown(), warnings: output.warn }).toEqual({
    empty: { title: 'Blocked events', rows: [], clear: 'disabled' },
    blocked: {
      shown: { value: 'error', context: { note: 'none' } },
      log: {
        title: 'Blocked events (2)',
        rows: [`FAIL · ${machine.id} · 1 · in error · {"note":"card declined"}`, `PAY · ${machine.id} · 1 · in error`],
        clear: 'enabled',
      },
      times: [expect.toBeOneOf(failed), expect.toBeOneOf(paid)],
    },
    released: { value: 'editing', context: { note: 'none' } },
    warnings: [liveWarning('error', shownKey())],
  });
});

test('without a preview, events reach the actor and nothing is listed', async () => {
  const machine = createPaymentMachine();
  await mount(<Payment machine={machine} />);

  await press('Pay');
  await press('Fail');
  expect({ shown: shown(), log: eventLog() }).toEqual({
    shown: { value: 'error', context: { note: 'card declined' } },
    log: { title: 'Blocked events', rows: [], clear: 'disabled' },
  });
});

test('after the release, events reach the actor again, and the list keeps the blocked ones', async () => {
  const machine = createPaymentMachine();
  await mount(<Payment machine={machine} />);

  await preview(machine.id, ['processing']);
  await press('Pay');
  await release(machine.id);
  await press('Pay');
  expect({ shown: shown(), rows: eventLog().rows }).toEqual({
    shown: { value: 'processing', context: { note: 'none' } },
    rows: [`PAY · ${machine.id} · 1 · in processing`],
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
    cleared: { title: 'Blocked events', rows: [], clear: 'disabled' },
    later: {
      title: 'Blocked events (1)',
      rows: [`FAIL · ${machine.id} · 1 · in error · {"note":"card declined"}`],
      clear: 'enabled',
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

    await failUpTo(1, 200);
    const full = eventLog();
    await failUpTo(201, 201);
    const oneOver = eventLog();
    await failUpTo(202, 607);
    const laps = eventLog();
    await clear();
    await failUpTo(1001, 1201);
    expect({ full, oneOver, laps, afterClear: eventLog() }).toEqual({
      full: { title: 'Blocked events (200)', rows: newest(1, 200), clear: 'enabled' },
      oneOver: { title: 'Blocked events (200)', rows: newest(2, 201), clear: 'enabled' },
      laps: { title: 'Blocked events (200)', rows: newest(408, 607), clear: 'enabled' },
      afterClear: { title: 'Blocked events (200)', rows: newest(1002, 1201), clear: 'enabled' },
    });
  });
});

describe('events that are not objects with a string type', () => {
  function messageOf(run: () => void): string {
    try {
      run();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }

    return 'nothing thrown';
  }

  test("a string event throws XState's error, with or without a preview, and is not listed", async () => {
    const machine = createPaymentMachine();
    const { real, proxy } = startPayment(machine);
    await mount(null);
    // @ts-expect-error an event is an object, and the test sends a string as a JavaScript app can
    const sendString = () => proxy.send('PAY');

    const idle = messageOf(sendString);
    await preview(machine.id, ['processing']);
    const previewing = messageOf(sendString);
    await flush();
    expect({ idle, previewing, log: eventLog(), real: real.getSnapshot().value }).toEqual({
      idle: 'Only event objects may be sent to actors; use .send({ type: "PAY" }) instead',
      previewing: 'Only event objects may be sent to actors; use .send({ type: "PAY" }) instead',
      log: { title: 'Blocked events', rows: [], clear: 'disabled' },
      real: 'editing',
    });
  });

  test('during a preview, an event without a string type is dropped with a warning, and is not listed', async () => {
    const output = watchConsole();
    const machine = createPaymentMachine();
    const { proxy } = startPayment(machine);
    await mount(null);
    await preview(machine.id, ['processing']);
    const key = shownKey();

    // @ts-expect-error the type of an event is a string, and the test sends a number as a JavaScript app can
    act(() => proxy.send({ type: 42 }));
    await flush();
    expect({ log: eventLog(), warnings: output.warn }).toEqual({
      log: { title: 'Blocked events', rows: [], clear: 'disabled' },
      warnings: [
        liveWarning('processing', key),
        `[state-viewer] Dropped an event without a string type sent to "${key}" during a preview. { type: 42 }`,
      ],
    });
  });
});

describe('events from another actor', () => {
  type TargetEvent = { type: 'NEXT' };

  type SenderInput = { target: AnyActorRef };

  type SenderEvent = { type: 'PING' } | { type: 'PING_LATER' };

  function createMachines() {
    // SAFETY: XState reads the types of setup() only at compile time. It never reads this value.
    const target = setup({ types: { events: {} as TargetEvent } }).createMachine({
      id: freshId('target'),
      initial: 'a',
      states: { a: { on: { NEXT: 'b' } }, b: { on: { NEXT: 'c' } }, c: {} },
    });

    // Another actor of the app, handed the target through its input.
    // The hook gives it the actor that the app holds.
    const sender = setup({
      // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
      types: { context: {} as SenderInput, input: {} as SenderInput, events: {} as SenderEvent },
    }).createMachine({
      id: freshId('sender'),
      context: ({ input }) => ({ target: input.target }),
      on: {
        PING: { actions: sendTo(({ context }) => context.target, { type: 'NEXT' }) },
        PING_LATER: { actions: sendTo(({ context }) => context.target, { type: 'NEXT' }, { delay: 10 }) },
      },
    });

    return { target, sender };
  }

  type Machines = ReturnType<typeof createMachines>;

  function Sender({ machine, target }: { machine: Machines['sender']; target: AnyActorRef }) {
    const sender = useActorRef(machine, { input: { target } });

    return (
      <>
        <button type="button" onClick={() => sender.send({ type: 'PING' })}>
          Ping
        </button>
        <button type="button" onClick={() => sender.send({ type: 'PING_LATER' })}>
          Ping later
        </button>
      </>
    );
  }

  function App({ machines }: { machines: Machines }) {
    const target = useActorRef(machines.target);
    const value = useSelector(target, (snapshot) => snapshot.value);

    return (
      <>
        <output>{JSON.stringify({ value })}</output>
        <Sender machine={machines.sender} target={target} />
      </>
    );
  }

  test('an event sent with sendTo is blocked too, and reaches the actor once the preview is released', async () => {
    const output = watchConsole();
    const machines = createMachines();
    await mount(<App machines={machines} />);

    await preview(machines.target.id, ['b']);
    const key = shownKey();
    await press('Ping');
    const blocked = { shown: shown(), rows: eventLog().rows };
    await release(machines.target.id);
    const released = shown();
    await press('Ping');
    expect({ blocked, released, delivered: shown(), warnings: output.warn }).toEqual({
      blocked: { shown: { value: 'b' }, rows: [`NEXT · ${machines.target.id} · 1 · in b`] },
      released: { value: 'a' },
      delivered: { value: 'b' },
      warnings: [liveWarning('b', key)],
    });
  });

  test('a delayed sendTo that arrives during a preview is blocked', async () => {
    const machines = createMachines();
    await mount(<App machines={machines} />);
    await preview(machines.target.id, ['b']);

    await press('Ping later');
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    const blocked = { shown: shown(), rows: eventLog().rows };
    await release(machines.target.id);
    expect({ blocked, released: shown() }).toEqual({
      blocked: { shown: { value: 'b' }, rows: [`NEXT · ${machines.target.id} · 1 · in b`] },
      released: { value: 'a' },
    });
  });
});
