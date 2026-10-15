import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { StateViewer } from 'state-viewer';
import {
  connect,
  createActorContext,
  defineFixtures,
  useActor,
  useActorRef,
  useMachine,
  useSelector,
  type DebugOptions,
} from 'state-viewer/xstate';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { assign, createActor, createMachine, setup, type AnyActorRef, type AnyStateMachine } from 'xstate';
import { watchConsole } from './support/console';
import {
  clickLeaf,
  flush,
  freshId,
  header,
  instanceKeys,
  marks,
  overlay,
  panel,
  preview,
  release,
  show,
  shownKey,
} from './support/panel';

function createToggleMachine(name: string) {
  return createMachine({
    id: freshId(name),
    initial: 'off',
    states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } },
  });
}

function createFamily() {
  const fetcher = createMachine({ id: freshId('fetcher'), initial: 'loading', states: { loading: {}, failed: {} } });
  const parent = setup({ actors: { fetcher } }).createMachine({
    id: freshId('parent'),
    initial: 'active',
    states: { active: { invoke: { id: 'load', src: 'fetcher' } } },
  });
  return { parent, fetcher };
}

type Edit = 'as written' | 'without paying.card.error' | 'with paying made compound' | 'with a gift region';

/** A machine edited in the source file: HMR evaluates the file again, so each call makes a new machine object. */
function createCheckoutMachine(id: string, edit: Edit = 'as written') {
  const cardStates: Record<string, object> =
    edit === 'without paying.card.error' ? { idle: {} } : { idle: {}, error: {} };
  const card = { initial: 'idle', states: cardStates };
  const shipping = { initial: 'standard', states: { standard: {}, express: {} } };
  const gift = { initial: 'none', states: { none: {}, wrapped: {} } };
  return createMachine({
    id,
    context: { note: 'live' },
    initial: 'paying',
    states: {
      paying:
        edit === 'with paying made compound'
          ? { initial: 'card', states: { card, shipping } }
          : { type: 'parallel', states: edit === 'with a gift region' ? { card, shipping, gift } : { card, shipping } },
    },
  });
}

type MachineConfig = Parameters<typeof createMachine>[0];

/**
 * The config of a fetch machine without an id. Its states, their types and its context keys make its id.
 * A fresh state name gives a fresh id, and so a fresh warning.
 */
function createFetchConfig(state: string) {
  return {
    context: { items: [] as string[], error: '' },
    initial: 'idle',
    states: {
      idle: { on: { FETCH: 'loading' } },
      loading: {},
      [state]: {},
      failure: { initial: 'retryable', states: { retryable: {}, offline: {} } },
      done: { type: 'final' },
    },
  } satisfies MachineConfig;
}

type FetchConfig = ReturnType<typeof createFetchConfig>;

function reversed<T extends object>(states: T): T {
  return Object.fromEntries(Object.entries(states).reverse()) as T;
}

/** Edits of a fetch machine, as a developer makes them in the source file. */
const FETCH_EDITS = {
  'new context values': (config: FetchConfig) => ({ ...config, context: { items: ['cached'], error: 'Offline' } }),
  'a new transition': (config: FetchConfig) => ({
    ...config,
    states: { ...config.states, loading: { on: { DONE: 'done' } } },
  }),
  'tags and a description': (config: FetchConfig) => ({
    ...config,
    states: { ...config.states, loading: { tags: ['busy'], description: 'Waits for the server' } },
  }),
  'the top-level states in another order': (config: FetchConfig) => ({ ...config, states: reversed(config.states) }),
  'the nested states in another order': (config: FetchConfig) => ({
    ...config,
    states: { ...config.states, failure: { ...config.states.failure, states: reversed(config.states.failure.states) } },
  }),
  'an added state': (config: FetchConfig) => ({ ...config, states: { ...config.states, cancelled: {} } }),
  'a renamed state': (config: FetchConfig) => ({
    ...config,
    states: { ...config.states, failure: { initial: 'retryable', states: { retryable: {}, disconnected: {} } } },
  }),
  'a compound state made parallel': (config: FetchConfig) => ({
    ...config,
    states: { ...config.states, failure: { type: 'parallel', states: config.states.failure.states } },
  }),
  'a final state made atomic': (config: FetchConfig) => ({ ...config, states: { ...config.states, done: {} } }),
  'an added context key': (config: FetchConfig) => ({ ...config, context: { ...config.context, retries: 0 } }),
  'a removed context key': (config: FetchConfig) => ({ ...config, context: { items: [] } }),
} satisfies Record<string, (config: FetchConfig) => MachineConfig>;

/** A list without an id that loads its items. A list of other things has another context key, and so another id. */
function createListMachine(key: string, loaded: string) {
  return createMachine({
    types: {} as { context: Record<string, string[]>; events: { type: 'LOAD'; items: string[] } },
    context: { [key]: [] },
    initial: 'idle',
    states: {
      idle: { on: { LOAD: { target: loaded, actions: assign(({ event }) => ({ [key]: event.items })) } } },
      [loaded]: {},
      failure: {},
    },
  });
}

