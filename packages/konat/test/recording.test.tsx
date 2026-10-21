import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Konat } from 'konat';
import { connect, useActorRef, useMachine, useSelector } from 'konat/xstate';
import { afterEach, describe, expect, onTestFinished, test } from 'vitest';
import {
  assign,
  createActor,
  createMachine,
  fromCallback,
  setup,
  type Actor,
  type AnyEventObject,
  type AnyStateMachine,
  type EventFrom,
  type SnapshotFrom,
} from 'xstate';
import { watchConsole } from './support/console';
import { flush, freshId, marks, panel, preview, release, show } from './support/panel';
import { readStored, recordedKey } from './support/recordings';

type CheckoutContext = { step: number; note: string };

type CheckoutEvent =
  | { type: 'START' }
  | { type: 'FAIL' }
  | { type: 'RETRY' }
  | { type: 'STANDARD' }
  | { type: 'EXPRESS' }
  | { type: 'PICKUP' }
  | { type: 'FINISH' };

function createCheckoutMachine() {
  // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
  return setup({
    types: { context: {} as CheckoutContext, events: {} as CheckoutEvent },
    actions: { count: assign({ step: ({ context }) => context.step + 1 }) },
  }).createMachine({
    id: freshId('checkout'),
    context: { step: 0, note: 'none' },
    initial: 'idle',
    states: {
      idle: { on: { START: { target: 'paying', actions: 'count' } } },
      paying: {
        type: 'parallel',
        on: { FINISH: { target: 'done', actions: 'count' } },
        states: {
          card: {
            initial: 'idle',
            states: {
              idle: { on: { FAIL: { target: 'error', actions: ['count', assign({ note: 'Card declined' })] } } },
              error: { on: { RETRY: { target: 'idle', actions: 'count' } } },
            },
          },
          shipping: {
            initial: 'standard',
            on: {
              STANDARD: { target: '.standard', actions: 'count' },
              EXPRESS: { target: '.express', actions: 'count' },
              PICKUP: { target: '.pickup', actions: 'count' },
            },
            states: { standard: {}, express: {}, pickup: {} },
          },
        },
      },
      done: { type: 'final' },
    },
  });
}

type CheckoutMachine = ReturnType<typeof createCheckoutMachine>;

const CHECKOUT_BUTTONS = {
  Start: 'START',
  Fail: 'FAIL',
  Retry: 'RETRY',
  Standard: 'STANDARD',
  Express: 'EXPRESS',
  Pickup: 'PICKUP',
  Finish: 'FINISH',
} as const;

function CheckoutView(props: {
  name: string;
  snapshot: SnapshotFrom<CheckoutMachine>;
  send: (event: EventFrom<CheckoutMachine>) => void;
}) {
  const { value, context } = props.snapshot;

  return (
    <section aria-label={props.name}>
      <output>{JSON.stringify({ value, context })}</output>
      {Object.entries(CHECKOUT_BUTTONS).map(([label, type]) => (
        <button key={type} type="button" onClick={() => props.send({ type })}>
          {label}
        </button>
      ))}
    </section>
  );
}

function Checkout({ machine }: { machine: CheckoutMachine }) {
  const [snapshot, send] = useMachine(machine);

  return <CheckoutView name="checkout" snapshot={snapshot} send={send} />;
}

function ConnectedCheckout({ actor }: { actor: Actor<CheckoutMachine> }) {
  const snapshot = useSelector(actor, (state) => state);

  return <CheckoutView name="checkout" snapshot={snapshot} send={actor.send} />;
}

/** An app that renders nothing of its machine: one button per event, in a region when `name` is given. */
function Controls(props: { machine: AnyStateMachine; events?: Record<string, AnyEventObject>; name?: string }) {
  const actorRef = useActorRef(props.machine);

  const buttons = Object.entries(props.events ?? {}).map(([label, event]) => (
    <button key={label} type="button" onClick={() => actorRef.send(event)}>
      {label}
    </button>
  ));

  return props.name === undefined ? <>{buttons}</> : <section aria-label={props.name}>{buttons}</section>;
}

/** States s0 to s<count - 1>, and NEXT goes from each one to the next. */
function steps(count: number) {
  const states: Record<string, { on?: { NEXT: string } }> = {};

  for (let index = 0; index < count; index++) {
    states[`s${index}`] = index < count - 1 ? { on: { NEXT: `s${index + 1}` } } : {};
  }

  return states;
}

