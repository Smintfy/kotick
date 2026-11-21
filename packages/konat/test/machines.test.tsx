import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { connect, defineFixtures, useActorRef, useMachine, type DebugOptions } from 'konat/xstate';
import { describe, expect, test, vi } from 'vitest';
import { createMachine, setup, type AnyActorRef, type AnyStateMachine } from 'xstate';
import { mount, page, start } from './support/app';
import { watchConsole } from './support/console';
import {
  badge,
  clickLeaf,
  flush,
  freshId,
  instanceKeys,
  instances,
  machines,
  marks,
  overlay,
  panel,
  preview,
  release,
  show,
  shownKey,
  shownMachine,
} from './support/panel';

function createToggleMachine(name: string) {
  return createMachine({
    id: freshId(name),
    initial: 'off',
    states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } },
  });
}

function createCheckoutMachine(id: string) {
  return createMachine({
    id,
    initial: 'paying',
    states: {
      paying: {
        type: 'parallel',
        states: {
          card: { initial: 'idle', states: { idle: {}, error: {} } },
          shipping: { initial: 'standard', states: { standard: {}, express: {} } },
        },
      },
    },
  });
}

type MachineConfig = Parameters<typeof createMachine>[0];

/** A fresh state name gives a fresh generated id, and so a fresh warning. */
function createFetchConfig(state: string) {
  const items: string[] = [];

  return {
    context: { items, error: '' },
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
  // SAFETY: The result has the entries of `states`, only in another order.
  return Object.fromEntries(Object.entries(states).reverse()) as T;
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

function machinePage() {
  return { machine: shownMachine(), instances: instances(), instance: panel().instance };
}

function family() {
  const states = [...overlay().querySelectorAll('section[aria-labelledby]')].find(
    (section) => section.querySelector('h3')?.textContent === 'States',
  );

  if (!states) throw new Error('The panel shows no States section.');

  return {
    hints: [...states.querySelectorAll('p[data-part="hint"]')].map((hint) => hint.textContent),
    children: [...states.querySelectorAll('[data-part="children"] button')].map((button) => button.textContent),
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
    `[konat] A machine has no id, so it's listed as "${id}". ` +
    'Give it one with createMachine({ id }) or with the debug option: { debug: { id } }.'
  );
}

test('lists each machine once, in registration order, and its instances as "machine · n"', async () => {
  // connect() registers an actor that runs outside React at once, before any component mounts.
  const app = createToggleMachine('app');
  connect(start(app));
  const checkout = createToggleMachine('checkout');
  const toggle = createToggleMachine('toggle');
  await mount(
    <>
      <Instance machine={checkout} />
      <Instance machine={toggle} />
      <Instance machine={toggle} label="Second toggle" />
    </>,
  );

  await show(app.id);
  const first = { ...machinePage(), machines: await machines() };
  await show(toggle.id);
  const toggles = machinePage();
  await preview(toggle.id, ['on'], { nth: 2 });
  const rows = [app.id, checkout.id];
  expect({
    first,
    toggles,
    previewed: { ...machinePage(), shown: [shown(toggle.id), shown('Second toggle')], machines: await machines() },
  }).toEqual({
    first: {
      machine: app.id,
      instances: [`${app.id} · 1`],
      instance: `${app.id} · 1`,
      machines: [...rows, `${toggle.id} · 2 instances`],
    },
    toggles: {
      machine: toggle.id,
      instances: [`${toggle.id} · 1`, 'Second toggle · 2'],
      instance: `${toggle.id} · 1`,
    },
    previewed: {
      machine: toggle.id,
      instances: [`${toggle.id} · 1`, 'Second toggle · 2 ●'],
      instance: 'Second toggle · 2',
      shown: ['off', 'on'],
      machines: [...rows, `${toggle.id} · 2 instances · previewing`],
    },
  });
});

test('rows come and go as their components mount and unmount, and keep the order they registered in', async () => {
  const machine = createToggleMachine('row');

  const rows = (labels: string[]) =>
    page(labels.map((label) => <Instance key={label} machine={machine} label={label} />));

  const view = render(rows(['B', 'C']));
  await flush();
  await show(machine.id);
  const seen = () => ({ previewing: badge(), instances: instances() });

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
    { previewing: '1', instances: ['B · 1 ●', 'C · 2', 'A · 3'] },
    { previewing: '', instances: ['C · 1', 'A · 2'] },
    { previewing: '', instances: [] },
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

  render(page(null));
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
    unmounted: { instances: instances(), keys: name(instanceKeys()) },
    recoverable,
  }).toEqual({
    previewed: { keys: ['key 1', 'key 2'], shown: ['on', 'off'] },
    hydrated: { keys: ['key 1', 'key 2', 'key 3'], shown: ['on', 'off', 'off'] },
    unmounted: { instances: ['A · 1 ●', 'C · 2'], keys: ['key 1', 'key 3'] },
    recoverable: [],
  });
});

