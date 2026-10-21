import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { StateViewer, type FixtureSet, type FixturesInput, type FixturesResult } from 'state-viewer';
import { defineFixtures, useMachine, type FixtureStates } from 'state-viewer/xstate';
import { describe, expect, test } from 'vitest';
import { assign, createMachine, setup, type AnyActorRef, type AnyStateMachine } from 'xstate';
import { watchConsole } from './support/console';
import { REACT_MAJOR } from './support/hooks';
import { flush, freshId, marks, panel, pickSource, preview, release, show, shownKey } from './support/panel';

type CheckoutContext = { step: number; note: string };

type CheckoutEvent = { type: 'START' } | { type: 'FAIL'; note: string } | { type: 'RETRY' } | { type: 'EXPRESS' };

/** A factory. A test makes the machine again with it, as HMR does. Each transition adds one to the step. */
function createCheckoutMachine(id: string) {
  // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
  return setup({
    types: { context: {} as CheckoutContext, events: {} as CheckoutEvent },
    actions: { count: assign({ step: ({ context }) => context.step + 1 }) },
  }).createMachine({
    id,
    context: { step: 0, note: 'live' },
    initial: 'idle',
    states: {
      idle: { on: { START: { target: 'paying', actions: 'count' } } },
      paying: {
        type: 'parallel',
        states: {
          card: {
            initial: 'idle',
            states: {
              idle: {
                on: { FAIL: { target: 'error', actions: ['count', assign({ note: ({ event }) => event.note })] } },
              },
              error: { on: { RETRY: { target: 'idle', actions: 'count' } } },
            },
          },
          shipping: {
            initial: 'standard',
            on: { EXPRESS: { target: '.express', actions: 'count' } },
            states: { standard: {}, express: {} },
          },
        },
      },
      done: { type: 'final' },
    },
  });
}

type CheckoutMachine = ReturnType<typeof createCheckoutMachine>;

/** The context key of an anonymous machine is a parameter. */
type AnonymousMachineTypes = { context: Record<string, string> };

/**
 * A machine without an id. Its state name and its context key set its generated id.
 * A fresh state name gives a fresh id, and so a fresh warning.
 */
function createAnonymousMachine(state: string, contextKey = 'label') {
  // SAFETY: XState reads the types of a machine only at compile time. It never reads this value.
  return createMachine({
    types: {} as AnonymousMachineTypes,
    context: { [contextKey]: 'live' },
    initial: 'closed',
    states: { closed: { on: { OPEN: state } }, [state]: {} },
  });
}

function fixture(note: string) {
  return { context: { step: 99, note } };
}

/** The marks of a checkout that has not moved. The actor starts in idle, so idle is recorded. */
function checkoutMarks(changes: Record<string, string[]> = {}) {
  return {
    idle: ['recorded'],
    'paying.card.idle': ['none'],
    'paying.card.error': ['none'],
    'paying.shipping.standard': ['none'],
    'paying.shipping.express': ['none'],
    done: ['none'],
    ...changes,
  };
}

const LIVE_WARNING = 'No recording or fixture for this state, so the preview uses live context.';

function liveWarning(leaves: string, key: string) {
  return `[state-viewer] No recorded or fixture context for "${leaves}" on "${key}", so the preview uses the live context.`;
}

/** A warning that comes with an error prints the error's stack after its first line. */
function firstLines(lines: string[]): string[] {
  return lines.map((line) => line.split('\n')[0]);
}

const ROOT_SYSTEM_ID = 'root';
const actors = new Map<string, AnyActorRef>();

/** Shows its machine's value and context. Give each one a name when the page renders several. */
function App({ machine, debugId, name = 'app' }: { machine: AnyStateMachine; debugId?: string; name?: string }) {
  const [snapshot, , actor] = useMachine(machine, {
    systemId: ROOT_SYSTEM_ID,
    debug: debugId === undefined ? undefined : { id: debugId },
  });

  actors.set(name, actor);

  return <output data-testid={name}>{JSON.stringify({ value: snapshot.value, context: snapshot.context })}</output>;
}

function shown(name = 'app') {
  return JSON.parse(screen.getByTestId(name).textContent ?? 'null');
}

/** Sends an event to the real actor behind the preview. The real actor continues under a preview, as on a timer. */
async function sendToRealActor(event: { type: string; note?: string }, name = 'app') {
  const actor = actors.get(name);

  if (!actor) throw new Error(`No app named ${name} rendered.`);
  act(() => actor.system.get(ROOT_SYSTEM_ID).send(event));
  await flush();
}

/** Renders the app next to an open <StateViewer />. A rerender with a new machine object is what HMR does. */
async function renderPage(app: React.ReactNode, fixtures?: FixturesInput) {
  const page = (nextApp: React.ReactNode, nextFixtures: FixturesInput | undefined) => (
    <>
      {nextApp}
      <StateViewer defaultOpen fixtures={nextFixtures} />
    </>
  );

  const view = render(page(app, fixtures));
  await flush();

  return {
    async rerender(nextApp: React.ReactNode, nextFixtures = fixtures) {
      view.rerender(page(nextApp, nextFixtures));
      await flush();
    },
  };
}

type Settle = { resolve(result: FixturesResult): void; reject(reason: Error): void };

/** A loader such as `() => import('./fixtures')`. It loads when the test resolves or rejects it. */
function lazyFixtures() {
  let settle!: Settle;

  const loaded = new Promise<FixturesResult>((resolve, reject) => {
    settle = { resolve, reject };
  });

  return {
    loader: () => loaded,
    async resolve(sets: FixtureSet[]) {
      await act(async () => settle.resolve({ default: sets }));
      await flush();
    },
    async reject(reason: Error) {
      await act(async () => settle.reject(reason));
      await flush();
    },
  };
}