/** Renders the app with an open overlay, or without one when only sessionStorage matters. */
async function mount(app: ReactElement, { overlay = true } = {}) {
  const view = render(
    <>
      {app}
      {overlay && <Konat defaultOpen />}
    </>,
  );

  await flush();

  return view;
}

function region(name: string | undefined) {
  return name === undefined ? screen : within(screen.getByRole('region', { name }));
}

/** Clicks and does not wait for React, so no timer can run between clicks in a row. */
function click(name: string, where?: string) {
  fireEvent.click(region(where).getByRole('button', { name }));
}

async function press(name: string, where?: string) {
  click(name, where);
  await flush();
}

/** What a checkout renders: its value and context, which follow the preview. */
function shown(where = 'checkout') {
  return JSON.parse(region(where).getByRole('status').textContent ?? 'null');
}

/**
 * Runs `step` in a timer after `ms` milliseconds, and resolves with its result.
 * Timers run in the order of their deadlines, also when the page runs late, so the step keeps its place among them.
 */
function after<T>(ms: number, step: () => T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(step()), ms);
  });
}

function hidePage() {
  window.dispatchEvent(new Event('pagehide'));
}

/** The stored entries without their times, oldest first. */
function storedEntries(machineId: string) {
  return readStored(machineId)?.entries.map(({ leaves, context }) => ({ leaves, context })) ?? null;
}

function storedLeaves(machineId: string) {
  return readStored(machineId)?.entries.map((entry) => entry.leaves) ?? null;
}

const CHECKOUT_LEAVES = [
  'idle',
  'paying.card.idle',
  'paying.card.error',
  'paying.shipping.standard',
  'paying.shipping.express',
  'paying.shipping.pickup',
  'done',
];

/** The marks of the checkout tree when exactly the given leaves have recordings. */
function recordedMarks(leaves: string[], all = CHECKOUT_LEAVES) {
  return Object.fromEntries(all.map((leaf) => [leaf, [leaves.includes(leaf) ? 'recorded' : 'none']]));
}

// The page keeps one registry for the file, and with it one timer for the delayed write.
// A pagehide writes what a test left pending, so the timer can't fire during a later test.
afterEach(hidePage);

test('the states the app visits are marked recorded, and their preview shows the context the app had there', async () => {
  const output = watchConsole();
  const machine = createCheckoutMachine();
  await mount(<Checkout machine={machine} />);
  await press('Start');
  await press('Fail');
  await press('Retry');

  await show(machine.id);
  const visited = marks();
  await preview(machine.id, ['paying.card.error']);
  const previewing = { shown: shown(), source: panel().source, context: panel().context };
  await release(machine.id);
  expect({ visited, previewing, released: shown(), warnings: output.warn }).toEqual({
    visited: recordedMarks(['idle', 'paying.card.idle', 'paying.card.error', 'paying.shipping.standard']),
    previewing: {
      shown: { value: { paying: { card: 'error', shipping: 'standard' } }, context: { step: 2, note: 'Card declined' } },
      source: 'recorded',
      context: ['step: 2', 'note: "Card declined"'],
    },
    released: { value: { paying: { card: 'idle', shipping: 'standard' } }, context: { step: 3, note: 'Card declined' } },
    warnings: [],
  });
});

describe('with several recordings that hold a leaf', () => {
  test('the exact configuration wins with its latest visit, and otherwise the newest recording of the first picked leaf that has one', async () => {
    const machine = createCheckoutMachine();
    await mount(<Checkout machine={machine} />);

    // Steps 1 to 5: idle + standard, error + standard, error + express, error + standard again, idle + standard.
    for (const name of ['Start', 'Fail', 'Express', 'Standard', 'Retry']) await press(name);

    const previews = [];

    for (const leaves of [
      // The app is in card.idle and shipping.standard, so the preview fills in shipping.standard.
      ['paying.card.error'],
      ['paying.card.error', 'paying.shipping.express'],
      ['paying.shipping.pickup', 'paying.card.error'],
      // Express was recorded only with card.error.
      ['paying.shipping.express', 'paying.card.idle'],
      ['paying.card.idle', 'paying.shipping.express'],
    ]) {
      await preview(machine.id, leaves);
      previews.push([shown().value, shown().context.step, panel().source]);
    }

    expect(previews).toEqual([
      [{ paying: { card: 'error', shipping: 'standard' } }, 4, 'recorded'],
      [{ paying: { card: 'error', shipping: 'express' } }, 3, 'recorded'],
      [{ paying: { card: 'error', shipping: 'pickup' } }, 4, 'recorded'],
      [{ paying: { card: 'idle', shipping: 'express' } }, 3, 'recorded'],
      [{ paying: { card: 'idle', shipping: 'express' } }, 5, 'recorded'],
    ]);
  });
});

