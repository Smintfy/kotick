import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { StateViewer } from 'state-viewer';
import { connect, useActorRef, useMachine, useSelector } from 'state-viewer/xstate';
import { afterEach, describe, expect, onTestFinished, test } from 'vitest';
import {
  assign,
  createActor,
  createMachine,
  fromCallback,
  setup,
  type Actor,
  type ActorRefFrom,
  type AnyEventObject,
  type AnyStateMachine,
  type EventFrom,
  type SnapshotFrom,
} from 'xstate';
import { watchConsole } from './support/console';
import { flush, freshId, marks, panel, preview, release, show, shownKey } from './support/panel';

function createCheckoutMachine() {
  return setup({
    types: {
      context: {} as { step: number; note: string },
      events: {} as
        | { type: 'START' }
        | { type: 'FAIL' }
        | { type: 'RETRY' }
        | { type: 'STANDARD' }
        | { type: 'EXPRESS' }
        | { type: 'PICKUP' }
        | { type: 'FINISH' },
    },
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

function Checkout({ machine, name = 'checkout' }: { machine: CheckoutMachine; name?: string }) {
  const [snapshot, send] = useMachine(machine);
  return <CheckoutView name={name} snapshot={snapshot} send={send} />;
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
      {overlay && <StateViewer defaultOpen />}
    </>,
  );
  await flush();
  return view;
}

function region(name: string | undefined) {
  return name === undefined ? screen : within(screen.getByRole('region', { name }));
}

async function press(name: string, where?: string) {
  fireEvent.click(region(where).getByRole('button', { name }));
  await flush();
}

/** What a checkout renders: its value and context, which follow the preview. */
function shown(where = 'checkout') {
  return JSON.parse(region(where).getByRole('status').textContent ?? 'null');
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function hidePage() {
  window.dispatchEvent(new Event('pagehide'));
}

interface Payload {
  v: number;
  entries: { leaves: string[]; at: number; context: unknown }[];
}

function recordedKey(machineId: string) {
  return `state-viewer:recorded:${machineId}`;
}

function readStored(machineId: string): Payload | null {
  const raw = sessionStorage.getItem(recordedKey(machineId));
  return raw === null ? null : (JSON.parse(raw) as Payload);
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
  // Steps 1 to 5: idle + standard, error + standard, error + express, error + standard again, idle + standard.
  async function visitCheckout() {
    for (const name of ['Start', 'Fail', 'Express', 'Standard', 'Retry']) await press(name);
  }

  test('a configuration visited again previews with the context of its latest visit', async () => {
    const machine = createCheckoutMachine();
    await mount(<Checkout machine={machine} />);
    await visitCheckout();

    await preview(machine.id, ['paying.card.error']);
    expect({ shown: shown(), source: panel().source }).toEqual({
      shown: { value: { paying: { card: 'error', shipping: 'standard' } }, context: { step: 4, note: 'Card declined' } },
      source: 'recorded',
    });
  });

  test('the exact configuration wins, and otherwise the newest recording of the first picked leaf that has one', async () => {
    const machine = createCheckoutMachine();
    await mount(<Checkout machine={machine} />);
    await visitCheckout();

    const previews = [];
    for (const leaves of [
      ['paying.card.error', 'paying.shipping.express'],
      ['paying.shipping.pickup', 'paying.card.error'],
      ['paying.shipping.express', 'paying.card.idle'],
      ['paying.card.idle', 'paying.shipping.express'],
    ]) {
      await preview(machine.id, leaves);
      previews.push({ leaves, value: shown().value, step: shown().context.step, source: panel().source });
    }
    expect(previews).toEqual([
      {
        leaves: ['paying.card.error', 'paying.shipping.express'],
        value: { paying: { card: 'error', shipping: 'express' } },
        step: 3,
        source: 'recorded',
      },
      {
        leaves: ['paying.shipping.pickup', 'paying.card.error'],
        value: { paying: { card: 'error', shipping: 'pickup' } },
        step: 4,
        source: 'recorded',
      },
      {
        leaves: ['paying.shipping.express', 'paying.card.idle'],
        value: { paying: { card: 'idle', shipping: 'express' } },
        step: 3,
        source: 'recorded',
      },
      {
        leaves: ['paying.card.idle', 'paying.shipping.express'],
        value: { paying: { card: 'idle', shipping: 'express' } },
        step: 5,
        source: 'recorded',
      },
    ]);
  });

  test('a leaf picked alone previews with its newest recording, though the configuration filled in around it has none', async () => {
    const machine = createCheckoutMachine();
    await mount(<Checkout machine={machine} />);
    await visitCheckout();

    // The app is in card.idle, so the preview fills in card.idle. Express was recorded only with card.error.
    await preview(machine.id, ['paying.shipping.express']);
    expect({ shown: shown(), source: panel().source }).toEqual({
      shown: { value: { paying: { card: 'idle', shipping: 'express' } }, context: { step: 3, note: 'Card declined' } },
      source: 'recorded',
    });
  });
});

describe('with several instances of a machine', () => {
  test('an instance previews with what another instance recorded', async () => {
    const machine = createCheckoutMachine();
    await mount(
      <>
        <Checkout machine={machine} name="first" />
        <Checkout machine={machine} name="second" />
      </>,
    );
    await press('Start', 'first');
    await press('Fail', 'first');

    await preview(machine.id, ['paying.card.error'], { nth: 2 });
    expect({ second: shown('second'), source: panel().source }).toEqual({
      second: { value: { paying: { card: 'error', shipping: 'standard' } }, context: { step: 2, note: 'Card declined' } },
      source: 'recorded',
    });
  });
});

describe('with a leaf id that contains |', () => {
  // A leaf a|b and the leaves a and b make the same text when joined.
  // Two machines under one id can have both, and the newer recording replaces the older.
  test('recording the leaves a and b after the leaf a|b moves the mark and the context to a and b', async () => {
    const output = watchConsole();
    const id = freshId('pipes');
    const joined = createMachine({ id, context: { from: 'joined' }, initial: 'a|b', states: { 'a|b': {}, apart: {} } });
    const split = createMachine({ id, type: 'parallel', context: { from: 'split' }, states: { a: {}, b: {} } });
    const view = await mount(<Controls machine={joined} />);
    view.rerender(
      <>
        <Controls machine={joined} />
        <Controls machine={split} />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

    await show(id, 1);
    const joinedKey = shownKey();
    const joinedMarks = marks();
    await show(id, 2);
    const splitMarks = marks();
    await preview(id, ['a|b'], { nth: 1 });
    const joinedPreview = { source: panel().source, context: panel().context };
    await preview(id, ['a'], { nth: 2 });
    const splitPreview = { source: panel().source, context: panel().context };
    hidePage();
    expect({ joinedMarks, splitMarks, joinedPreview, splitPreview, stored: storedEntries(id), warnings: output.warn })
      .toEqual({
        joinedMarks: { 'a|b': ['none'], apart: ['none'] },
        splitMarks: { a: ['recorded'], b: ['recorded'] },
        joinedPreview: { source: 'live', context: ['from: "joined"'] },
        splitPreview: { source: 'recorded', context: ['from: "split"'] },
        stored: [{ leaves: ['a', 'b'], context: { from: 'split' } }],
        warnings: [
          `[state-viewer] No recorded or fixture context for "a|b" on "${joinedKey}", so the preview uses the live context.`,
        ],
      });
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
  test('an actor records up to its final state, and the next actor of the machine previews what it visited', async () => {
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
  function createSessionMachine() {
    return setup({
      types: { context: {} as { user: string | null }, events: {} as { type: 'RESTORED'; user: string } },
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
  const WIZARD_EVENTS = { Next: { type: 'NEXT' }, First: { type: 'FIRST' }, Last: { type: 'LAST' } };

  // Every configuration holds help.hidden, so it stays recorded while one of them is kept.
  function createWizardMachine() {
    return createMachine({
      id: freshId('wizard'),
      type: 'parallel',
      context: {},
      states: {
        page: { initial: 's0', on: { FIRST: '.s0', LAST: `.s${PAGES - 1}` }, states: steps(PAGES) },
        help: { initial: 'hidden', states: { hidden: {} } },
      },
    });
  }

  async function next(times: number) {
    const button = screen.getByRole('button', { name: 'Next' });
    for (let index = 0; index < times; index++) fireEvent.click(button);
    await flush();
  }

  function wizardMarks(unrecorded: string) {
    return recordedMarks(
      [...PAGE_LEAVES, 'help.hidden'].filter((leaf) => leaf !== unrecorded),
      [...PAGE_LEAVES, 'help.hidden'],
    );
  }

  test('keeps the 50 newest, and a leaf stays marked while one of them holds it', async () => {
    const machine = createWizardMachine();
    await mount(<Controls machine={machine} events={WIZARD_EVENTS} />);
    await next(50);

    await show(machine.id);
    const kept = marks();
    hidePage();
    expect({ kept, stored: storedLeaves(machine.id) }).toEqual({
      kept: wizardMarks('page.s0'),
      stored: PAGE_LEAVES.slice(1).map((leaf) => ['help.hidden', leaf]),
    });
  });

  test('a configuration visited again counts as the newest', async () => {
    const machine = createWizardMachine();
    await mount(<Controls machine={machine} events={WIZARD_EVENTS} />);
    await next(49);
    await press('First');
    await press('Last');

    await show(machine.id);
    expect(marks()).toEqual(wizardMarks('page.s1'));
  });

  test('recordings stored by an earlier page load count toward the 50, as the oldest', async () => {
    const machine = createWizardMachine();
    const entries = PAGE_LEAVES.slice(1).map((leaf, index) => ({ leaves: ['help.hidden', leaf], at: index, context: {} }));
    sessionStorage.setItem(recordedKey(machine.id), JSON.stringify({ v: 1, entries }));
    await mount(<Controls machine={machine} events={WIZARD_EVENTS} />);

    await show(machine.id);
    expect(marks()).toEqual(wizardMarks('page.s1'));
  });
});

describe('in sessionStorage', () => {
  test('a pagehide writes the recordings at once, under state-viewer:recorded:<machine id>', async () => {
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

  test('without a pagehide, the recordings are written 500 ms after the first visit, with the newest contexts', async () => {
    const machine = createCheckoutMachine();
    await mount(<Checkout machine={machine} />, { overlay: false });
    await press('Start');
    await wait(100);
    await press('Express');
    await wait(100);
    await press('Standard');
    await wait(100);
    const early = storedEntries(machine.id);
    await press('Express');
    await wait(100);
    await press('Standard');
    // The visits never stopped for 500 ms, so a write that waited for a pause would not have happened yet.
    await wait(300);
    expect({ early, late: storedEntries(machine.id) }).toEqual({
      early: null,
      late: [
        { leaves: ['idle'], context: { step: 0, note: 'none' } },
        { leaves: ['paying.card.idle', 'paying.shipping.express'], context: { step: 4, note: 'none' } },
        { leaves: ['paying.card.idle', 'paying.shipping.standard'], context: { step: 5, note: 'none' } },
      ],
    });
  });

  test('a visibilitychange writes nothing while the page stays visible', async () => {
    const machine = createCheckoutMachine();
    await mount(<Checkout machine={machine} />, { overlay: false });
    await press('Start');

    document.dispatchEvent(new Event('visibilitychange'));
    const visible = { state: document.visibilityState, stored: storedLeaves(machine.id) };
    hidePage();
    expect({ visible, hidden: storedLeaves(machine.id) }).toEqual({
      visible: { state: 'visible', stored: null },
      hidden: [['idle'], ['paying.card.idle', 'paying.shipping.standard']],
    });
  });
});

describe('with a context that JSON cannot hold as it is', () => {
  function createKeeperMachine(kept: unknown) {
    return setup({ types: { context: {} as { value: unknown }, events: {} as { type: 'KEEP' } } }).createMachine({
      id: freshId('keeper'),
      context: { value: 'plain' },
      initial: 'plain',
      states: { plain: { on: { KEEP: { target: 'kept', actions: assign({ value: () => kept }) } } }, kept: {} },
    });
  }

  async function storeKept(value: unknown) {
    const machine = createKeeperMachine(value);
    await mount(<Controls machine={machine} events={{ Keep: { type: 'KEEP' } }} />, { overlay: false });
    await press('Keep');
    hidePage();
    return storedEntries(machine.id);
  }

  test.each<[string, unknown, unknown]>([
    [
      'functions, and a toJSON that would replace its object',
      { n: 1, onDone() {}, nested: { cb: () => {} }, custom: { v: 2, toJSON: () => 'flat' } },
      { n: 1, nested: {}, custom: { v: 2 } },
    ],
    [
      'the functions of an object that is only partly like an actor ref',
      { api: { url: '/x', send() {}, subscribe() {} } },
      { api: { url: '/x' } },
    ],
    [
      'null-prototype objects and arrays',
      { bare: Object.assign(Object.create(null) as object, { x: 1 }), list: [1, 'two', null, { ok: true }, [3]] },
      { bare: { x: 1 }, list: [1, 'two', null, { ok: true }, [3]] },
    ],
    ['equal objects that are separate', { a: { id: 1 }, b: { id: 1 }, c: [], d: [] }, { a: { id: 1 }, b: { id: 1 }, c: [], d: [] }],
  ])('stores %s, without the functions', async (_, value, stored) => {
    expect(await storeKept(value)).toEqual([
      { leaves: ['plain'], context: { value: 'plain' } },
      { leaves: ['kept'], context: { value: stored } },
    ]);
  });

  class Point {
    x = 1;
  }
  class FakeActor {
    send() {}
    getSnapshot() {}
    subscribe() {}
  }
  const cycle: Record<string, unknown> = { n: 1 };
  cycle.self = cycle;
  const ref = { id: 'child', send() {}, getSnapshot() {}, subscribe() {} };
  const item = { id: 1 };
  const list = [1];

  test.each<[string, unknown]>([
    ['a Date', { createdAt: new Date(0) }],
    ['a Map', new Map()],
    ['a Set', new Set([1])],
    ['a WeakMap', new WeakMap()],
    ['a RegExp', /a/],
    ['an Error', new Error('x')],
    ['a Promise', Promise.resolve()],
    ['an ArrayBuffer', new ArrayBuffer(1)],
    ['a typed array', new Uint8Array(1)],
    ['a class instance', new Point()],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity in an array', [Number.NEGATIVE_INFINITY]],
    ['a BigInt', 1n],
    ['a symbol', Symbol('x')],
    ['a cycle', cycle],
    ['an object reached twice', { items: [item, { id: 2 }], selected: item }],
    ['an array reached twice', { a: list, nested: { b: list } }],
    [
      'a throwing getter',
      {
        get value() {
          throw new Error('nope');
        },
      },
    ],
    ['a function in an array', [() => {}]],
    ['undefined in an array', [undefined]],
    ['an actor ref held by a property', { n: 1, childRef: ref }],
    ['an actor ref deep inside objects', { order: { payment: { actor: ref } } }],
    ['a class-based actor ref', { n: 1, nested: { actor: new FakeActor() } }],
    ['an actor ref in an array', [ref]],
    ['an actor ref held by an object in an array', [{ id: 'a', ref }]],
  ])('keeps a context with %s out of sessionStorage', async (_, value) => {
    expect(await storeKept(value)).toEqual([{ leaves: ['plain'], context: { value: 'plain' } }]);
  });

  test('an object held twice stays in memory, so the preview keeps the identity the app checks', async () => {
    const machine = setup({
      types: {
        context: {} as { items: { id: number }[]; selected: { id: number } | null },
        events: {} as { type: 'PICK' } | { type: 'CLEAR' },
      },
    }).createMachine({
      id: freshId('cart'),
      context: { items: [], selected: null },
      initial: 'empty',
      states: {
        empty: {
          on: {
            PICK: {
              target: 'picked',
              actions: assign(() => {
                const first = { id: 1 };
                return { items: [first, { id: 2 }], selected: first };
              }),
            },
          },
        },
        picked: { on: { CLEAR: { target: 'empty', actions: assign({ items: [], selected: null }) } } },
      },
    });
    function Cart() {
      const [snapshot, send] = useMachine(machine);
      const { items, selected } = snapshot.context;
      return (
        <>
          <output>{`${String(snapshot.value)}: ${items.length} items, first selected: ${selected === items[0]}`}</output>
          <button type="button" onClick={() => send({ type: 'PICK' })}>
            Pick
          </button>
          <button type="button" onClick={() => send({ type: 'CLEAR' })}>
            Clear
          </button>
        </>
      );
    }
    await mount(<Cart />);
    await press('Pick');
    await press('Clear');

    await preview(machine.id, ['picked']);
    const previewed = { shown: screen.getByRole('status').textContent, source: panel().source };
    hidePage();
    expect({ previewed, stored: storedEntries(machine.id) }).toEqual({
      previewed: { shown: 'picked: 2 items, first selected: true', source: 'recorded' },
      stored: [{ leaves: ['empty'], context: { items: [], selected: null } }],
    });
  });

  test('a spawned actor in the context stays in memory, and the child machine stores its own recordings', async () => {
    const worker = createMachine({ id: freshId('worker'), context: {}, initial: 'working', states: { working: {} } });
    const crew = setup({
      types: {
        context: {} as { workers: ActorRefFrom<typeof worker>[] },
        events: {} as { type: 'HIRE' } | { type: 'DISMISS' },
      },
      actors: { worker },
    }).createMachine({
      id: freshId('crew'),
      context: { workers: [] },
      initial: 'idle',
      states: {
        idle: {
          on: {
            HIRE: {
              target: 'hiring',
              actions: assign({ workers: ({ context, spawn }) => [...context.workers, spawn('worker')] }),
            },
          },
        },
        hiring: { on: { DISMISS: { target: 'idle', actions: assign({ workers: [] }) } } },
      },
    });
    function Crew() {
      const [snapshot, send] = useMachine(crew);
      return (
        <>
          <output>{`${String(snapshot.value)}: ${snapshot.context.workers.length} workers`}</output>
          <button type="button" onClick={() => send({ type: 'HIRE' })}>
            Hire
          </button>
          <button type="button" onClick={() => send({ type: 'DISMISS' })}>
            Dismiss
          </button>
        </>
      );
    }
    await mount(<Crew />);
    await press('Hire');
    await press('Dismiss');

    await preview(crew.id, ['hiring']);
    const previewed = { shown: screen.getByRole('status').textContent, source: panel().source };
    hidePage();
    expect({ previewed, crew: storedEntries(crew.id), worker: storedEntries(worker.id) }).toEqual({
      previewed: { shown: 'hiring: 1 workers', source: 'recorded' },
      crew: [{ leaves: ['idle'], context: { workers: [] } }],
      worker: [{ leaves: ['working'], context: {} }],
    });
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

  test('recordings stored by the earlier page load mark the leaves and feed the previews', async () => {
    const machine = createCheckoutMachine();
    await storeEarlierLoad(machine.id);
    await mount(<Checkout machine={machine} />);

    await show(machine.id);
    const reloaded = marks();
    await press('Start');
    await press('Express');
    // Express fills the shipping region, so no stored configuration matches, and the leaf picks the recording.
    await preview(machine.id, ['paying.card.error']);
    expect({ reloaded, shown: shown(), source: panel().source }).toEqual({
      reloaded: recordedMarks(['idle', 'paying.card.idle', 'paying.card.error', 'paying.shipping.standard']),
      shown: { value: { paying: { card: 'error', shipping: 'express' } }, context: { step: 2, note: 'Card declined' } },
      source: 'recorded',
    });
  });

  test("this page's visits win over the stored ones, and the next write keeps both, the stored ones first", async () => {
    const machine = createCheckoutMachine();
    await storeEarlierLoad(machine.id);
    await mount(<Checkout machine={machine} />);
    await press('Start');
    await press('Express');

    await preview(machine.id, ['paying.card.idle', 'paying.shipping.standard']);
    const revisited = shown().context;
    await release(machine.id);
    hidePage();
    expect({ revisited, stored: storedEntries(machine.id) }).toEqual({
      revisited: { step: 1, note: 'none' },
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
    ['null', 'null'],
    ['another version', JSON.stringify({ v: 2, entries: [valid] })],
    ['entries that are not an array', JSON.stringify({ v: 1, entries: { 0: valid } })],
    ['an entry that is not an object', JSON.stringify({ v: 1, entries: [valid, null] })],
    ['leaves that are not strings', JSON.stringify({ v: 1, entries: [{ ...valid, leaves: ['a', 1] }] })],
    ['leaves that are not an array', JSON.stringify({ v: 1, entries: [{ ...valid, leaves: 'a' }] })],
    ['a timestamp that is not a number', JSON.stringify({ v: 1, entries: [{ ...valid, at: '1' }] })],
    ['a timestamp that is not finite', '{"v":1,"entries":[{"leaves":["a"],"at":1e999,"context":{}}]}'],
    ['a missing context', JSON.stringify({ v: 1, entries: [{ leaves: ['a'], at: 1 }] })],
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
    function createBulkMachine() {
      return setup({
        types: {
          context: {} as { text: string; stamped?: Date },
          events: {} as { type: 'NEXT' } | { type: 'FIRST' } | { type: 'STAMP' },
        },
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
    for (let index = 0; index < 5; index++) await press('Next', 'first');
    for (let index = 0; index < 5; index++) await press('Next', 'second');
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
        '[state-viewer] Recordings are limited to 1,000,000 characters of storage in total, so only the newest 4 of ' +
          `the 6 recordings for "${second.id}" were saved. All of them stay available until the page reloads.`,
      ],
    });
  });

  test('a context of up to 100,000 characters of JSON is stored, and a larger one stays in memory', async () => {
    const output = watchConsole();
    const machine = setup({
      types: {
        context: {} as { text: string },
        events: {} as { type: 'WRITE'; length: number } | { type: 'CLEAR' },
      },
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
    const machine = setup({
      types: { context: {} as { pad: string }, events: {} as { type: 'NEXT' } | { type: 'GROW' } },
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
    for (let index = 0; index < 7; index++) await press('Next');
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
        `[state-viewer] Storage is full or unavailable, so only the newest 2 of the 8 recordings for "${machine.id}" ` +
          'were saved. All of them stay available until the page reloads.',
      ],
    });
  });
});