test('a fixture gives a state its context: the tree marks the leaf, and a preview shows the fixture', async () => {
  const checkout = createCheckoutMachine(freshId('checkout'));
  const cart = createCheckoutMachine(freshId('cart'));
  await renderPage(
    <>
      <App machine={checkout} name="checkout" />
      <App machine={cart} name="cart" />
    </>,
    [
      defineFixtures(checkout, { done: fixture('placed') }),
      defineFixtures(cart, { 'paying.card.error': fixture('declined') }),
    ],
  );

  await preview(checkout.id, ['done']);
  const previewed = { marks: marks(), shown: shown('checkout'), panel: panel() };
  await show(cart.id);
  expect({ checkout: previewed, cart: marks() }).toEqual({
    checkout: {
      marks: checkoutMarks({ done: ['fixture'] }),
      shown: { value: 'done', context: { step: 99, note: 'placed' } },
      panel: {
        instance: `${checkout.id} · 1`,
        live: ['idle'],
        previewed: ['done'],
        filled: [],
        source: 'fixture',
        context: ['step: 99', 'note: "placed"'],
        warning: '',
      },
    },
    cart: checkoutMarks({ 'paying.card.error': ['fixture'] }),
  });
});

describe('the fixtures prop', () => {
  test.each<[string, (sets: FixtureSet[]) => FixturesInput]>([
    ['an array of sets', (sets) => sets],
    ['a loader that returns them', (sets) => () => sets],
    [
      'a loader that resolves to a module whose default export is them, as import() does',
      (sets) => async () => ({ default: sets }),
    ],
  ])('takes %s', async (_, given) => {
    const machine = createCheckoutMachine(freshId('checkout'));
    await renderPage(<App machine={machine} />, given([defineFixtures(machine, { done: fixture('given') })]));

    await preview(machine.id, ['done']);
    expect({ marks: marks(), source: panel().source, shown: shown() }).toEqual({
      marks: checkoutMarks({ done: ['fixture'] }),
      source: 'fixture',
      shown: { value: 'done', context: { step: 99, note: 'given' } },
    });
  });

  test('a loader that fails gives no fixtures, and warns', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    await renderPage(<App machine={machine} />, () =>
      Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
    );

    await show(machine.id);
    expect({ marks: marks(), warnings: firstLines(output.warn) }).toEqual({
      marks: checkoutMarks(),
      warnings: ['[state-viewer] The fixtures loader failed. TypeError: Failed to fetch dynamically imported module'],
    });
  });

  /** One set without an array, as is or as the default export of a module. The fixtures prop does not take it. */
  type LoneSet = FixtureSet | (() => { default: FixtureSet });

  test.each<[string, (set: FixtureSet) => LoneSet]>([
    ['one set without an array', (set) => set],
    ['a loader of a module whose default export is one set', (set) => () => ({ default: set })],
  ])('%s gives no fixtures, and warns', async (_, given) => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    const set = defineFixtures(machine, { done: fixture('not in an array') });
    // @ts-expect-error The fixtures prop takes an array of sets. A JavaScript app can give it one set.
    await renderPage(<App machine={machine} />, given(set));

    await show(machine.id);
    expect({ marks: marks(), warnings: output.warn }).toEqual({
      marks: checkoutMarks(),
      warnings: [
        '[state-viewer] Expected fixtures to be an array of sets from defineFixtures(), ' +
          'or a module whose default export is one.',
      ],
    });
  });

  test('entries that are not fixture sets are dropped with one warning, and the sets among them register', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    const given = [defineFixtures(machine, { done: fixture('kept') }), null, { machineId: machine.id }];
    // @ts-expect-error The fixtures prop takes only sets. A JavaScript app can give it other values.
    await renderPage(<App machine={machine} />, given);

    await show(machine.id);
    expect({ marks: marks(), warnings: output.warn }).toEqual({
      marks: checkoutMarks({ done: ['fixture'] }),
      warnings: ['[state-viewer] Ignoring fixture entries that are not sets from defineFixtures().'],
    });
  });

  test('a set or a fixture with a bad shape is skipped with a warning, and the rest register', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));

    const given = [
      { machineId: '', states: { done: fixture('no machine id') } },
      { machineId: machine.id, states: [fixture('a list')] },
      {
        machineId: machine.id,
        states: {
          done: fixture('kept'),
          'paying.card.error': { context: undefined },
          'paying.card.idle': 'declined',
          'paying.shipping.standard': { note: 'no context key' },
          'paying.shipping.express': Object.create(fixture('inherited')),
        },
      },
    ];

    // @ts-expect-error A JavaScript app can give sets and fixtures with the wrong properties.
    await renderPage(<App machine={machine} />, given);

    await preview(machine.id, ['paying.card.error']);
    expect({ marks: marks(), panel: panel(), shown: shown(), warnings: output.warn }).toEqual({
      marks: checkoutMarks({ 'paying.card.error': ['fixture'], done: ['fixture'] }),
      panel: {
        instance: `${machine.id} · 1`,
        live: ['idle'],
        previewed: ['paying.card.error'],
        filled: ['paying.shipping.standard'],
        source: 'fixture',
        context: ['undefined'],
        warning: '',
      },
      // XState resolves a state without context to an empty object.
      shown: { value: { paying: { card: 'error', shipping: 'standard' } }, context: {} },
      warnings: [
        '[state-viewer] Ignoring fixture set at index 0: machineId must be a non-empty string.',
        `[state-viewer] Ignoring fixture set "${machine.id}": states must be an object keyed by leaf id.`,
        `[state-viewer] Ignoring fixture "paying.card.idle" for "${machine.id}": expected an object with a context.`,
        `[state-viewer] Ignoring fixture "paying.shipping.standard" for "${machine.id}": expected an object with a context.`,
        `[state-viewer] Ignoring fixture "paying.shipping.express" for "${machine.id}": expected an object with a context.`,
      ],
    });
  });

  test('a set that changes after it registered keeps the fixtures it had', async () => {
    const machine = createCheckoutMachine(freshId('checkout'));
    const done = fixture('as registered');
    const states: FixtureStates<CheckoutMachine> = { done, 'paying.card.error': fixture('as registered') };
    const set = defineFixtures(machine, states);
    const page = await renderPage(<App machine={machine} />, [set]);

    done.context = { step: 0, note: 'changed' };
    delete states['paying.card.error'];
    states['paying.shipping.express'] = fixture('added');
    // A set for another machine registers, and the sets of this machine merge again.
    const cart = createCheckoutMachine(freshId('cart'));
    await page.rerender(<App machine={machine} />, [set, defineFixtures(cart, { done: fixture('cart') })]);

    await preview(machine.id, ['done']);
    expect({ marks: marks(), shown: shown() }).toEqual({
      marks: checkoutMarks({ 'paying.card.error': ['fixture'], done: ['fixture'] }),
      shown: { value: 'done', context: { step: 99, note: 'as registered' } },
    });
  });
});