test('a child machine opens from its parent read-only, and an instance of it that runs on its own previews', async () => {
  const fetcher = createMachine({ id: freshId('fetcher'), initial: 'loading', states: { loading: {}, failed: {} } });

  const parent = setup({ actors: { fetcher } }).createMachine({
    id: freshId('parent'),
    initial: 'active',
    states: { active: { invoke: { id: 'load', src: 'fetcher' } } },
  });

  await mount(
    <>
      <Instance machine={parent} />
      <Instance machine={fetcher} />
    </>,
  );

  await show(parent.id);
  const atParent = family();
  await clickButton('load · 1');
  const atChild = { ...machinePage(), family: family() };
  await clickLeaf('failed');
  const clicked = panel().previewed;
  await show(fetcher.id, 2);
  await clickLeaf('failed');
  // XState creates the invoked child with the parent's first snapshot, so it registers with the parent, first.
  expect({
    atParent,
    atChild,
    clicked,
    instances: instances(),
    shown: shown(fetcher.id),
    machines: await machines(),
  }).toEqual({
    atParent: { hints: [], children: ['load · 1'], readOnly: [] },
    atChild: {
      machine: fetcher.id,
      instances: ['load · 1', `${fetcher.id} · 2`],
      instance: 'load · 1',
      family: {
        hints: [`Child of ${parent.id} · 1. Child machines are listed read-only.`],
        children: [],
        readOnly: ['loading', 'failed'],
      },
    },
    clicked: [],
    instances: ['load · 1', `${fetcher.id} · 2 ●`],
    shown: 'failed',
    machines: [parent.id, `${fetcher.id} · 2 instances · previewing`],
  });
});

describe('editing a machine, as Fast Refresh does', () => {
  // @xstate/react starts a new actor for its new config, which registers in the place of the old one.
  test('keeps the preview, and each row in its place', async () => {
    const id = freshId('checkout');
    const toggle = createToggleMachine('toggle');

    const app = (machine: AnyStateMachine) => (
      <>
        <Instance machine={machine} label="First" />
        <Instance machine={machine} label="Second" />
        <Instance machine={toggle} />
      </>
    );

    const view = await mount(app(createCheckoutMachine(id)));
    await preview(id, ['paying.card.error']);

    view.rerender(page(app(createCheckoutMachine(id))));
    await flush();
    expect({
      previewing: badge(),
      instances: instances(),
      previewed: panel().previewed,
      shown: [shown('First'), shown('Second')],
      machines: await machines(),
    }).toEqual({
      previewing: '1',
      instances: ['First · 1 ●', 'Second · 2'],
      previewed: ['paying.card.error'],
      shown: [
        { paying: { card: 'error', shipping: 'standard' } },
        { paying: { card: 'idle', shipping: 'standard' } },
      ],
      machines: [`${id} · 2 instances · previewing`, toggle.id],
    });
  });
});