describe('during a preview', () => {
  test("the app's blocked events record nothing, and the moves of the real actor record and show on release", async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine();
    const actor = createActor(machine).start();
    onTestFinished(() => {
      actor.stop();
    });
    await mount(<ConnectedCheckout actor={connect(actor)} />);

    await preview(machine.id, ['idle']);
    await press('Start');
    const blocked = marks();
    act(() => {
      actor.send({ type: 'START' });
      actor.send({ type: 'EXPRESS' });
    });
    await flush();
    const moved = { marks: marks(), shown: shown() };
    await release(machine.id);
    expect({ blocked, moved, released: shown(), warnings: output.warn }).toEqual({
      blocked: recordedMarks(['idle']),
      moved: {
        marks: recordedMarks(['idle', 'paying.card.idle', 'paying.shipping.standard', 'paying.shipping.express']),
        shown: { value: 'idle', context: { step: 0, note: 'none' } },
      },
      released: { value: { paying: { card: 'idle', shipping: 'express' } }, context: { step: 2, note: 'none' } },
      warnings: [],
    });
  });
});

describe('with connect()', () => {
  test('an actor records up to its final state, and the next instance of the machine previews what it visited', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine();
    await mount(<></>);
    const first = connect(createActor(machine).start());
    await act(async () => {
      first.send({ type: 'START' });
      first.send({ type: 'FAIL' });
      first.send({ type: 'FINISH' });
    });

    const second = connect(createActor(machine).start());
    onTestFinished(() => {
      second.stop();
    });
    render(<ConnectedCheckout actor={second} />);
    await flush();
    await show(machine.id);
    const visited = marks();
    await preview(machine.id, ['paying.card.error']);
    expect({ visited, shown: shown(), source: panel().source, warnings: output.warn }).toEqual({
      visited: recordedMarks(['idle', 'paying.card.idle', 'paying.card.error', 'paying.shipping.standard', 'done']),
      shown: { value: { paying: { card: 'error', shipping: 'standard' } }, context: { step: 2, note: 'Card declined' } },
      source: 'recorded',
      warnings: [],
    });
  });
});

describe('with an actor that moves while it starts', () => {
  // A callback child answers at once, so the actor leaves `restoring` as it starts.
  // The component renders `restoring` first, so its context is worth a preview.
  type SessionContext = { user: string | null };

  type SessionEvent = { type: 'RESTORED'; user: string };

  function createSessionMachine() {
    // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
    return setup({
      types: { context: {} as SessionContext, events: {} as SessionEvent },
      actors: {
        restore: fromCallback(({ sendBack }) => {
          sendBack({ type: 'RESTORED', user: 'ada' });
        }),
      },
    }).createMachine({
      id: freshId('session'),
      context: { user: null },
      initial: 'restoring',
      states: {
        restoring: {
          invoke: { src: 'restore' },
          on: { RESTORED: { target: 'ready', actions: assign({ user: ({ event }) => event.user }) } },
        },
        ready: {},
      },
    });
  }

  type SessionMachine = ReturnType<typeof createSessionMachine>;

  const describeSession = (snapshot: SnapshotFrom<SessionMachine>) =>
    `${String(snapshot.value)}:${snapshot.context.user}`;

  function MachineSession({ machine }: { machine: SessionMachine }) {
    const [snapshot] = useMachine(machine);

    return <output>{describeSession(snapshot)}</output>;
  }

  function ActorRefSession({ machine }: { machine: SessionMachine }) {
    const actorRef = useActorRef(machine);

    return <output>{useSelector(actorRef, describeSession)}</output>;
  }

  function ConnectedSession({ actor }: { actor: Actor<SessionMachine> }) {
    return <output>{useSelector(actor, describeSession)}</output>;
  }

  function connectBeforeStart(machine: SessionMachine) {
    const actor = connect(createActor(machine)).start();
    onTestFinished(() => {
      actor.stop();
    });

    return <ConnectedSession actor={actor} />;
  }

  test.each<[string, (machine: SessionMachine) => ReactElement]>([
    ['useMachine', (machine) => <MachineSession machine={machine} />],
    ['useActorRef', (machine) => <ActorRefSession machine={machine} />],
    ['connect() before start()', connectBeforeStart],
  ])('%s records the configuration the actor started in, so its preview shows what the app first rendered', async (_, app) => {
    const output = watchConsole();
    const machine = createSessionMachine();
    await mount(app(machine));
    const live = screen.getByRole('status').textContent;

    await show(machine.id);
    const visited = marks();
    await preview(machine.id, ['restoring']);
    expect({
      live,
      visited,
      previewed: screen.getByRole('status').textContent,
      source: panel().source,
      warnings: output.warn,
    }).toEqual({
      live: 'ready:ada',
      visited: { restoring: ['recorded'], ready: ['recorded'] },
      previewed: 'restoring:null',
      source: 'recorded',
      warnings: [],
    });
  });
});