describe('merging', () => {
  test('the sets of one machine merge, and a later set wins per leaf', async () => {
    const machine = createCheckoutMachine(freshId('checkout'));
    await renderPage(<App machine={machine} />, [
      defineFixtures(machine, { 'paying.shipping.express': fixture('first'), 'paying.card.error': fixture('first') }),
      defineFixtures(machine, { 'paying.card.error': fixture('second'), done: fixture('second') }),
      defineFixtures(machine, { done: fixture('third') }),
    ]);
    await show(machine.id);
    const merged = marks();

    const notes: string[] = [];

    for (const leaf of ['paying.shipping.express', 'paying.card.error', 'done']) {
      await preview(machine.id, [leaf]);
      notes.push(`${leaf}: ${shown().context.note}`);
    }

    expect({ marks: merged, notes }).toEqual({
      marks: checkoutMarks({
        'paying.shipping.express': ['fixture'],
        'paying.card.error': ['fixture'],
        done: ['fixture'],
      }),
      notes: ['paying.shipping.express: first', 'paying.card.error: second', 'done: third'],
    });
  });

  test('fixtures registered before the machine mounts mark it, and sets that load later add to the marks', async () => {
    const machine = createCheckoutMachine(freshId('checkout'));
    const page = await renderPage(null, [defineFixtures(machine, { done: fixture('early') })]);
    await page.rerender(<App machine={machine} />);
    await show(machine.id);
    const mounted = marks();

    await page.rerender(<App machine={machine} />, [
      defineFixtures(machine, { 'paying.card.error': fixture('later') }),
    ]);
    expect({ mounted, later: marks() }).toEqual({
      mounted: checkoutMarks({ done: ['fixture'] }),
      later: checkoutMarks({ done: ['fixture'], 'paying.card.error': ['fixture'] }),
    });
  });
});

describe('a leaf with a recording and a fixture', () => {
  test('has both marks, and its preview takes the recording until the developer picks the fixture', async () => {
    // Earlier tests leave a write of their recordings pending. A write also reads the stored recordings.
    // pagehide does that write now, so only the registration can read this machine's stored recordings.
    window.dispatchEvent(new Event('pagehide'));
    const machine = createCheckoutMachine(freshId('checkout'));
    sessionStorage.setItem(
      `state-viewer:recorded:${machine.id}`,
      JSON.stringify({
        v: 1,
        entries: [
          { leaves: ['paying.card.error', 'paying.shipping.standard'], at: 1, context: { step: 5, note: 'recorded' } },
        ],
      }),
    );
    await renderPage(<App machine={machine} />, [defineFixtures(machine, { 'paying.card.error': fixture('fixture') })]);

    await preview(machine.id, ['paying.card.error']);
    const recorded = { source: panel().source, context: shown().context };
    await pickSource('fixture');
    expect({ marks: marks(), recorded, picked: { source: panel().source, context: shown().context } }).toEqual({
      marks: checkoutMarks({ 'paying.card.error': ['recorded', 'fixture'], 'paying.shipping.standard': ['recorded'] }),
      recorded: { source: 'recorded', context: { step: 5, note: 'recorded' } },
      picked: { source: 'fixture', context: { step: 99, note: 'fixture' } },
    });
  });
});