describe('machine ids', () => {
  test('a machine is listed under debug.id, else under its own id, else under an id made from its states, which warns once', async () => {
    const output = watchConsole();
    const named = createToggleMachine('named');
    const anonymous = createMachine(createFetchConfig(freshId('open')));
    // XState gives a machine without an id the id "(machine)", so a machine with that id has none of its own.
    const defaultId = createMachine({ ...createFetchConfig(freshId('open')), id: '(machine)' });
    const debugIds = [freshId('named-debug'), freshId('anonymous-debug')];
    await mount(
      <>
        <Instance machine={named} label="named, debug.id" debug={{ id: debugIds[0] }} />
        <Instance machine={anonymous} label="anonymous, debug.id" debug={{ id: debugIds[1] }} />
        <Instance machine={named} label="named, empty debug.id" debug={{ id: '' }} />
        <Instance machine={anonymous} label="anonymous, empty debug.id" debug={{ id: '' }} />
        <Instance machine={anonymous} label="anonymous" />
        <Instance machine={defaultId} label="(machine)" />
      </>,
    );

    const made = [anonymous, defaultId].map((machine) => defineFixtures(machine, {}).machineId);
    expect({ made, machines: await machines(), warnings: output.warn }).toEqual({
      made: [expect.stringMatching(MADE_ID), expect.stringMatching(MADE_ID)],
      machines: [...debugIds, named.id, `${made[0]} · 2 instances`, made[1]],
      warnings: made.map(madeIdWarning),
    });
  });

  test('a made id stays through edits of context values, transitions and state order, and changes with the states or the context keys', () => {
    const state = freshId('open');
    const idOf = (config: MachineConfig) => defineFixtures(createMachine(config), {}).machineId;
    const original = idOf(createFetchConfig(state));

    const edits = {
      'new context values': (config: FetchConfig) => ({ ...config, context: { items: ['cached'], error: 'Offline' } }),
      'a new transition': (config: FetchConfig) => ({
        ...config,
        states: { ...config.states, loading: { on: { DONE: 'done' } } },
      }),
      'the nested states in another order': (config: FetchConfig) => ({
        ...config,
        states: {
          ...config.states,
          failure: { ...config.states.failure, states: reversed(config.states.failure.states) },
        },
      }),
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
    } satisfies Record<string, (config: FetchConfig) => MachineConfig>;

    const edited = Object.fromEntries(
      Object.entries(edits).map(([edit, apply]) => [
        edit,
        idOf(apply(createFetchConfig(state))) === original ? 'same id' : 'new id',
      ]),
    );

    expect(edited).toEqual({
      'new context values': 'same id',
      'a new transition': 'same id',
      'the nested states in another order': 'same id',
      'a renamed state': 'new id',
      'a compound state made parallel': 'new id',
      'a final state made atomic': 'new id',
      'an added context key': 'new id',
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
      </>
    );

    const view = await mount(app('Before'));
    fireEvent.change(screen.getByLabelText('note'), { target: { value: 'typed before the new label' } });
    await preview(machine.id, ['on']);
    const key = shownKey();

    view.rerender(page(app('After')));
    await flush();

    const relabeled = {
      instances: instances(),
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
});

test('content that Suspense hides stays listed in its place, previewed and recording, while it is hidden', async () => {
  // Suspense hides content that it showed already when a sibling suspends outside a transition.
  // A lazy dialog can cause this.
  // The content stays mounted, and the actors that @xstate/react started keep running.
  const machine = createToggleMachine('lamp');
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
    return page(
      <>
        <React.Suspense fallback={<p>Loading the dialog</p>}>
          <Instance machine={machine} label="Hidden" />
          <ObservedLamp />
          {Dialog ? <Dialog /> : null}
        </React.Suspense>
        <Instance machine={machine} label="Outside" />
      </>,
    );
  }

  const view = render(<Page />);
  await flush();
  await preview(machine.id, ['on']);
  const before = marks();

  let load = () => {};

  const code = new Promise<{ default: React.ComponentType }>((resolve) => {
    load = () => resolve({ default: () => <p>Dialog</p> });
  });

  const Dialog = React.lazy(() => code);
  await act(async () => {
    view.rerender(<Page dialog={Dialog} />);
  });
  await flush();
  await act(async () => {
    observedActor?.send({ type: 'TOGGLE' });
  });
  const hidden = { fallback: screen.queryByText('Loading the dialog')?.textContent, instances: instances(), marks: marks() };

  await act(async () => {
    load();
    await code;
  });
  await flush();
  expect({
    before,
    hidden,
    revealed: { instances: instances(), shown: [shown('Hidden'), shown('Outside')], observed: observed.at(-1) },
  }).toEqual({
    before: { off: ['recorded'], on: ['none'] },
    hidden: {
      fallback: 'Loading the dialog',
      instances: ['Hidden · 1 ●', 'Observed · 2', 'Outside · 3'],
      marks: { off: ['recorded'], on: ['recorded'] },
    },
    revealed: { instances: ['Hidden · 1 ●', 'Observed · 2', 'Outside · 3'], shown: ['on', 'off'], observed: 'on' },
  });
});

test('a second copy of the package registers its machines with the page, so the overlay of the first copy lists and previews them', async () => {
  const machine = createToggleMachine('toggle');
  // Two bundles of an app can each include the package. The modules evaluate again, and nothing is replaced.
  vi.resetModules();
  const second = await import('konat/xstate');

  function SecondCopy() {
    const [snapshot] = second.useMachine(machine, { debug: { label: 'Second copy' } });

    return <output aria-label="Second copy">{JSON.stringify(snapshot.value)}</output>;
  }

  await mount(
    <>
      <Instance machine={machine} label="First copy" />
      <SecondCopy />
    </>,
  );

  await preview(machine.id, ['on'], { nth: 2 });
  expect({ instances: instances(), shown: [shown('First copy'), shown('Second copy')] }).toEqual({
    instances: ['First copy · 1', 'Second copy · 2 ●'],
    shown: ['off', 'on'],
  });
});