describe('with more than 50 configurations', () => {
  const PAGES = 51;
  const PAGE_LEAVES = Array.from({ length: PAGES }, (_, index) => `page.s${index}`);
  const ALL_LEAVES = [...PAGE_LEAVES, 'help.hidden'];

  // Every configuration holds help.hidden, so it stays recorded while one of them is kept.
  function createWizardMachine() {
    return createMachine({
      id: freshId('wizard'),
      type: 'parallel',
      context: {},
      states: {
        page: { initial: 's0', states: steps(PAGES) },
        help: { initial: 'hidden', states: { hidden: {} } },
      },
    });
  }

  test.each([
    { visits: '51 pages', nexts: 50, earlier: [], dropped: 'page.s0', kept: PAGE_LEAVES.slice(1) },
    {
      visits: 'its first page after an earlier page load stored the other 50, as the oldest',
      nexts: 0,
      earlier: PAGE_LEAVES.slice(1),
      dropped: 'page.s1',
      kept: [...PAGE_LEAVES.slice(2), 'page.s0'],
    },
  ])('an app that visits $visits keeps the 50 newest, and a leaf stays marked while one of them holds it', async ({
    nexts,
    earlier,
    dropped,
    kept,
  }) => {
    const machine = createWizardMachine();
    const entries = earlier.map((leaf, index) => ({ leaves: ['help.hidden', leaf], at: index, context: {} }));
    sessionStorage.setItem(recordedKey(machine.id), JSON.stringify({ v: 1, entries }));
    await mount(<Controls machine={machine} events={{ Next: { type: 'NEXT' } }} />);

    for (let index = 0; index < nexts; index++) click('Next');
    await flush();
    await show(machine.id);
    const marked = marks();
    hidePage();
    expect({ marked, stored: storedLeaves(machine.id) }).toEqual({
      marked: recordedMarks(
        ALL_LEAVES.filter((leaf) => leaf !== dropped),
        ALL_LEAVES,
      ),
      stored: kept.map((leaf) => ['help.hidden', leaf]),
    });
  });
});

describe('in sessionStorage', () => {
  test('a pagehide writes the recordings at once, under konat:recorded:<machine id>', async () => {
    const machine = createCheckoutMachine();
    const before = Date.now();
    await mount(<Checkout machine={machine} />, { overlay: false });
    await press('Start');
    await press('Fail');
    hidePage();
    const after = Date.now();

    const payload = readStored(machine.id);

    const timed = payload && {
      ...payload,
      entries: payload.entries.map(({ at, ...entry }) => ({ ...entry, at: before <= at && at <= after ? 'now' : at })),
    };

    expect(timed).toEqual({
      v: 1,
      entries: [
        { leaves: ['idle'], at: 'now', context: { step: 0, note: 'none' } },
        { leaves: ['paying.card.idle', 'paying.shipping.standard'], at: 'now', context: { step: 1, note: 'none' } },
        {
          leaves: ['paying.card.error', 'paying.shipping.standard'],
          at: 'now',
          context: { step: 2, note: 'Card declined' },
        },
      ],
    });
  });

  test('without a pagehide, the recordings are written 500 ms after the first visit', async () => {
    const machine = createCheckoutMachine();
    await mount(<Checkout machine={machine} />, { overlay: false });
    await press('Start');
    // The timer of the write starts at the first visit, before the timer below, so it runs first.
    const stored = await after(500, () => storedLeaves(machine.id));
    expect(stored).toEqual([['idle'], ['paying.card.idle', 'paying.shipping.standard']]);
  });
});