describe('matching a set to a machine', () => {
  test('a set made for an equivalent machine object matches by machine id', async () => {
    const id = freshId('checkout');
    const machine = createCheckoutMachine(id);
    const equivalent = createCheckoutMachine(id);
    await renderPage(<App machine={machine} />, [defineFixtures(equivalent, { done: fixture('by id') })]);

    await preview(id, ['done']);
    expect({ marks: marks(), source: panel().source, shown: shown() }).toEqual({
      marks: checkoutMarks({ done: ['fixture'] }),
      source: 'fixture',
      shown: { value: 'done', context: { step: 99, note: 'by id' } },
    });
  });

  test('a set matches its machine under the id that debug.id gives it', async () => {
    const machine = createCheckoutMachine(freshId('checkout'));
    const debugId = freshId('checkout-v2');
    await renderPage(<App machine={machine} debugId={debugId} />, [
      defineFixtures(machine, { done: fixture('by machine') }),
    ]);

    await preview(debugId, ['done']);
    expect({ instance: panel().instance, marks: marks(), source: panel().source, shown: shown() }).toEqual({
      instance: `${debugId} · 1`,
      marks: checkoutMarks({ done: ['fixture'] }),
      source: 'fixture',
      shown: { value: 'done', context: { step: 99, note: 'by machine' } },
    });
  });

  test('a set matches a machine.provide() copy under debug.id', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    const debugId = freshId('checkout-v2');
    const provided = machine.provide({ actions: { count: assign({ step: ({ context }) => context.step + 10 }) } });
    await renderPage(<App machine={provided} debugId={debugId} />, [
      defineFixtures(machine, { done: fixture('provided') }),
    ]);

    await preview(debugId, ['done']);
    expect({ marks: marks(), source: panel().source, shown: shown(), warnings: output.warn }).toEqual({
      marks: checkoutMarks({ done: ['fixture'] }),
      source: 'fixture',
      shown: { value: 'done', context: { step: 99, note: 'provided' } },
      warnings: [],
    });
  });

  test('sets made for the machine win over sets that only share its id', async () => {
    const output = watchConsole();
    const id = freshId('checkout');
    const machine = createCheckoutMachine(id);
    const equivalent = createCheckoutMachine(id);
    await renderPage(<App machine={machine} />, [
      defineFixtures(equivalent, { 'paying.card.error': fixture('by id'), done: fixture('by id') }),
      defineFixtures(machine, { 'paying.card.error': fixture('by machine') }),
    ]);

    await preview(id, ['paying.card.error']);
    const error = { source: panel().source, note: shown().context.note };
    await preview(id, ['done']);
    expect({
      marks: marks(),
      error,
      done: { source: panel().source, note: shown().context.note },
      warnings: output.warn,
    }).toEqual({
      marks: checkoutMarks({ 'paying.card.error': ['fixture'] }),
      error: { source: 'fixture', note: 'by machine' },
      done: { source: 'live', note: 'live' },
      warnings: [liveWarning('done', shownKey())],
    });
  });

  test('of two machines that share an id, the one without sets of its own takes every set under the id', async () => {
    const output = watchConsole();
    const id = freshId('form');
    const withSets = createCheckoutMachine(id);
    const without = createCheckoutMachine(id);
    const shared: FixtureSet = { machineId: id, states: { done: fixture('shared') } };
    await renderPage(
      <>
        <App key="with" machine={withSets} name="with" />
        <App key="without" machine={without} name="without" />
      </>,
      [defineFixtures(withSets, { 'paying.card.error': fixture('its own') }), shared],
    );

    const notes: string[] = [];

    for (const [nth, name] of [
      [1, 'with'],
      [2, 'without'],
    ] as const) {
      for (const leaf of ['paying.card.error', 'done']) {
        await preview(id, [leaf], { nth });
        notes.push(`${name} ${leaf}: ${panel().source}, ${shown(name).context.note}`);
      }
    }

    await show(id, 1);
    expect({ notes, warnings: output.warn }).toEqual({
      notes: [
        'with paying.card.error: fixture, its own',
        'with done: live, live',
        'without paying.card.error: fixture, its own',
        'without done: fixture, shared',
      ],
      warnings: [liveWarning('done', shownKey())],
    });
  });

  test('an instance under debug.id takes the sets of a machine registered under that id, as it does after HMR', async () => {
    const id = freshId('checkout');
    const debugId = freshId('checkout-v2');
    const otherDebugId = freshId('checkout-v3');
    const machine = createCheckoutMachine(id);
    const equivalent = createCheckoutMachine(id);
    const third = createCheckoutMachine(id);
    const sets = [defineFixtures(machine, { done: fixture('for the machine') })];

    const page = await renderPage(
      <>
        <App key="equivalent" machine={equivalent} debugId={debugId} name="equivalent" />
      </>,
      sets,
    );

    await show(debugId);
    const alone = marks();

    await page.rerender(
      <>
        <App key="equivalent" machine={equivalent} debugId={debugId} name="equivalent" />
        <App key="machine" machine={machine} debugId={debugId} name="machine" />
        <App key="third" machine={third} debugId={otherDebugId} name="third" />
      </>,
    );
    await preview(debugId, ['done']);
    const joined = { marks: marks(), source: panel().source, shown: shown('equivalent') };
    await show(otherDebugId);
    expect({ alone, joined, otherId: marks() }).toEqual({
      alone: checkoutMarks(),
      joined: {
        marks: checkoutMarks({ done: ['fixture'] }),
        source: 'fixture',
        shown: { value: 'done', context: { step: 99, note: 'for the machine' } },
      },
      otherId: checkoutMarks(),
    });
  });

  test('the marks of a machine follow its first instance, then the next one once it unmounts', async () => {
    const id = freshId('form');
    const first = createCheckoutMachine(id);
    const second = createCheckoutMachine(id);
    const third = createCheckoutMachine(id);

    const page = await renderPage(
      <>
        <App key="first" machine={first} name="first" />
        <App key="second" machine={second} name="second" />
      </>,
      [
        defineFixtures(first, { 'paying.card.error': fixture('first') }),
        defineFixtures(second, { done: fixture('second') }),
        defineFixtures(third, { 'paying.shipping.express': fixture('third') }),
      ],
    );

    // This is a known limit. The second instance shows the marks of the first instance.
    // These marks do not show the fixture that the second instance previews with.
    await preview(id, ['done'], { nth: 2 });
    const shared = { marks: marks(), source: panel().source, shown: shown('second') };

    await page.rerender(
      <>
        <App key="second" machine={second} name="second" />
      </>,
    );
    await show(id);
    const afterFirst = marks();
    await page.rerender(
      <>
        <App key="third" machine={third} name="third" />
      </>,
    );
    await show(id);
    expect({ shared, afterFirst, newInstance: marks() }).toEqual({
      shared: {
        marks: checkoutMarks({ 'paying.card.error': ['fixture'] }),
        source: 'fixture',
        shown: { value: 'done', context: { step: 99, note: 'second' } },
      },
      afterFirst: checkoutMarks({ done: ['fixture'] }),
      newInstance: checkoutMarks({ 'paying.shipping.express': ['fixture'] }),
    });
  });

  test('a machine without an id takes its fixtures under the id it is listed as, and warns once', async () => {
    const output = watchConsole();
    const state = freshId('open');
    const machine = createAnonymousMachine(state);
    const set = defineFixtures(machine, { [state]: { context: { label: 'fixture' } } });
    await renderPage(<App machine={machine} />, [set]);

    await preview(set.machineId, [state]);
    expect({
      id: set.machineId,
      instance: panel().instance,
      marks: marks(),
      shown: shown(),
      warnings: output.warn,
    }).toEqual({
      id: expect.stringMatching(/^machine-[0-9a-z]{7}$/),
      instance: `${set.machineId} · 1`,
      marks: { closed: ['recorded'], [state]: ['fixture'] },
      shown: { value: state, context: { label: 'fixture' } },
      warnings: [
        `[state-viewer] A machine has no id, so it's listed as "${set.machineId}". ` +
          'Give it one with createMachine({ id }) or with the debug option: { debug: { id } }.',
      ],
    });
  });

  test('a machine without an id that is made again with the same states keeps the id and the fixtures', async () => {
    const state = freshId('open');
    const set = defineFixtures(createAnonymousMachine(state), { [state]: { context: { label: 'fixture' } } });
    await renderPage(<App machine={createAnonymousMachine(state)} />, [set]);

    await preview(set.machineId, [state]);
    expect({ marks: marks(), shown: shown() }).toEqual({
      marks: { closed: ['recorded'], [state]: ['fixture'] },
      shown: { value: state, context: { label: 'fixture' } },
    });
  });

  test('a leaf named like an Object method has a fixture only when a set gives it one', async () => {
    type ObjectMachineTypes = { context: { note: string } };

    // SAFETY: XState reads the types of a machine only at compile time. It never reads this value.
    const machine = createMachine({
      id: freshId('object'),
      types: {} as ObjectMachineTypes,
      context: { note: 'live' },
      initial: 'valueOf',
      states: { valueOf: {}, constructor: {}, toString: {} },
    });

    await renderPage(<App machine={machine} />, [
      defineFixtures(machine, { toString: { context: { note: 'fixture' } } }),
    ]);

    await preview(machine.id, ['constructor']);
    expect({ marks: marks(), source: panel().source }).toEqual({
      marks: { valueOf: ['recorded'], constructor: ['none'], toString: ['fixture'] },
      source: 'live',
    });
  });
});

