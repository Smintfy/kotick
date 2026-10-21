import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { Konat, type FixtureSet, type FixturesInput, type FixturesResult } from 'konat';
import { defineFixtures, useMachine } from 'konat/xstate';
import { describe, expect, test } from 'vitest';
import { assign, createMachine, setup, type AnyActorRef, type AnyStateMachine } from 'xstate';
import { watchConsole } from './support/console';
import { flush, freshId, marks, panel, pickSource, preview, show, shownKey } from './support/panel';

type CheckoutContext = { step: number; note: string };

type CheckoutEvent = { type: 'START' } | { type: 'FAIL'; note: string } | { type: 'RETRY' } | { type: 'EXPRESS' };

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

type AnonymousMachineTypes = { context: Record<string, string> };

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

/** The actor starts in idle, so idle is recorded. */
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
  return `[konat] No recorded or fixture context for "${leaves}" on "${key}", so the preview uses the live context.`;
}

/** A warning that comes with an error prints the error's stack after its first line. */
function firstLines(lines: string[]): string[] {
  return lines.map((line) => line.split('\n')[0]);
}

const ROOT_SYSTEM_ID = 'root';
const actors = new Map<string, AnyActorRef>();

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

async function sendToRealActor(event: { type: string; note?: string }, name = 'app') {
  const actor = actors.get(name);

  if (!actor) throw new Error(`No app named ${name} rendered.`);
  act(() => actor.system.get(ROOT_SYSTEM_ID).send(event));
  await flush();
}