describe('with a context that JSON cannot hold as it is', () => {
  type KeeperContext = { value: unknown };

  type KeeperEvent = { type: 'KEEP' };

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A context can hold any value, such as a Map or a cycle.
  async function storeKept(kept: unknown) {
    // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
    const machine = setup({ types: { context: {} as KeeperContext, events: {} as KeeperEvent } }).createMachine({
      id: freshId('keeper'),
      context: { value: 'plain' },
      initial: 'plain',
      states: { plain: { on: { KEEP: { target: 'kept', actions: assign({ value: () => kept }) } } }, kept: {} },
    });

    await mount(<Controls machine={machine} events={{ Keep: { type: 'KEEP' } }} />, { overlay: false });
    await press('Keep');
    hidePage();

    return storedEntries(machine.id);
  }

  test('stores a context without its functions', async () => {
    const kept = {
      n: 1,
      onDone() {},
      nested: { cb: () => {} },
      // JSON.stringify would store 'flat' in place of the object.
      custom: { v: 2, toJSON: () => 'flat' },
      // An object that is only partly like an actor ref.
      api: { url: '/x', send() {}, subscribe() {} },
      bare: Object.assign(Object.create(null), { x: 1 }),
      list: [1, 'two', null, { ok: true }, [3]],
      // Separate objects that are equal.
      a: { id: 1 },
      b: { id: 1 },
      c: [],
      d: [],
    };

    expect(await storeKept(kept)).toEqual([
      { leaves: ['plain'], context: { value: 'plain' } },
      {
        leaves: ['kept'],
        context: {
          value: {
            n: 1,
            nested: {},
            custom: { v: 2 },
            api: { url: '/x' },
            bare: { x: 1 },
            list: [1, 'two', null, { ok: true }, [3]],
            a: { id: 1 },
            b: { id: 1 },
            c: [],
            d: [],
          },
        },
      },
    ]);
  });

  const ref = { id: 'child', send() {}, getSnapshot() {}, subscribe() {} };
  const item = { id: 1 };

  // A context restored without the value, or with what JSON makes of it, would break the components that read it.
  test.each<[string, unknown]>([
    ['a Date', { createdAt: new Date(0) }],
    ['NaN', Number.NaN],
    ['undefined in an array', [undefined]],
    ['an object reached twice', { items: [item, { id: 2 }], selected: item }],
    ['an actor ref deep inside objects', { order: { payment: { actor: ref } } }],
  ])('keeps a context with %s out of sessionStorage', async (_, value) => {
    expect(await storeKept(value)).toEqual([{ leaves: ['plain'], context: { value: 'plain' } }]);
  });
});