describe('fixtures that register after a preview', () => {
  test('move a preview made before them from the live context to the fixture, and keep its configuration', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    const lazy = lazyFixtures();
    await renderPage(<App machine={machine} />, lazy.loader);
    await preview(machine.id, ['paying.card.error']);
    const before = { panel: panel(), shown: shown() };

    // The real actor moves on. A preview that fills in the shipping region now gets another leaf.
    await sendToRealActor({ type: 'START' });
    await sendToRealActor({ type: 'EXPRESS' });
    await lazy.resolve([defineFixtures(machine, { 'paying.card.error': fixture('loaded late') })]);
    expect({ before, after: { panel: panel(), shown: shown() }, warnings: output.warn }).toEqual({
      before: {
        panel: {
          instance: `${machine.id} · 1`,
          live: ['idle'],
          previewed: ['paying.card.error'],
          filled: ['paying.shipping.standard'],
          source: 'live',
          context: ['step: 0', 'note: "live"'],
          warning: LIVE_WARNING,
        },
        shown: { value: { paying: { card: 'error', shipping: 'standard' } }, context: { step: 0, note: 'live' } },
      },
      after: {
        panel: {
          instance: `${machine.id} · 1`,
          live: ['paying.card.idle', 'paying.shipping.express'],
          previewed: ['paying.card.error'],
          filled: ['paying.shipping.standard'],
          source: 'fixture',
          context: ['step: 99', 'note: "loaded late"'],
          warning: '',
        },
        shown: {
          value: { paying: { card: 'error', shipping: 'standard' } },
          context: { step: 99, note: 'loaded late' },
        },
      },
      warnings: [],
    });
  });

  test('move a fixture preview to a changed fixture, and leave a recorded preview and an uncovered live one alone', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));

    const apps = (
      <>
        <App key="fixture" machine={machine} name="fixture" />
        <App key="recorded" machine={machine} name="recorded" />
        <App key="live" machine={machine} name="live" />
      </>
    );

    const page = await renderPage(apps, [defineFixtures(machine, { done: fixture('v1') })]);
    await preview(machine.id, ['done'], { nth: 1 });
    await preview(machine.id, ['idle'], { nth: 2 });
    await preview(machine.id, ['paying.card.error'], { nth: 3 });
    const liveKey = shownKey();
    // The live preview keeps the context it captured.
    await sendToRealActor({ type: 'START' }, 'live');

    // This is what a change to the fixtures file does. The recording of idle comes before its new fixture.
    await page.rerender(apps, [defineFixtures(machine, { done: fixture('v2'), idle: fixture('idle') })]);
    const sources: string[] = [];

    for (const nth of [1, 2, 3]) {
      await show(machine.id, nth);
      sources.push(panel().source);
    }

    expect({
      sources,
      fixture: shown('fixture'),
      recorded: shown('recorded'),
      live: shown('live'),
      warnings: output.warn,
    }).toEqual({
      sources: ['fixture', 'recorded', 'live'],
      fixture: { value: 'done', context: { step: 99, note: 'v2' } },
      recorded: { value: 'idle', context: { step: 0, note: 'live' } },
      live: { value: { paying: { card: 'error', shipping: 'standard' } }, context: { step: 0, note: 'live' } },
      warnings: [liveWarning('paying.card.error', liveKey)],
    });
  });

  test('leave a preview on the live context that the developer picked, without a warning', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    const lazy = lazyFixtures();
    await renderPage(<App machine={machine} />, lazy.loader);
    await sendToRealActor({ type: 'START' });
    await sendToRealActor({ type: 'FAIL', note: 'declined' });
    await sendToRealActor({ type: 'RETRY' });

    await preview(machine.id, ['paying.card.error'], { source: 'live' });
    await lazy.resolve([defineFixtures(machine, { 'paying.card.error': fixture('loaded') })]);
    expect({ source: panel().source, shown: shown(), warnings: output.warn }).toEqual({
      source: 'live',
      shown: { value: { paying: { card: 'error', shipping: 'standard' } }, context: { step: 3, note: 'declined' } },
      warnings: [],
    });
  });

  test('move a fixture preview to the live context, without a warning, when sets made for the machine outrank its fixture', async () => {
    const output = watchConsole();
    const id = freshId('checkout');
    const machine = createCheckoutMachine(id);
    const equivalent = createCheckoutMachine(id);
    const page = await renderPage(<App machine={machine} />, [defineFixtures(equivalent, { done: fixture('by id') })]);
    await preview(id, ['done']);
    const byId = { source: panel().source, shown: shown() };

    await page.rerender(<App machine={machine} />, [
      defineFixtures(machine, { 'paying.card.error': fixture('by machine') }),
    ]);
    expect({ byId, after: { marks: marks(), panel: panel(), shown: shown() }, warnings: output.warn }).toEqual({
      byId: { source: 'fixture', shown: { value: 'done', context: { step: 99, note: 'by id' } } },
      after: {
        marks: checkoutMarks({ 'paying.card.error': ['fixture'] }),
        panel: {
          instance: `${id} · 1`,
          live: ['idle'],
          previewed: ['done'],
          filled: [],
          source: 'live',
          context: ['step: 0', 'note: "live"'],
          warning: LIVE_WARNING,
        },
        shown: { value: 'done', context: { step: 0, note: 'live' } },
      },
      warnings: [],
    });
  });

  test('move a live preview to the fixture, not to a recording that arrived since', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    const cart = createCheckoutMachine(freshId('cart'));
    const page = await renderPage(<App machine={machine} />);
    await preview(machine.id, ['paying.card.error']);
    const key = shownKey();
    await sendToRealActor({ type: 'START' });
    await sendToRealActor({ type: 'FAIL', note: 'recorded' });
    const recorded = { mark: marks()['paying.card.error'], source: panel().source, context: shown().context };

    await page.rerender(<App machine={machine} />, [defineFixtures(cart, { 'paying.card.error': fixture('cart') })]);
    const otherMachine = { source: panel().source, context: shown().context };
    await page.rerender(<App machine={machine} />, [
      defineFixtures(machine, { 'paying.card.error': fixture('fixture') }),
    ]);
    expect({
      recorded,
      otherMachine,
      own: { source: panel().source, context: shown().context },
      warnings: output.warn,
    }).toEqual({
      recorded: { mark: ['recorded'], source: 'live', context: { step: 0, note: 'live' } },
      otherMachine: { source: 'live', context: { step: 0, note: 'live' } },
      own: { source: 'fixture', context: { step: 99, note: 'fixture' } },
      warnings: [liveWarning('paying.card.error', key)],
    });
  });

  test('leave a preview on a recording alone, though its configuration was recorded again since', async () => {
    const machine = createCheckoutMachine(freshId('checkout'));
    const page = await renderPage(<App machine={machine} />);
    await sendToRealActor({ type: 'START' });
    await sendToRealActor({ type: 'FAIL', note: 'attempt 1' });
    await sendToRealActor({ type: 'RETRY' });
    await preview(machine.id, ['paying.card.error']);
    const before = { source: panel().source, context: shown().context };

    await sendToRealActor({ type: 'FAIL', note: 'attempt 2' });
    await page.rerender(<App machine={machine} />, [
      defineFixtures(machine, { 'paying.card.error': fixture('fixture') }),
    ]);
    expect({ before, after: { source: panel().source, context: shown().context } }).toEqual({
      before: { source: 'recorded', context: { step: 2, note: 'attempt 1' } },
      after: { source: 'recorded', context: { step: 2, note: 'attempt 1' } },
    });
  });

  test('move a fixture preview to a changed fixture, not to a recording that arrived since', async () => {
    const machine = createCheckoutMachine(freshId('checkout'));

    const page = await renderPage(<App machine={machine} />, [
      defineFixtures(machine, { 'paying.card.error': fixture('v1') }),
    ]);

    await preview(machine.id, ['paying.card.error']);
    await sendToRealActor({ type: 'START' });
    await sendToRealActor({ type: 'FAIL', note: 'recorded' });

    await page.rerender(<App machine={machine} />, [defineFixtures(machine, { 'paying.card.error': fixture('v2') })]);
    expect({ mark: marks()['paying.card.error'], source: panel().source, context: shown().context }).toEqual({
      mark: ['recorded', 'fixture'],
      source: 'fixture',
      context: { step: 99, note: 'v2' },
    });
  });
});