function List({ machine, name }: { machine: ReturnType<typeof createListMachine>; name: string }) {
  const [snapshot, send] = useMachine(machine);
  return (
    <>
      <output aria-label={name}>{JSON.stringify(snapshot.context)}</output>
      <button type="button" onClick={() => send({ type: 'LOAD', items: ['Ada'] })}>
        {`Load ${name}`}
      </button>
    </>
  );
}

function Instance({ machine, label, debug }: { machine: AnyStateMachine; label?: string; debug?: DebugOptions }) {
  const [snapshot] = useMachine(
    machine,
    label === undefined && debug === undefined ? undefined : { debug: { label, ...debug } },
  );
  return <output aria-label={label ?? machine.id}>{JSON.stringify(snapshot.value)}</output>;
}

function shown(name: string) {
  return JSON.parse(screen.getByRole('status', { name }).textContent ?? 'null');
}

function pickers() {
  const { machine, instance } = header();
  return { machine, instance };
}

/** What the States section shows about the parent and the children of the shown instance. */
function family() {
  const states = [...overlay().querySelectorAll('section.sv-section')].find(
    (section) => section.querySelector('h3')?.textContent === 'States',
  );
  if (!states) throw new Error('The panel shows no States section.');
  return {
    hints: [...states.querySelectorAll('p.sv-hint')].map((hint) => hint.textContent),
    children: [...states.querySelectorAll('.sv-children button')].map((button) => button.textContent),
    readOnly: [...states.querySelectorAll<HTMLElement>('[data-leaf][aria-disabled="true"]')].map(
      (leaf) => leaf.dataset.leaf,
    ),
  };
}

async function clickButton(text: string) {
  const found = [...overlay().querySelectorAll('button')].find((button) => button.textContent === text);
  if (!found) throw new Error(`The panel has no ${text} button.`);
  fireEvent.click(found);
  await flush();
}

/** Names each key by the order in which it first shows, so a test compares keys without their values. */
function keyNames() {
  const names = new Map<string, string>();
  return (keys: string[]) =>
    keys.map((key) => {
      const name = names.get(key) ?? `key ${names.size + 1}`;
      names.set(key, name);
      return name;
    });
}

const MADE_ID = /^machine-[0-9a-z]{7}$/;

function madeIdWarning(id: string) {
  return (
    `[state-viewer] A machine has no id, so it's listed as "${id}". ` +
    'Give it one with createMachine({ id }) or with the debug option: { debug: { id } }.'
  );
}

function liveWarning(leaves: string, key: string) {
  return `[state-viewer] No recorded or fixture context for "${leaves}" on "${key}", so the preview uses the live context.`;
}

test('lists each machine once, in registration order, and its instances as "machine · n"', async () => {
  // connect() registers an actor that runs outside React at once, before any component mounts.
  const app = createToggleMachine('app');
  const actor = createActor(app).start();
  onTestFinished(() => {
    actor.stop();
  });
  connect(actor);
  const checkout = createToggleMachine('checkout');
  const toggle = createToggleMachine('toggle');
  render(
    <>
      <Instance machine={checkout} />
      <Instance machine={toggle} />
      <Instance machine={toggle} label="Second toggle" />
      <StateViewer defaultOpen />
    </>,
  );
  await flush();

  const first = pickers();
  await show(toggle.id);
  const toggles = pickers();
  await preview(toggle.id, ['on'], { nth: 2 });
  const machines = [app.id, checkout.id];
  expect({
    first,
    toggles,
    previewed: { ...pickers(), shown: [shown(toggle.id), shown('Second toggle')] },
  }).toEqual({
    first: {
      machine: { options: [...machines, `${toggle.id} (2)`], selected: app.id, disabled: false },
      instance: { options: [`${app.id} · 1`], selected: `${app.id} · 1`, disabled: true },
    },
    toggles: {
      machine: { options: [...machines, `${toggle.id} (2)`], selected: `${toggle.id} (2)`, disabled: false },
      instance: {
        options: [`${toggle.id} · 1`, 'Second toggle · 2'],
        selected: `${toggle.id} · 1`,
        disabled: false,
      },
    },
    previewed: {
      machine: { options: [...machines, `${toggle.id} (2) ●`], selected: `${toggle.id} (2) ●`, disabled: false },
      instance: {
        options: [`${toggle.id} · 1`, 'Second toggle · 2 ●'],
        selected: 'Second toggle · 2 ●',
        disabled: false,
      },
      shown: ['off', 'on'],
    },
  });
});