describe('after a reload', () => {
  /**
   * Records a checkout on an earlier page load and stores its payload for `machineId`, as a reload finds it.
   * Steps 1 to 3: idle + standard, error + standard, idle + standard again.
   */
  async function storeEarlierLoad(machineId: string) {
    const earlier = createCheckoutMachine();
    const view = await mount(<Checkout machine={earlier} />, { overlay: false });
    await press('Start');
    await press('Fail');
    await press('Retry');
    view.unmount();
    hidePage();
    sessionStorage.setItem(recordedKey(machineId), sessionStorage.getItem(recordedKey(earlier.id)) ?? '');
  }

  test("the recordings of an earlier page load mark the leaves and feed the previews, and this page's visits win", async () => {
    const machine = createCheckoutMachine();
    await storeEarlierLoad(machine.id);
    await mount(<Checkout machine={machine} />);

    await show(machine.id);
    const reloaded = marks();
    await press('Start');
    await press('Express');
    // Express fills the shipping region, so no stored configuration matches, and the leaf picks the recording.
    await preview(machine.id, ['paying.card.error']);
    const earlier = { shown: shown(), source: panel().source };
    await preview(machine.id, ['paying.card.idle', 'paying.shipping.standard']);
    const revisited = shown().context;
    await release(machine.id);
    hidePage();
    expect({ reloaded, earlier, revisited, stored: storedEntries(machine.id) }).toEqual({
      reloaded: recordedMarks(['idle', 'paying.card.idle', 'paying.card.error', 'paying.shipping.standard']),
      earlier: {
        shown: { value: { paying: { card: 'error', shipping: 'express' } }, context: { step: 2, note: 'Card declined' } },
        source: 'recorded',
      },
      revisited: { step: 1, note: 'none' },
      // The next write keeps both, the stored ones first.
      stored: [
        { leaves: ['paying.card.error', 'paying.shipping.standard'], context: { step: 2, note: 'Card declined' } },
        { leaves: ['idle'], context: { step: 0, note: 'none' } },
        { leaves: ['paying.card.idle', 'paying.shipping.standard'], context: { step: 1, note: 'none' } },
        { leaves: ['paying.card.idle', 'paying.shipping.express'], context: { step: 2, note: 'none' } },
      ],
    });
  });

  const valid = { leaves: ['a'], at: 1, context: { n: 1 } };

  test.each<[string, string]>([
    ['invalid JSON', '{"v":1,"entries":['],
    ['another version', JSON.stringify({ v: 2, entries: [valid] })],
    ['a missing context', JSON.stringify({ v: 1, entries: [valid, { leaves: ['a'], at: 1 }] })],
  ])('ignores a stored payload with %s', async (_, raw) => {
    const output = watchConsole();
    const machine = createMachine({ id: freshId('pair'), context: {}, initial: 'b', states: { a: {}, b: {} } });
    sessionStorage.setItem(recordedKey(machine.id), raw);
    await mount(<Controls machine={machine} />);

    await show(machine.id);
    expect({ marks: marks(), output }).toEqual({
      marks: { a: ['none'], b: ['recorded'] },
      output: { warn: [], error: [] },
    });
  });
});