describe('the live-context warning while a lazy loader is pending', () => {
  test('a deep link waits, and does not warn when the loaded fixtures give its preview context', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    window.history.replaceState(null, '', `/?debug-state=${machine.id}:done`);
    const lazy = lazyFixtures();
    await renderPage(<App machine={machine} />, lazy.loader);
    await show(machine.id);
    const loading = { source: panel().source, shown: shown(), warnings: [...output.warn] };

    await lazy.resolve([defineFixtures(machine, { done: fixture('loaded') })]);
    expect({ loading, loaded: { source: panel().source, shown: shown() }, warnings: output.warn }).toEqual({
      loading: { source: 'live', shown: { value: 'done', context: { step: 0, note: 'live' } }, warnings: [] },
      loaded: { source: 'fixture', shown: { value: 'done', context: { step: 99, note: 'loaded' } } },
      warnings: [],
    });
  });

  test('a deep link warns when the loader is done, for a state that has no fixture', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    window.history.replaceState(null, '', `/?debug-state=${machine.id}:done`);
    const lazy = lazyFixtures();
    await renderPage(<App machine={machine} />, lazy.loader);
    await show(machine.id);
    const loading = [...output.warn];

    await lazy.resolve([defineFixtures(machine, { 'paying.card.error': fixture('loaded') })]);
    expect({ loading, loaded: output.warn, source: panel().source }).toEqual({
      loading: [],
      loaded: [liveWarning('done', shownKey())],
      source: 'live',
    });
  });

  test('a deep link warns when the loader fails', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    window.history.replaceState(null, '', `/?debug-state=${machine.id}:done`);
    const lazy = lazyFixtures();
    await renderPage(<App machine={machine} />, lazy.loader);
    await show(machine.id);
    const loading = [...output.warn];

    await lazy.reject(new TypeError('Failed to fetch dynamically imported module'));
    expect({ loading, failed: firstLines(output.warn) }).toEqual({
      loading: [],
      failed: [
        '[state-viewer] The fixtures loader failed. TypeError: Failed to fetch dynamically imported module',
        liveWarning('done', shownKey()),
      ],
    });
  });

  test('a deep link warns once for all the instances of a machine', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    window.history.replaceState(null, '', `/?debug-state=${machine.id}:done`);
    const lazy = lazyFixtures();
    await renderPage(
      <>
        <App key="first" machine={machine} name="first" />
        <App key="second" machine={machine} name="second" />
      </>,
      lazy.loader,
    );

    await lazy.resolve([defineFixtures(machine, { 'paying.card.error': fixture('loaded') })]);
    const sources: string[] = [];

    for (const nth of [2, 1]) {
      await show(machine.id, nth);
      sources.push(panel().source);
    }

    expect({ sources, warnings: output.warn }).toEqual({
      sources: ['live', 'live'],
      warnings: [liveWarning('done', shownKey())],
    });
  });

  test('a deep-linked preview that is released before the loader is done does not warn', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    window.history.replaceState(null, '', `/?debug-state=${machine.id}:done`);
    const lazy = lazyFixtures();
    await renderPage(<App machine={machine} />, lazy.loader);
    await release(machine.id);

    await lazy.resolve([defineFixtures(machine, { 'paying.card.error': fixture('loaded') })]);
    expect({ previewed: panel().previewed, shown: shown(), warnings: output.warn }).toEqual({
      previewed: [],
      shown: { value: 'idle', context: { step: 0, note: 'live' } },
      warnings: [],
    });
  });

  test('a deep link waits for a new fixtures input that starts to load before the first is done', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    window.history.replaceState(null, '', `/?debug-state=${machine.id}:done`);
    const first = lazyFixtures();
    const second = lazyFixtures();
    const page = await renderPage(<App machine={machine} />, first.loader);
    await page.rerender(<App machine={machine} />, second.loader);
    await show(machine.id);

    await first.resolve([defineFixtures(machine, { 'paying.card.error': fixture('first') })]);
    const afterFirst = [...output.warn];
    await second.resolve([defineFixtures(machine, { 'paying.card.error': fixture('second') })]);
    expect({ afterFirst, afterSecond: output.warn }).toEqual({
      afterFirst: [],
      afterSecond: [liveWarning('done', shownKey())],
    });
  });

  test('a click in the panel warns only if no fixture loads for the state it previews', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    const lazy = lazyFixtures();
    await renderPage(<App machine={machine} />, lazy.loader);
    await preview(machine.id, ['paying.card.error']);
    await preview(machine.id, ['done']);
    const loading = [...output.warn];

    await lazy.resolve([defineFixtures(machine, { 'paying.card.error': fixture('loaded') })]);
    expect({ loading, loaded: output.warn }).toEqual({
      loading: [],
      loaded: [liveWarning('done', shownKey())],
    });
  });
});