test('rows come and go as their components mount and unmount, and keep the order they registered in', async () => {
  const machine = createToggleMachine('row');
  const rows = (labels: string[]) => (
    <>
      {labels.map((label) => (
        <Instance key={label} machine={machine} label={label} />
      ))}
      <StateViewer defaultOpen />
    </>
  );
  const view = render(rows(['B', 'C']));
  await flush();
  const seen = () => ({ previewing: header().previewing, instances: header().instance?.options ?? null });

  const steps = [seen()];
  view.rerender(rows(['A', 'B', 'C']));
  await flush();
  steps.push(seen());
  await preview(machine.id, ['on']);
  steps.push(seen());
  view.rerender(rows(['A', 'C']));
  await flush();
  steps.push(seen());
  view.rerender(rows([]));
  await flush();
  steps.push(seen());
  expect(steps).toEqual([
    { previewing: '', instances: ['B · 1', 'C · 2'] },
    { previewing: '', instances: ['B · 1', 'C · 2', 'A · 3'] },
    { previewing: '1 previewing', instances: ['B · 1 ●', 'C · 2', 'A · 3'] },
    { previewing: '', instances: ['C · 1', 'A · 2'] },
    { previewing: '', instances: null },
  ]);
});

test('each hook, and the Provider of createActorContext, lists its machine', async () => {
  const [viaUseMachine, viaUseActor, viaUseActorRef, viaContext] = [
    'use-machine',
    'use-actor',
    'use-actor-ref',
    'context',
  ].map((name) => createToggleMachine(name));
  const Context = createActorContext(viaContext);
  function ViaUseActor() {
    useActor(viaUseActor);
    return null;
  }
  function ViaUseActorRef() {
    useActorRef(viaUseActorRef);
    return null;
  }
  render(
    <>
      <Instance machine={viaUseMachine} />
      <ViaUseActor />
      <ViaUseActorRef />
      <Context.Provider>{null}</Context.Provider>
      <StateViewer defaultOpen />
    </>,
  );
  await flush();

  expect(header().machine?.options).toEqual([viaUseMachine.id, viaUseActor.id, viaUseActorRef.id, viaContext.id]);
});

test('a preview renders the component of the previewed instance again, and no other', async () => {
  const machine = createToggleMachine('row');
  const commits: string[] = [];
  function Row({ label }: { label: string }) {
    const [snapshot] = useMachine(machine, { debug: { label } });
    React.useLayoutEffect(() => {
      commits.push(label);
    });
    return <output aria-label={label}>{JSON.stringify(snapshot.value)}</output>;
  }
  render(
    <>
      <Row label="A" />
      <Row label="B" />
      <Row label="C" />
      <StateViewer defaultOpen />
    </>,
  );
  await flush();
  await show(machine.id, 2);

  commits.length = 0;
  await clickLeaf('on');
  expect({ commits, shown: [shown('A'), shown('B'), shown('C')] }).toEqual({
    commits: ['B'],
    shown: ['off', 'on', 'off'],
  });
});

describe('instance keys', () => {
  test('each hook gets a key of its own, which a re-render keeps and a remount replaces', async () => {
    const machine = createToggleMachine('toggle');
    const rows = (entries: [key: string, label: string][]) => (
      <>
        {entries.map(([key, label]) => (
          <Instance key={key} machine={machine} label={label} />
        ))}
        <StateViewer defaultOpen />
      </>
    );
    const view = render(
      rows([
        ['first', 'One'],
        ['second', 'Two'],
      ]),
    );
    await flush();
    await show(machine.id);
    const name = keyNames();
    const seen = () => ({ instances: header().instance?.options, keys: name(instanceKeys()) });

    const steps = [seen()];
    view.rerender(
      rows([
        ['first', 'Uno'],
        ['second', 'Dos'],
      ]),
    );
    await flush();
    steps.push(seen());
    view.rerender(
      rows([
        ['first', 'Uno'],
        ['third', 'Tres'],
      ]),
    );
    await flush();
    steps.push(seen());
    expect(steps).toEqual([
      { instances: ['One · 1', 'Two · 2'], keys: ['key 1', 'key 2'] },
      { instances: ['Uno · 1', 'Dos · 2'], keys: ['key 1', 'key 2'] },
      { instances: ['Uno · 1', 'Tres · 2'], keys: ['key 1', 'key 3'] },
    ]);
  });

  test('islands that hydrate as roots of their own get keys of their own, so each previews and unmounts alone', async () => {
    const machine = createToggleMachine('island');
    const recoverable: unknown[] = [];
    // React's useId gives the same ids in each hydrated root, so a key made from it would be the same in each.
    function hydrateIsland(label: string) {
      const container = document.createElement('div');
      container.innerHTML = `<output aria-label="${label}">"off"</output>`;
      document.body.append(container);
      return render(<Instance machine={machine} label={label} />, {
        container,
        hydrate: true,
        onRecoverableError: (error) => {
          recoverable.push(error);
        },
      });
    }
    render(<StateViewer defaultOpen />);
    hydrateIsland('A');
    const b = hydrateIsland('B');
    await flush();
    const name = keyNames();

    await preview(machine.id, ['on']);
    const previewed = { keys: name(instanceKeys()), shown: [shown('A'), shown('B')] };
    hydrateIsland('C');
    await flush();
    const hydrated = { keys: name(instanceKeys()), shown: [shown('A'), shown('B'), shown('C')] };
    b.unmount();
    await flush();
    expect({
      previewed,
      hydrated,
      unmounted: { instances: header().instance?.options, keys: name(instanceKeys()) },
      recoverable,
    }).toEqual({
      previewed: { keys: ['key 1', 'key 2'], shown: ['on', 'off'] },
      hydrated: { keys: ['key 1', 'key 2', 'key 3'], shown: ['on', 'off', 'off'] },
      unmounted: { instances: ['A · 1 ●', 'C · 2'], keys: ['key 1', 'key 3'] },
      recoverable: [],
    });
  });
});