/** Renders the app next to an open <Konat />. A rerender with a new machine object is what HMR does. */
async function renderPage(app: React.ReactNode, fixtures?: FixturesInput) {
  const page = (nextApp: React.ReactNode, nextFixtures: FixturesInput | undefined) => (
    <>
      {nextApp}
      <Konat defaultOpen fixtures={nextFixtures} />
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
  test('takes a loader that returns the sets', async () => {
    const machine = createCheckoutMachine(freshId('checkout'));
    const sets = [defineFixtures(machine, { done: fixture('given') })];
    await renderPage(<App machine={machine} />, () => sets);

    await preview(machine.id, ['done']);
    expect({ marks: marks(), source: panel().source, shown: shown() }).toEqual({
      marks: checkoutMarks({ done: ['fixture'] }),
      source: 'fixture',
      shown: { value: 'done', context: { step: 99, note: 'given' } },
    });
  });

  test('one set without an array gives no fixtures, and warns', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    const set = defineFixtures(machine, { done: fixture('not in an array') });
    // @ts-expect-error The fixtures prop takes an array of sets. A JavaScript app can give it one set.
    await renderPage(<App machine={machine} />, set);

    await show(machine.id);
    expect({ marks: marks(), warnings: output.warn }).toEqual({
      marks: checkoutMarks(),
      warnings: [
        '[konat] Expected fixtures to be an array of sets from defineFixtures(), ' +
          'or a module whose default export is one.',
      ],
    });
  });

  test('entries, sets and fixtures with a bad shape are skipped with a warning each, and the rest register', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));

    const given = [
      null,
      { machineId: machine.id },
      { machineId: '', states: { done: fixture('no machine id') } },
      { machineId: machine.id, states: [fixture('a list')] },
      { machineId: machine.id, states: { done: fixture('kept'), 'paying.card.idle': { note: 'no context key' } } },
    ];

    // @ts-expect-error The fixtures prop takes only sets. A JavaScript app can give it other values.
    await renderPage(<App machine={machine} />, given);

    await show(machine.id);
    expect({ marks: marks(), warnings: output.warn }).toEqual({
      marks: checkoutMarks({ done: ['fixture'] }),
      warnings: [
        '[konat] Ignoring fixture entries that are not sets from defineFixtures().',
        '[konat] Ignoring fixture set at index 0: machineId must be a non-empty string.',
        `[konat] Ignoring fixture set "${machine.id}": states must be an object keyed by leaf id.`,
        `[konat] Ignoring fixture "paying.card.idle" for "${machine.id}": expected an object with a context.`,
      ],
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
      `konat:recorded:${machine.id}`,
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

  test.each<[string, (machine: CheckoutMachine) => AnyStateMachine]>([
    ['its machine', (machine) => machine],
    [
      'a machine.provide() copy',
      (machine) => machine.provide({ actions: { count: assign({ step: ({ context }) => context.step + 10 }) } }),
    ],
  ])('a set matches %s under the id that debug.id gives it', async (_, given) => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    const debugId = freshId('checkout-v2');
    await renderPage(<App machine={given(machine)} debugId={debugId} />, [
      defineFixtures(machine, { done: fixture('by machine') }),
    ]);

    await preview(debugId, ['done']);
    expect({
      instance: panel().instance,
      marks: marks(),
      source: panel().source,
      shown: shown(),
      warnings: output.warn,
    }).toEqual({
      instance: `${debugId} · 1`,
      marks: checkoutMarks({ done: ['fixture'] }),
      source: 'fixture',
      shown: { value: 'done', context: { step: 99, note: 'by machine' } },
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
});

describe('fixtures that register after a preview', () => {
  test('move a live preview to a lazily loaded fixture without a warning, and keep its configuration', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    const lazy = lazyFixtures();
    await renderPage(<App machine={machine} />, lazy.loader);
    await preview(machine.id, ['paying.card.error']);
    const before = { panel: panel(), shown: shown(), warnings: [...output.warn] };

    // A preview that fills in the shipping region now gets another leaf.
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
        warnings: [],
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

    // The recording of idle comes before its new fixture.
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

  test('move a live or a fixture preview to the new fixture, not to a recording that arrived since', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));

    const apps = (
      <>
        <App key="live" machine={machine} name="live" />
        <App key="fixture" machine={machine} name="fixture" />
      </>
    );

    const page = await renderPage(apps, [defineFixtures(machine, { 'paying.shipping.express': fixture('v1') })]);
    await preview(machine.id, ['paying.card.error'], { nth: 1 });
    const liveKey = shownKey();
    await preview(machine.id, ['paying.shipping.express'], { nth: 2 });
    await sendToRealActor({ type: 'START' }, 'live');
    await sendToRealActor({ type: 'FAIL', note: 'recorded' }, 'live');
    await sendToRealActor({ type: 'EXPRESS' }, 'live');
    const recorded = { error: marks()['paying.card.error'], express: marks()['paying.shipping.express'] };

    await page.rerender(apps, [
      defineFixtures(machine, { 'paying.card.error': fixture('fixture'), 'paying.shipping.express': fixture('v2') }),
    ]);
    const sources: string[] = [];

    for (const nth of [1, 2]) {
      await show(machine.id, nth);
      sources.push(panel().source);
    }

    expect({
      recorded,
      sources,
      live: shown('live').context,
      fixture: shown('fixture').context,
      warnings: output.warn,
    }).toEqual({
      recorded: { error: ['recorded'], express: ['recorded', 'fixture'] },
      sources: ['fixture', 'fixture'],
      live: { step: 99, note: 'fixture' },
      fixture: { step: 99, note: 'v2' },
      warnings: [liveWarning('paying.card.error', liveKey)],
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
});

describe('the live-context warning while a lazy loader is pending', () => {
  test('a loader that fails gives no fixtures, and warns, and so does a preview that waited for it', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    const lazy = lazyFixtures();
    await renderPage(<App machine={machine} />, lazy.loader);
    await preview(machine.id, ['done']);
    const loading = [...output.warn];

    await lazy.reject(new TypeError('Failed to fetch dynamically imported module'));
    expect({ loading, marks: marks(), failed: firstLines(output.warn) }).toEqual({
      loading: [],
      marks: checkoutMarks(),
      failed: [
        '[konat] The fixtures loader failed. TypeError: Failed to fetch dynamically imported module',
        liveWarning('done', shownKey()),
      ],
    });
  });

  test('a preview waits for a new fixtures input that starts to load before the first is done', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine(freshId('checkout'));
    const first = lazyFixtures();
    const second = lazyFixtures();
    const page = await renderPage(<App machine={machine} />, first.loader);
    await preview(machine.id, ['done']);
    await page.rerender(<App machine={machine} />, second.loader);

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
    defineFixtures(machine, { 'paying.card.error': fixture('leaf'), done: fixture('final') });
    expect(output.warn).toEqual([
      `[konat] Fixtures for "${machine.id}" name "paying", "paying.card", "missing", which aren't leaf states of the machine. ` +
        'Fixtures are keyed by the dot path of an atomic or final state, such as "payment.error".',
    ]);
  });
});

describe('after HMR', () => {
  test.each([
    ['registered before the machine mounted', 'before'],
    ['loaded after the machine mounted', 'after'],
  ] as const)('an instance under debug.id keeps the fixtures %s, when sets for another machine register too', async (_, when) => {
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
});