// The registry counts what it stored in earlier tests of the file against the budget, though test/setup.ts clears the
// storage. So these tests come last, the budget test first, and each one leaves little stored.
describe('at the storage limits', () => {
  test('all machines share 1,000,000 characters, and a key that goes gives its share back', async () => {
    const output = watchConsole();
    const text = 'x'.repeat(95_000);

    type BulkContext = { text: string; stamped?: Date };

    type BulkEvent = { type: 'NEXT' } | { type: 'FIRST' } | { type: 'STAMP' };

    function createBulkMachine() {
      // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
      return setup({
        types: { context: {} as BulkContext, events: {} as BulkEvent },
      }).createMachine({
        id: freshId('bulk'),
        context: { text },
        initial: 's0',
        on: { FIRST: '.s0', STAMP: { target: '.s0', actions: assign({ stamped: () => new Date(0) }) } },
        states: steps(6),
      });
    }

    const events = { Next: { type: 'NEXT' }, First: { type: 'FIRST' }, Stamp: { type: 'STAMP' } };
    // The app's own data stays.
    sessionStorage.setItem('cart', 'x'.repeat(60_000));
    const first = createBulkMachine();
    const second = createBulkMachine();
    await mount(
      <>
        <Controls machine={first} events={events} name="first" />
        <Controls machine={second} events={events} name="second" />
      </>,
      { overlay: false },
    );

    // The clicks and the pagehide run in one task. Thus the write 500 ms after the first visit can't come between them,
    // and the one warning counts all 6 recordings of the second machine.
    for (let index = 0; index < 5; index++) click('Next', 'first');

    for (let index = 0; index < 5; index++) click('Next', 'second');
    hidePage();
    const shared = { first: storedLeaves(first.id), second: storedLeaves(second.id) };

    // A Date keeps every configuration of the first machine in memory, so its key goes.
    await press('Stamp', 'first');

    for (let index = 0; index < 5; index++) await press('Next', 'first');
    await press('First', 'second');
    hidePage();
    expect({
      shared,
      returned: { first: storedLeaves(first.id), second: storedLeaves(second.id) },
      cart: sessionStorage.getItem('cart')?.length,
      warnings: output.warn,
    }).toEqual({
      shared: { first: [['s0'], ['s1'], ['s2'], ['s3'], ['s4'], ['s5']], second: [['s2'], ['s3'], ['s4'], ['s5']] },
      returned: { first: null, second: [['s1'], ['s2'], ['s3'], ['s4'], ['s5'], ['s0']] },
      cart: 60_000,
      warnings: [
        '[konat] Recordings are limited to 1,000,000 characters of storage in total, so only the newest 4 of ' +
          `the 6 recordings for "${second.id}" were saved. All of them stay available until the page reloads.`,
      ],
    });
  });

  test('a context of up to 100,000 characters of JSON is stored, and a larger one stays in memory', async () => {
    const output = watchConsole();

    type NotesContext = { text: string };

    type NotesEvent = { type: 'WRITE'; length: number } | { type: 'CLEAR' };

    // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
    const machine = setup({
      types: { context: {} as NotesContext, events: {} as NotesEvent },
    }).createMachine({
      id: freshId('notes'),
      context: { text: '' },
      initial: 'empty',
      on: {
        WRITE: { target: '.written', actions: assign({ text: ({ event }) => 'x'.repeat(event.length) }) },
        CLEAR: { target: '.empty', actions: assign({ text: '' }) },
      },
      states: { empty: {}, written: {} },
    });

    // The context JSON is the text and 11 characters: {"text":""}.
    function Notes() {
      const [snapshot, send] = useMachine(machine);

      return (
        <>
          <output>{`${String(snapshot.value)}: ${snapshot.context.text.length}`}</output>
          <button type="button" onClick={() => send({ type: 'WRITE', length: 99_989 })}>
            Write 100,000
          </button>
          <button type="button" onClick={() => send({ type: 'WRITE', length: 99_990 })}>
            Write 100,001
          </button>
          <button type="button" onClick={() => send({ type: 'CLEAR' })}>
            Clear
          </button>
        </>
      );
    }

    const sizes = () =>
      readStored(machine.id)?.entries.map(({ leaves, context }) => [leaves, JSON.stringify(context).length]) ?? null;

    await mount(<Notes />);
    await press('Write 100,000');
    hidePage();
    const fits = sizes();

    await press('Write 100,001');
    await press('Clear');
    hidePage();
    const tooLarge = sizes();
    await preview(machine.id, ['written']);
    expect({
      fits,
      tooLarge,
      previewed: { shown: screen.getByRole('status').textContent, source: panel().source },
      warnings: output.warn,
    }).toEqual({
      fits: [
        [['empty'], 11],
        [['written'], 100_000],
      ],
      tooLarge: [[['empty'], 11]],
      previewed: { shown: 'written: 99990', source: 'recorded' },
      warnings: [],
    });
  });

  test('a full storage keeps the newest recordings that fit, warns once, and drops the key when none fit', async () => {
    const output = watchConsole();

    type PadContext = { pad: string };

    type PadEvent = { type: 'NEXT' } | { type: 'GROW' };

    // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
    const machine = setup({
      types: { context: {} as PadContext, events: {} as PadEvent },
    }).createMachine({
      id: freshId('full'),
      context: { pad: 'x'.repeat(200) },
      initial: 's0',
      on: { GROW: { target: '.grown', actions: assign({ pad: 'x'.repeat(1_000) }) } },
      states: { ...steps(8), grown: {} },
    });

    // jsdom's quota is 5,000,000 characters, and the app leaves 900 of them.
    // An entry takes about 257 characters, so eight entries don't fit, four don't fit, and two fit.
    const appData = 'x'.repeat(5_000_000 - 'app'.length - 900);
    sessionStorage.setItem('app', appData);
    await mount(<Controls machine={machine} events={{ Next: { type: 'NEXT' }, Grow: { type: 'GROW' } }} />);

    // The clicks and the pagehide run in one task. Thus the write 500 ms after the first visit can't come between them,
    // and the one warning counts all 8 recordings.
    for (let index = 0; index < 7; index++) click('Next');
    hidePage();
    const full = storedLeaves(machine.id);

    await press('Grow');
    hidePage();
    const none = storedLeaves(machine.id);
    await preview(machine.id, ['s0']);
    expect({
      full,
      none,
      source: panel().source,
      app: sessionStorage.getItem('app') === appData,
      warnings: output.warn,
    }).toEqual({
      full: [['s6'], ['s7']],
      none: null,
      source: 'recorded',
      app: true,
      warnings: [
        `[konat] Storage is full or unavailable, so only the newest 2 of the 8 recordings for "${machine.id}" ` +
          'were saved. All of them stay available until the page reloads.',
      ],
    });
  });
});