describe('child machines', () => {
  test('are listed read-only under their parent', async () => {
    const { parent, fetcher } = createFamily();
    render(
      <>
        <Instance machine={parent} />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

    const atParent = { ...pickers(), family: family() };
    await clickButton('load · 1');
    const atChild = { ...pickers(), family: family() };
    await clickLeaf('failed');
    expect({ atParent, atChild, clicked: { previewed: panel().previewed, previewing: header().previewing } }).toEqual({
      atParent: {
        machine: { options: [parent.id, `${fetcher.id} (child)`], selected: parent.id, disabled: false },
        instance: { options: [`${parent.id} · 1`], selected: `${parent.id} · 1`, disabled: true },
        family: { hints: [], children: ['load · 1'], readOnly: [] },
      },
      atChild: {
        machine: { options: [parent.id, `${fetcher.id} (child)`], selected: `${fetcher.id} (child)`, disabled: false },
        instance: { options: ['load · 1'], selected: 'load · 1', disabled: true },
        family: {
          hints: [`Child of ${parent.id} · 1. Child machines are listed read-only.`],
          children: [],
          readOnly: ['loading', 'failed'],
        },
      },
      clicked: { previewed: [], previewing: '' },
    });
  });

  test('a machine that also runs on its own is an ordinary machine, and only its own instances preview', async () => {
    const { parent, fetcher } = createFamily();
    render(
      <>
        <Instance machine={parent} />
        <Instance machine={fetcher} />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

    for (const nth of [1, 2]) {
      await show(fetcher.id, nth);
      await clickLeaf('failed');
    }
    // XState creates the invoked child with the parent's first snapshot, so it registers with the parent, first.
    const { machine, instance } = header();
    expect({ machines: machine?.options, instances: instance?.options, shown: shown(fetcher.id) }).toEqual({
      machines: [parent.id, `${fetcher.id} (2) ●`],
      instances: ['load · 1', `${fetcher.id} · 2 ●`],
      shown: 'failed',
    });
  });
});

describe('editing a machine, as Fast Refresh does', () => {
  // The edited machine keeps its id. @xstate/react starts a new actor for its new config, which registers in the
  // place of the old one.
  function App({ machine, toggle }: { machine: AnyStateMachine; toggle: AnyStateMachine }) {
    return (
      <>
        <Instance machine={machine} label="First" />
        <Instance machine={machine} label="Second" />
        <Instance machine={toggle} />
        <StateViewer defaultOpen />
      </>
    );
  }

  test('keeps the preview, and each row in its place', async () => {
    const id = freshId('checkout');
    const toggle = createToggleMachine('toggle');
    const view = render(<App machine={createCheckoutMachine(id)} toggle={toggle} />);
    await flush();
    await preview(id, ['paying.card.error']);

    view.rerender(<App machine={createCheckoutMachine(id)} toggle={toggle} />);
    await flush();
    const { previewing, machine, instance } = header();
    expect({
      previewing,
      machines: machine?.options,
      instances: instance?.options,
      previewed: panel().previewed,
      shown: [shown('First'), shown('Second')],
    }).toEqual({
      previewing: '1 previewing',
      machines: [`${id} (2) ●`, toggle.id],
      instances: ['First · 1 ●', 'Second · 2'],
      previewed: ['paying.card.error'],
      shown: [
        { paying: { card: 'error', shipping: 'standard' } },
        { paying: { card: 'idle', shipping: 'standard' } },
      ],
    });
  });

  test.each([
    ['removes the previewed leaf', 'without paying.card.error', ['paying.card.error']],
    [
      'puts the previewed leaves in states that exclude each other',
      'with paying made compound',
      ['paying.card.error', 'paying.shipping.express'],
    ],
  ] as const)('an edit that %s ends the preview', async (_, edit, leaves) => {
    const id = freshId('checkout');
    const app = (machine: AnyStateMachine) => (
      <>
        <Instance machine={machine} />
        <StateViewer defaultOpen />
      </>
    );
    const view = render(app(createCheckoutMachine(id)));
    await flush();
    await preview(id, [...leaves]);
    const before = header().previewing;

    view.rerender(app(createCheckoutMachine(id, edit)));
    await flush();
    // @xstate/react starts the new actor from the persisted snapshot of the old one, so the live state carries over.
    expect({ before, after: header().previewing, previewed: panel().previewed, shown: shown(id) }).toEqual({
      before: '1 previewing',
      after: '',
      previewed: [],
      shown: { paying: { card: 'idle', shipping: 'standard' } },
    });
  });

  test('an edit that adds a region keeps the preview, which shows the initial leaf of the new region', async () => {
    const id = freshId('checkout');
    const app = (machine: AnyStateMachine) => (
      <>
        <Instance machine={machine} />
        <StateViewer defaultOpen />
      </>
    );
    const view = render(app(createCheckoutMachine(id)));
    await flush();
    await preview(id, ['paying.card.error']);

    view.rerender(app(createCheckoutMachine(id, 'with a gift region')));
    await flush();
    expect({ previewed: panel().previewed, filled: panel().filled, shown: shown(id) }).toEqual({
      previewed: ['paying.card.error'],
      filled: ['paying.shipping.standard', 'paying.gift.none'],
      shown: { paying: { card: 'error', shipping: 'standard', gift: 'none' } },
    });
  });

  test('a picked source stays picked through the edit, when the fixtures file registers its fixtures again', async () => {
    const id = freshId('checkout');
    // The fixtures file imports the machine, so HMR evaluates it again with the edited machine.
    const app = (machine: AnyStateMachine) => (
      <>
        <Instance machine={machine} />
        <StateViewer
          defaultOpen
          fixtures={[defineFixtures(machine, { 'paying.card.error': { context: { note: 'card error' } } })]}
        />
      </>
    );
    const view = render(app(createCheckoutMachine(id)));
    await flush();
    await preview(id, ['paying.card.error'], { source: 'live' });

    view.rerender(app(createCheckoutMachine(id, 'with a gift region')));
    await flush();
    expect({ source: panel().source, context: panel().context, filled: panel().filled }).toEqual({
      source: 'live',
      context: ['note: "live"'],
      filled: ['paying.shipping.standard', 'paying.gift.none'],
    });
  });
});

describe('machine ids', () => {
  test('an id that every object has as a property, such as constructor, lists and previews like any other', async () => {
    const machine = createMachine({ id: 'constructor', initial: 'off', states: { off: {}, on: {} } });
    render(
      <>
        <Instance machine={machine} />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

    await preview('constructor', ['on']);
    expect({ machines: header().machine?.options, previewed: panel().previewed, shown: shown('constructor') }).toEqual({
      machines: ['constructor ●'],
      previewed: ['on'],
      shown: 'on',
    });
  });

  test('a machine without an id is listed under an id made from its states, with one warning', async () => {
    const output = watchConsole();
    const machine = createMachine(createFetchConfig(freshId('open')));
    const id = defineFixtures(machine, {}).machineId;
    render(
      <>
        <Instance machine={machine} label="First" />
        <Instance machine={machine} label="Second" />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

    expect({ id, pickers: pickers(), warnings: output.warn }).toEqual({
      id: expect.stringMatching(MADE_ID),
      pickers: {
        machine: { options: [`${id} (2)`], selected: `${id} (2)`, disabled: false },
        instance: { options: ['First · 1', 'Second · 2'], selected: 'First · 1', disabled: false },
      },
      warnings: [madeIdWarning(id)],
    });
  });

  test('a machine is listed under debug.id, then under its own id, then under a made id, and only a made id warns', async () => {
    const output = watchConsole();
    const named = createToggleMachine('named');
    const anonymous = createMachine(createFetchConfig(freshId('open')));
    // XState gives a machine without an id the id "(machine)", so a machine with that id has none of its own.
    const defaultId = createMachine({ ...createFetchConfig(freshId('open')), id: '(machine)' });
    const debugIds = [freshId('named-debug'), freshId('anonymous-debug')];
    render(
      <>
        <Instance machine={named} label="named, debug.id" debug={{ id: debugIds[0] }} />
        <Instance machine={anonymous} label="anonymous, debug.id" debug={{ id: debugIds[1] }} />
        <Instance machine={named} label="named, empty debug.id" debug={{ id: '' }} />
        <Instance machine={anonymous} label="anonymous, empty debug.id" debug={{ id: '' }} />
        <Instance machine={defaultId} label="(machine)" />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

    const made = [anonymous, defaultId].map((machine) => defineFixtures(machine, {}).machineId);
    expect({ machines: header().machine?.options, warnings: output.warn }).toEqual({
      machines: [...debugIds, named.id, ...made],
      warnings: made.map(madeIdWarning),
    });
  });

  test('a made id stays through edits of context values, transitions and state order, and changes with the states or the context keys', () => {
    const state = freshId('open');
    const idOf = (config: MachineConfig) => defineFixtures(createMachine(config), {}).machineId;
    const original = idOf(createFetchConfig(state));
    const edited = Object.fromEntries(
      Object.entries(FETCH_EDITS).map(([edit, apply]) => [
        edit,
        idOf(apply(createFetchConfig(state))) === original ? 'same id' : 'new id',
      ]),
    );
    expect(edited).toEqual({
      'new context values': 'same id',
      'a new transition': 'same id',
      'tags and a description': 'same id',
      'the top-level states in another order': 'same id',
      'the nested states in another order': 'same id',
      'an added state': 'new id',
      'a renamed state': 'new id',
      'a compound state made parallel': 'new id',
      'a final state made atomic': 'new id',
      'an added context key': 'new id',
      'a removed context key': 'new id',
    });
  });

  test('an edit that moves states up or down keeps the made id, so the preview and the fixtures stay, and nothing warns again', async () => {
    const output = watchConsole();
    const state = freshId('open');
    const original = createMachine(createFetchConfig(state));
    const id = defineFixtures(original, {}).machineId;
    const fixtures = [
      defineFixtures(original, { 'failure.offline': { context: { items: [], error: 'Network down' } } }),
    ];
    const app = (machine: AnyStateMachine) => (
      <>
        <Instance machine={machine} label="fetch" />
        <StateViewer defaultOpen fixtures={fixtures} />
      </>
    );
    const view = render(app(original));
    await flush();
    await preview(id, ['failure.offline']);

    const edit = (config: FetchConfig) =>
      FETCH_EDITS['the nested states in another order'](FETCH_EDITS['the top-level states in another order'](config));
    view.rerender(app(createMachine(edit(createFetchConfig(state)))));
    await flush();
    expect({
      machines: header().machine?.options,
      previewed: panel().previewed,
      source: panel().source,
      context: panel().context,
      shown: shown('fetch'),
      warnings: output.warn,
    }).toEqual({
      machines: [`${id} ●`],
      previewed: ['failure.offline'],
      source: 'fixture',
      context: ['items: []', 'error: "Network down"'],
      shown: { failure: 'offline' },
      warnings: [madeIdWarning(id)],
    });
  });

  test('machines without an id that share their states but not their context keys are two machines, each with its own recordings', async () => {
    const output = watchConsole();
    const loaded = freshId('loaded');
    const users = createListMachine('users', loaded);
    const posts = createListMachine('posts', loaded);
    render(
      <>
        <List machine={users} name="users" />
        <List machine={posts} name="posts" />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Load users' }));
    await flush();

    const [usersId, postsId] = [users, posts].map((machine) => defineFixtures(machine, {}).machineId);
    await preview(postsId, [loaded]);
    expect({
      machines: header().machine?.options,
      marks: marks(),
      source: panel().source,
      shown: [shown('users'), shown('posts')],
      warnings: output.warn,
    }).toEqual({
      machines: [usersId, `${postsId} ●`],
      marks: { idle: ['recorded'], [loaded]: ['none'], failure: ['none'] },
      source: 'live',
      shown: [{ users: ['Ada'] }, { posts: [] }],
      warnings: [madeIdWarning(usersId), madeIdWarning(postsId), liveWarning(loaded, shownKey())],
    });
  });
});

describe('debug options', () => {
  test('debug.id and debug.label name the machine and the instance, and only the other options reach XState', async () => {
    const machine = setup({ types: { input: {} as { name: string }, context: {} as { name: string } } }).createMachine({
      id: freshId('greeting'),
      context: ({ input }) => ({ name: input.name }),
      initial: 'hello',
      states: { hello: {} },
    });
    const debugId = freshId('greeter');
    const actors: AnyActorRef[] = [];
    function Greeting() {
      const [snapshot, , actorRef] = useMachine(machine, {
        input: { name: 'Ada' },
        id: 'greeter',
        debug: { id: debugId, label: 'Greeter' },
      });
      React.useLayoutEffect(() => {
        actors.push(actorRef);
      }, [actorRef]);
      return <output aria-label="greeting">{JSON.stringify(snapshot.context)}</output>;
    }
    render(
      <>
        <Greeting />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

    const actor = actors[0] as AnyActorRef & { options: Record<string, unknown> };
    expect({
      shown: shown('greeting'),
      pickers: pickers(),
      actor: { id: actor.id, input: actor.options.input, debug: 'debug' in actor.options },
    }).toEqual({
      shown: { name: 'Ada' },
      pickers: {
        machine: { options: [debugId], selected: debugId, disabled: false },
        instance: { options: ['Greeter · 1'], selected: 'Greeter · 1', disabled: true },
      },
      actor: { id: 'greeter', input: { name: 'Ada' }, debug: false },
    });
  });

  test('a debug.label that changes relabels the instance in place, with its key, its preview, its actor ref and its component', async () => {
    const machine = createToggleMachine('lamp');
    const actorRefs = new Set<unknown>();
    function Lamp({ label }: { label: string }) {
      const [snapshot, , actorRef] = useMachine(machine, { debug: { label } });
      // Committed renders only: React 18's StrictMode throws away the first render, and the actor that it made.
      React.useLayoutEffect(() => {
        actorRefs.add(actorRef);
      });
      return (
        <>
          <output aria-label="lamp">{JSON.stringify(snapshot.value)}</output>
          <input aria-label="note" />
        </>
      );
    }
    const app = (label: string) => (
      <>
        <Lamp label={label} />
        <Instance machine={machine} label="Other" />
        <StateViewer defaultOpen />
      </>
    );
    const view = render(app('Before'));
    await flush();
    fireEvent.change(screen.getByLabelText('note'), { target: { value: 'typed before the new label' } });
    await preview(machine.id, ['on']);
    const key = shownKey();

    view.rerender(app('After'));
    await flush();
    const relabeled = {
      instances: header().instance?.options,
      key: shownKey(),
      previewed: panel().previewed,
      shown: shown('lamp'),
      note: screen.getByLabelText<HTMLInputElement>('note').value,
      actorRefs: actorRefs.size,
    };
    await release(machine.id);
    expect({ relabeled, released: shown('lamp') }).toEqual({
      relabeled: {
        instances: ['After · 1 ●', 'Other · 2'],
        key,
        previewed: ['on'],
        shown: 'on',
        note: 'typed before the new label',
        actorRefs: 1,
      },
      released: 'off',
    });
  });

  type ToggleMachine = ReturnType<typeof createToggleMachine>;

  test.each<[string, (props: { machine: ToggleMachine }) => React.ReactNode]>([
    [
      'useMachine',
      function ViaUseMachine({ machine }) {
        const [snapshot, send] = useMachine(machine, { debug: { disabled: true } });
        return (
          <>
            <output aria-label="toggle">{JSON.stringify(snapshot.value)}</output>
            <button type="button" onClick={() => send({ type: 'TOGGLE' })}>
              Toggle
            </button>
          </>
        );
      },
    ],
    [
      'useActorRef',
      function ViaUseActorRef({ machine }) {
        const actorRef = useActorRef(machine, { debug: { disabled: true } });
        const value = useSelector(actorRef, (snapshot) => snapshot.value);
        return (
          <>
            <output aria-label="toggle">{JSON.stringify(value)}</output>
            <button type="button" onClick={() => actorRef.send({ type: 'TOGGLE' })}>
              Toggle
            </button>
          </>
        );
      },
    ],
  ])('debug.disabled through %s leaves the machine out of the overlay, and lets its events through', async (_, Toggle) => {
    const machine = createToggleMachine('toggle');
    // A link previews a machine that the overlay lists, and the preview blocks its events.
    window.history.replaceState(null, '', `/?debug-state=${machine.id}:on`);
    render(
      <>
        <Toggle machine={machine} />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

    const before = shown('toggle');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    await flush();
    expect({ machine: header().machine, before, after: shown('toggle') }).toEqual({
      machine: null,
      before: 'off',
      after: 'on',
    });
  });
});

describe("StrictMode's second run of effects", () => {
  test('a link applied as the instances register in the first run still shows after the second, and the list keeps its order', async () => {
    const output = watchConsole();
    const id = freshId('checkout');
    const machine = createCheckoutMachine(id);
    const late = createToggleMachine('late');
    let lateActor: AnyActorRef | undefined;
    onTestFinished(() => {
      lateActor?.stop();
    });
    // Connects once, between the two runs. A checkout that registered at the end of the second run would come after it.
    function ConnectLate() {
      React.useEffect(() => {
        lateActor ??= connect(createActor(late).start());
      }, []);
      return null;
    }
    window.history.replaceState(null, '', `/?debug-state=${id}:paying.card.error`);
    render(
      <>
        <Instance machine={machine} label="First" />
        <Instance machine={machine} label="Second" />
        <ConnectLate />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

    await show(id);
    const error = { paying: { card: 'error', shipping: 'standard' } };
    expect({
      machines: header().machine?.options,
      instances: header().instance?.options,
      shown: [shown('First'), shown('Second')],
      warnings: output.warn,
    }).toEqual({
      machines: [`${id} (2) ●`, late.id],
      instances: ['First · 1 ●', 'Second · 2 ●'],
      shown: [error, error],
      warnings: [liveWarning('paying.card.error', shownKey())],
    });
  });
});

describe.each([
  ['under StrictMode', true],
  ['without StrictMode', false],
])('content that Suspense hides, %s', (_, reactStrictMode) => {
  // Suspense hides content that it showed already when a sibling suspends outside a transition, as a lazy dialog
  // does. The content stays mounted, and the actors that @xstate/react started keep running.
  async function mountPage() {
    const machine = createMachine({
      id: freshId('lamp'),
      initial: 'off',
      states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } }, dimmed: {} },
    });
    const observed: unknown[] = [];
    let observedActor: AnyActorRef | undefined;
    function ObservedLamp() {
      const actorRef = useActorRef(machine, { debug: { label: 'Observed' } }, (snapshot) => {
        observed.push(snapshot.value);
      });
      React.useLayoutEffect(() => {
        observedActor = actorRef;
      }, [actorRef]);
      return null;
    }
    function Page({ dialog: Dialog }: { dialog?: React.ComponentType }) {
      return (
        <>
          <React.Suspense fallback={<p>Loading the dialog</p>}>
            <Instance machine={machine} label="Hidden" />
            <ObservedLamp />
            {Dialog ? <Dialog /> : null}
          </React.Suspense>
          <Instance machine={machine} label="Outside" />
          <StateViewer defaultOpen />
        </>
      );
    }
    const view = render(<Page />, { reactStrictMode });
    await flush();
    return {
      machine,
      observed,
      observedActor: () => {
        if (!observedActor) throw new Error('The observed lamp did not mount.');
        return observedActor;
      },
      /** Opens a dialog whose code loads until the returned function loads it. Suspense hides the content meanwhile. */
      async hide() {
        let load = () => {};
        const code = new Promise<{ default: React.ComponentType }>((resolve) => {
          load = () => resolve({ default: () => <p>Dialog</p> });
        });
        const Dialog = React.lazy(() => code);
        await act(async () => {
          view.rerender(<Page dialog={Dialog} />);
        });
        await flush();
        return async () => {
          await act(async () => {
            load();
            await code;
          });
          await flush();
        };
      },
    };
  }

  test('its instances stay listed in their place, previewed and recording, while they are hidden', async () => {
    const page = await mountPage();
    await preview(page.machine.id, ['on']);
    const before = marks();

    const reveal = await page.hide();
    await act(async () => {
      page.observedActor().send({ type: 'TOGGLE' });
    });
    const hidden = {
      fallback: screen.queryByText('Loading the dialog')?.textContent,
      instances: header().instance?.options,
      marks: marks(),
    };
    await reveal();
    expect({
      before,
      hidden,
      revealed: {
        instances: header().instance?.options,
        shown: [shown('Hidden'), shown('Outside')],
        observed: page.observed.at(-1),
      },
    }).toEqual({
      before: { off: ['recorded'], on: ['none'], dimmed: ['none'] },
      hidden: {
        fallback: 'Loading the dialog',
        instances: ['Hidden · 1 ●', 'Observed · 2', 'Outside · 3'],
        marks: { off: ['recorded'], on: ['recorded'], dimmed: ['none'] },
      },
      revealed: {
        instances: ['Hidden · 1 ●', 'Observed · 2', 'Outside · 3'],
        shown: ['on', 'off'],
        observed: 'on',
      },
    });
  });

  test.each<[string, string | undefined, string | undefined]>([
    ['starts', undefined, 'on'],
    ['changes', 'on', 'dimmed'],
    ['ends', 'on', undefined],
  ])(
    'a preview that %s while they are hidden shows once they show, in the component and the useActorRef observer',
    async (_change, before, whileHidden) => {
      const page = await mountPage();
      const previewBoth = async (leaf: string | undefined) => {
        for (const nth of [1, 2]) {
          if (leaf === undefined) await release(page.machine.id, nth);
          else await preview(page.machine.id, [leaf], { nth });
        }
      };
      if (before !== undefined) await previewBoth(before);

      const reveal = await page.hide();
      await previewBoth(whileHidden);
      await reveal();
      const expected = whileHidden ?? 'off';
      expect({
        component: shown('Hidden'),
        observer: page.observed.at(-1),
        actor: page.observedActor().getSnapshot().value,
      }).toEqual({ component: expected, observer: expected, actor: expected });
    },
  );
});

describe('a second copy of the package', () => {
  test('registers its machines with the page, so the overlay of the first copy lists and previews them', async () => {
    const machine = createToggleMachine('toggle');
    // Two bundles of an app can each include the package. The modules evaluate again, and nothing is replaced.
    vi.resetModules();
    const second = await import('state-viewer/xstate');
    function SecondCopy() {
      const [snapshot] = second.useMachine(machine, { debug: { label: 'Second copy' } });
      return <output aria-label="Second copy">{JSON.stringify(snapshot.value)}</output>;
    }
    render(
      <>
        <Instance machine={machine} label="First copy" />
        <SecondCopy />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

    await preview(machine.id, ['on'], { nth: 2 });
    expect({ instances: header().instance?.options, shown: [shown('First copy'), shown('Second copy')] }).toEqual({
      instances: ['First copy · 1', 'Second copy · 2 ●'],
      shown: ['off', 'on'],
    });
  });
});