describe('defineFixtures', () => {
  test('warns about keys that are not leaf states of the machine', () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));

    // TypeScript rejects other keys only in an object literal at the call, so a variable gives them, as JavaScript can.
    const withOtherKeys = {
      paying: fixture('compound'),
      'paying.card': fixture('region'),
      'paying.card.error': fixture('leaf'),
      missing: fixture('nothing'),
    };

    defineFixtures(machine, withOtherKeys);
    // @ts-expect-error The keys of fixtures are the leaf ids of the machine. A JavaScript app can give other keys.
    defineFixtures(machine, { missing: fixture('nothing') });
    defineFixtures(machine, { 'paying.card.error': fixture('leaf'), done: fixture('final') });
    expect(output.warn).toEqual([
      `[state-viewer] Fixtures for "${machine.id}" name "paying", "paying.card", "missing", which aren't leaf states of the machine. ` +
        'Fixtures are keyed by the dot path of an atomic or final state, such as "payment.error".',
      `[state-viewer] Fixtures for "${machine.id}" name "missing", which isn't a leaf state of the machine. ` +
        'Fixtures are keyed by the dot path of an atomic or final state, such as "payment.error".',
    ]);
  });
});

describe('after HMR', () => {
  test.each([
    ['registered before the machine mounted', 'before'],
    ['loaded after the machine mounted', 'after'],
  ] as const)('an instance under debug.id keeps the fixtures %s', async (_, when) => {
    const id = freshId('checkout');
    const debugId = freshId('checkout-v2');
    const machine = createCheckoutMachine(id);
    const sets = [defineFixtures(machine, { done: fixture('kept') })];
    let page;

    if (when === 'before') {
      page = await renderPage(null, sets);
      await page.rerender(<App machine={machine} debugId={debugId} />);
    } else {
      const lazy = lazyFixtures();
      page = await renderPage(<App machine={machine} debugId={debugId} />, lazy.loader);
      await lazy.resolve(sets);
    }

    await page.rerender(<App machine={createCheckoutMachine(id)} debugId={debugId} />);
    await preview(debugId, ['done']);
    expect({ marks: marks(), source: panel().source, shown: shown() }).toEqual({
      marks: checkoutMarks({ done: ['fixture'] }),
      source: 'fixture',
      shown: { value: 'done', context: { step: 99, note: 'kept' } },
    });
  });

  test('an instance under debug.id keeps its place in the list, its preview and its fixtures', async () => {
    const id = freshId('checkout');
    const debugId = freshId('checkout-v2');
    const machine = createCheckoutMachine(id);

    const page = await renderPage(<App machine={machine} debugId={debugId} />, [
      defineFixtures(machine, { done: fixture('kept') }),
    ]);

    await preview(debugId, ['done']);
    const key = shownKey();

    await page.rerender(<App machine={createCheckoutMachine(id)} debugId={debugId} />);
    const after = { sameKey: shownKey() === key, panel: panel(), shown: shown(), marks: marks() };
    await preview(debugId, ['done']);
    expect({ after, again: { source: panel().source, shown: shown() } }).toEqual({
      after: {
        sameKey: true,
        panel: {
          instance: `${debugId} · 1`,
          live: ['idle'],
          previewed: ['done'],
          filled: [],
          source: 'fixture',
          context: ['step: 99', 'note: "kept"'],
          warning: '',
        },
        shown: { value: 'done', context: { step: 99, note: 'kept' } },
        marks: checkoutMarks({ done: ['fixture'] }),
      },
      again: { source: 'fixture', shown: { value: 'done', context: { step: 99, note: 'kept' } } },
    });
  });

  test('an instance under debug.id keeps its fixtures when sets for another machine register after HMR', async () => {
    const id = freshId('checkout');
    const debugId = freshId('checkout-v2');
    const machine = createCheckoutMachine(id);
    const sets = [defineFixtures(machine, { done: fixture('kept') })];
    const page = await renderPage(<App machine={machine} debugId={debugId} />, sets);
    const edited = createCheckoutMachine(id);
    await page.rerender(<App machine={edited} debugId={debugId} />);

    const cart = createCheckoutMachine(freshId('cart'));
    await page.rerender(<App machine={edited} debugId={debugId} />, [
      ...sets,
      defineFixtures(cart, { done: fixture('cart') }),
    ]);
    await preview(debugId, ['done']);
    expect({ marks: marks(), source: panel().source, shown: shown() }).toEqual({
      marks: checkoutMarks({ done: ['fixture'] }),
      source: 'fixture',
      shown: { value: 'done', context: { step: 99, note: 'kept' } },
    });
  });

  test('a machine used under two ids keeps its fixtures under both', async () => {
    const id = freshId('checkout');
    const debugId = freshId('checkout-mini');
    const machine = createCheckoutMachine(id);

    const apps = (logic: CheckoutMachine) => (
      <>
        <App key="full" machine={logic} name="full" />
        <App key="mini" machine={logic} debugId={debugId} name="mini" />
      </>
    );

    const page = await renderPage(apps(machine), [defineFixtures(machine, { done: fixture('both') })]);

    await page.rerender(apps(createCheckoutMachine(id)));
    await show(id);
    const full = marks();
    await show(debugId);
    expect({ full, mini: marks() }).toEqual({
      full: checkoutMarks({ done: ['fixture'] }),
      mini: checkoutMarks({ done: ['fixture'] }),
    });
  });

  test('machines without an id keep only their own fixtures', async () => {
    const state = freshId('open');

    // The same states, but other context keys, so each one gets an id of its own.
    const apps = (first: AnyStateMachine, second: AnyStateMachine) => (
      <>
        <App key="first" machine={first} name="first" />
        <App key="second" machine={second} name="second" />
      </>
    );

    const first = createAnonymousMachine(state, 'label');
    const second = createAnonymousMachine(state, 'title');
    const firstSet = defineFixtures(first, { [state]: { context: { label: 'first' } } });
    const secondSet = defineFixtures(second, { [state]: { context: { title: 'second' } } });
    const page = await renderPage(apps(first, second), [firstSet, secondSet]);

    await page.rerender(apps(createAnonymousMachine(state, 'label'), createAnonymousMachine(state, 'title')));
    await preview(firstSet.machineId, [state]);
    const firstShown = shown('first');
    await preview(secondSet.machineId, [state]);
    expect({ first: firstShown, second: shown('second') }).toEqual({
      first: { value: state, context: { label: 'first' } },
      second: { value: state, context: { title: 'second' } },
    });
  });

  test('a preview of a state that the edit removed is released', async () => {
    const output = watchConsole();
    const id = freshId('checkout');
    const page = await renderPage(<App machine={createCheckoutMachine(id)} />);
    await preview(id, ['done']);
    const key = shownKey();
    const before = shown();

    await page.rerender(<App machine={createMachine({ id, initial: 'idle', states: { idle: {}, review: {} } })} />);

    const unshowable =
      `[state-viewer] Can't show the preview of "${key}" on this actor; showing its real state. ` +
      'Error: "done" is not a leaf state of this machine.';

    expect({ before, after: shown(), instance: panel().instance, warnings: firstLines(output.warn) }).toEqual({
      before: { value: 'done', context: { step: 0, note: 'live' } },
      // @xstate/react starts the new actor from the old one's snapshot.
      after: { value: 'idle', context: { step: 0, note: 'live' } },
      instance: `${id} · 1`,
      // React 18's StrictMode throws away the first render, and the actor that render made warns too.
      warnings: [liveWarning('done', key), ...(REACT_MAJOR < 19 ? [unshowable, unshowable] : [unshowable])],
    });
  });

  test('a deep link applied before lazy fixtures load moves to them, and they survive HMR under debug.id', async () => {
    const output = watchConsole();
    const id = freshId('checkout');
    const debugId = freshId('checkout-v2');
    const machine = createCheckoutMachine(id);
    window.history.replaceState(null, '', `/?debug-state=${debugId}:paying.card.error`);
    const lazy = lazyFixtures();
    const page = await renderPage(<App machine={machine} debugId={debugId} />, lazy.loader);
    await show(debugId);
    const linked = { previewed: panel().previewed, source: panel().source };

    await lazy.resolve([defineFixtures(machine, { 'paying.card.error': fixture('declined') })]);
    const loaded = { panel: panel(), shown: shown() };
    // HMR makes the machine again, and doesn't run the fixtures module again.
    await page.rerender(<App machine={createCheckoutMachine(id)} debugId={debugId} />);
    await preview(debugId, ['paying.card.error']);
    expect({
      linked,
      loaded,
      reloaded: { marks: marks(), source: panel().source, shown: shown() },
      warnings: output.warn,
    }).toEqual({
      linked: { previewed: ['paying.card.error'], source: 'live' },
      loaded: {
        panel: {
          instance: `${debugId} · 1`,
          live: ['idle'],
          previewed: ['paying.card.error'],
          filled: ['paying.shipping.standard'],
          source: 'fixture',
          context: ['step: 99', 'note: "declined"'],
          warning: '',
        },
        shown: { value: { paying: { card: 'error', shipping: 'standard' } }, context: { step: 99, note: 'declined' } },
      },
      reloaded: {
        marks: checkoutMarks({ 'paying.card.error': ['fixture'] }),
        source: 'fixture',
        shown: { value: { paying: { card: 'error', shipping: 'standard' } }, context: { step: 99, note: 'declined' } },
      },
      warnings: [],
    });
  });
});
