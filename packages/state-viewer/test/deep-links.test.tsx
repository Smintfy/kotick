import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { StateViewer, type FixtureSet, type StateViewerProps } from 'state-viewer';
import { connect, defineFixtures, useActor, useActorRef, useMachine } from 'state-viewer/xstate';
import { describe, expect, test } from 'vitest';
import { createActor, createMachine, setup, type AnyStateMachine } from 'xstate';
import { watchConsole } from './support/console';
import { describeWithActivity } from './support/hooks';
import {
  blockedEvents,
  copy,
  flush,
  freshId,
  panel,
  preview,
  release,
  releaseAll,
  show,
  shownKey,
} from './support/panel';

type CheckoutContext = { note: string };

type CheckoutEvent = { type: 'FAIL' } | { type: 'EXPRESS' };

function createCheckoutMachine() {
  // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
  return setup({
    types: { context: {} as CheckoutContext, events: {} as CheckoutEvent },
  }).createMachine({
    id: freshId('checkout'),
    type: 'parallel',
    context: { note: 'live' },
    states: {
      payment: { initial: 'editing', states: { editing: { on: { FAIL: 'error' } }, error: {}, success: {} } },
      shipping: { initial: 'standard', on: { EXPRESS: '.express' }, states: { standard: {}, express: {} } },
    },
  });
}

type CartContext = { items: string[] };

type CartEvent = { type: 'ADD' };

function createCartMachine() {
  // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
  return setup({ types: { context: {} as CartContext, events: {} as CartEvent } }).createMachine({
    id: freshId('cart'),
    context: { items: ['apple'] },
    initial: 'filled',
    states: { empty: { on: { ADD: 'filled' } }, filled: {} },
  });
}

function createToggleMachine() {
  return createMachine({
    id: freshId('toggle'),
    initial: 'off',
    states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } },
  });
}

function createFetcherMachine() {
  return createMachine({ id: freshId('fetcher'), initial: 'loading', states: { loading: {}, failed: {} } });
}

function createParentMachine(fetcher: AnyStateMachine) {
  return setup({ actors: { fetcher } }).createMachine({
    id: freshId('parent'),
    initial: 'active',
    states: { active: { invoke: { src: 'fetcher' } } },
  });
}

function Instance({ machine, id, events = [] }: { machine: AnyStateMachine; id?: string; events?: string[] }) {
  const [snapshot, send] = useMachine(machine, id === undefined ? undefined : { debug: { id } });

  return (
    <div>
      <output>{JSON.stringify({ value: snapshot.value, context: snapshot.context })}</output>
      {events.map((type) => (
        <button key={type} type="button" onClick={() => send({ type })}>
          {type}
        </button>
      ))}
    </div>
  );
}

const LIVE = { value: { payment: 'editing', shipping: 'standard' }, context: { note: 'live' } };
const ERROR = { value: { payment: 'error', shipping: 'standard' }, context: { note: 'live' } };
const FILLED = { value: 'filled', context: { items: ['apple'] } };
const ON = { value: 'on', context: {} };
const OFF = { value: 'off', context: {} };

type StateConfig = { initial?: string; states?: Record<string, StateConfig> };

/**
 * Nested states for leaf ids such as 'a.b'.
 * Each compound state starts in 'start', so that a preview changes the value.
 */
function statesOf(leaves: readonly string[]): Record<string, StateConfig> {
  const children = new Map<string, string[]>();

  for (const leaf of leaves) {
    const [key = '', ...path] = leaf.split('.');
    const rest = children.get(key) ?? [];

    if (path.length > 0) rest.push(path.join('.'));
    children.set(key, rest);
  }

  return Object.fromEntries(
    [...children].map(([key, rest]) => [
      key,
      rest.length === 0 ? {} : { initial: 'start', states: { start: {}, ...statesOf(rest) } },
    ]),
  );
}

interface Linked {
  id: string;
  leaves: string[];
  machine: AnyStateMachine;
  fixtures: FixtureSet;
}

/**
 * A machine with all of `leaves` active at the same time.
 * Each leaf has a fixture, so that a preview of it does not warn.
 * The overlay shows the machine under a fresh id that starts with `name`.
 */
function linked(name: string, leaves: string[]): Linked {
  const machine =
    leaves.length === 1
      ? createMachine({
          id: freshId('machine'),
          context: { fixture: 'none' },
          initial: 'start',
          states: { start: {}, ...statesOf(leaves) },
        })
      : createMachine({
          id: freshId('machine'),
          context: { fixture: 'none' },
          type: 'parallel',
          states: statesOf(leaves),
        });

  const states = Object.fromEntries(leaves.map((leaf) => [leaf, { context: { fixture: leaf } }]));

  return { id: freshId(name), leaves, machine, fixtures: defineFixtures(machine, states) };
}

function appOf(machines: Linked[]): React.ReactNode {
  return machines.map(({ id, machine }) => <Instance key={id} machine={machine} id={id} />);
}

/**
 * Opens the page at `url` with the app and the overlay, as a page load does.
 * Returns a function that renders another app on the same page.
 */
async function visit(url: string, app: React.ReactNode, props: StateViewerProps = {}) {
  window.history.replaceState(null, '', url);

  const view = render(
    <>
      {app}
      <StateViewer defaultOpen {...props} />
    </>,
  );

  await flush();

  return async (next: React.ReactNode) => {
    view.rerender(
      <>
        {next}
        <StateViewer defaultOpen {...props} />
      </>,
    );
    await flush();
  };
}

/** Unmounts the page, then opens `url` with a new app, as a reload does. */
async function reload(url: string, machines: Linked[]): Promise<void> {
  cleanup();
  await visit(url, appOf(machines), { fixtures: machines.map((entry) => entry.fixtures) });
}

/** What each app component shows, in document order. */
function shown(): unknown[] {
  return screen.queryAllByRole('status').map((output) => JSON.parse(output.textContent ?? 'null'));
}

/** The previewed leaves of each machine's first instance, by machine id, as the panel shows them. */
async function previewed(machineIds: string[]): Promise<Record<string, unknown[]>> {
  const result: Record<string, unknown[]> = {};

  for (const id of machineIds) {
    await show(id);
    result[id] = panel().previewed;
  }

  return result;
}

/** Previews each machine's leaves in the panel, and copies a link to them. */
async function copyLinkTo(machines: Linked[]): Promise<string[]> {
  for (const { id, leaves } of machines) await preview(id, leaves);

  return (await copy('Copy link')).copied;
}

/**
 * The key of the nth instance of a machine.
 * Warnings name an instance by its key.
 */
async function keyOf(machineId: string, nth = 1): Promise<string> {
  await show(machineId, nth);

  return shownKey();
}

function liveWarning(leaves: string, key: string): string {
  return `[state-viewer] No recorded or fixture context for "${leaves}" on "${key}", so the preview uses the live context.`;
}

function linkWarning(message: string, param = 'debug-state'): string {
  return `[state-viewer] Deep link "${param}": ${message}`;
}

/** The warning under Copy link about machines whose instances a link can't reproduce. */
function linkFooterWarning(): string {
  const root = document.querySelector('[data-state-viewer-root]')?.shadowRoot;

  return root?.querySelector('footer [data-part="warning"]')?.textContent ?? '';
}

function partialWarning(machineId: string): string {
  return `Links preview every instance of a machine alike, so this one won’t reproduce the current “${machineId}” previews exactly.`;
}

test('a link in the URL previews its state when the page loads', async () => {
  const output = watchConsole();
  const machine = createCheckoutMachine();
  await visit(`/?debug-state=${machine.id}:payment.error`, <Instance machine={machine} />);

  await show(machine.id);
  expect({ shown: shown(), panel: panel(), warnings: output.warn }).toEqual({
    shown: [ERROR],
    panel: {
      instance: `${machine.id} · 1`,
      live: ['payment.editing', 'shipping.standard'],
      previewed: ['payment.error'],
      filled: ['shipping.standard'],
      source: 'live',
      context: ['note: "live"'],
      warning: 'No recording or fixture for this state, so the preview uses live context.',
    },
    warnings: [liveWarning('payment.error', shownKey())],
  });
});

type Mount = 'root.render()' | 'a transition' | 'flushSync';

declare global {
  /** While it is true, React warns about each update outside act(). Testing Library sets it to true. */
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/**
 * Mounts `app` in a new root with createRoot and without act, as an app starts.
 * Returns the text of its first output at the end of the task that commits the mount, where the browser paints.
 */
async function firstPaint(
  app: React.ReactNode,
  { mount = 'root.render()', strict = true }: { mount?: Mount; strict?: boolean } = {},
): Promise<string | null> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;

  try {
    return await new Promise<string | null>((resolve) => {
      function EndOfCommit() {
        React.useLayoutEffect(() => {
          queueMicrotask(() => resolve(container.querySelector('output')?.textContent ?? null));
        }, []);

        return null;
      }

      const Wrapper = strict ? React.StrictMode : React.Fragment;

      const page = (
        <Wrapper>
          {app}
          <EndOfCommit />
        </Wrapper>
      );

      if (mount === 'a transition') React.startTransition(() => root.render(page));
      else if (mount === 'flushSync') flushSync(() => root.render(page));
      else root.render(page);
    });
  } finally {
    root.unmount();
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

type ToggleMachine = ReturnType<typeof createToggleMachine>;

const HOOKS: [string, (props: { machine: ToggleMachine }) => React.ReactElement][] = [
  [
    'useMachine',
    function WithUseMachine({ machine }) {
      const [snapshot] = useMachine(machine);

      return <output>{String(snapshot.value)}</output>;
    },
  ],
  [
    'useActor',
    function WithUseActor({ machine }) {
      const [snapshot] = useActor(machine);

      return <output>{String(snapshot.value)}</output>;
    },
  ],
  [
    'an observer given to useActorRef',
    function WithObserver({ machine }) {
      const [value, setValue] = React.useState('unknown');
      useActorRef(machine, undefined, (snapshot) => setValue(String(snapshot.value)));

      return <output>{value}</output>;
    },
  ],
];

describe('the first paint', () => {
  // The overlay mounts its host with a state update in a layout effect.
  // Under StrictMode, React then runs all effects a second time before the paint, and the instance registers again.
  // That hides a link that comes too late, so only the test without StrictMode checks the timing.
  test.each([
    ['with', true],
    ['without', false],
  ])('an instance that mounts with the overlay shows the link, %s StrictMode', async (_, strict) => {
    const machine = createCheckoutMachine();
    window.history.replaceState(null, '', `/?debug-state=${machine.id}:payment.error;shipping.express`);

    const painted = await firstPaint(
      <>
        <Instance machine={machine} />
        <StateViewer />
      </>,
      { strict },
    );

    expect(JSON.parse(painted ?? 'null')).toEqual({
      value: { payment: 'error', shipping: 'express' },
      context: { note: 'live' },
    });
  });

  // The overlay applied the link before the instance mounts.
  // So the instance shows the preview when it registers, in a layout effect of its hook.
  describe.each<Mount>(['root.render()', 'a transition', 'flushSync'])('mounted after the overlay with %s', (mount) => {
    test.each(HOOKS)('%s shows the link', async (_, Component) => {
      const machine = createToggleMachine();
      await visit(`/?debug-state=${machine.id}:on`, null);

      expect(await firstPaint(<Component machine={machine} />, { mount })).toBe('on');
    });
  });
});

describe('the link format', () => {
  test('a link names several machines, and several leaves of one machine', async () => {
    const checkout = createCheckoutMachine();
    const cart = createCartMachine();
    await visit(
      `/?debug-state=${checkout.id}:payment.error;shipping.express,${cart.id}:empty`,
      <>
        <Instance machine={checkout} />
        <Instance machine={cart} />
      </>,
    );

    expect(shown()).toEqual([
      { value: { payment: 'error', shipping: 'express' }, context: { note: 'live' } },
      { value: 'empty', context: { items: ['apple'] } },
    ]);
  });

  test("a '+' reads as a space, as in a form-encoded query", async () => {
    const machine = linked('my machine', ['a b']);
    await visit(`/?debug-state=${machine.id.replace(' ', '+')}:a+b`, appOf([machine]), {
      fixtures: [machine.fixtures],
    });

    expect(await previewed([machine.id])).toEqual({ [machine.id]: ['a b'] });
  });

  test('a segment splits at its first colon, so a leaf may hold a colon', async () => {
    const machine = linked('checkout', ['a:b']);
    await visit(`/?debug-state=${machine.id}:a:b`, appOf([machine]), { fixtures: [machine.fixtures] });

    expect(await previewed([machine.id])).toEqual({ [machine.id]: ['a:b'] });
  });

  test("a value may hold '=', and an escaped machine id reads as the id", async () => {
    const machine = linked('a=b', ['x=y']);
    await visit(`/?debug-state=${encodeURIComponent(machine.id)}:x=y`, appOf([machine]), {
      fixtures: [machine.fixtures],
    });

    expect(await previewed([machine.id])).toEqual({ [machine.id]: ['x=y'] });
  });

  test('a leaf named twice previews once, and keeps the place where it first appears', async () => {
    const ordered = linked('ordered', ['a.on', 'b.on', 'c.on']);
    const escaped = linked('escaped', ['a.on']);
    const machines = [ordered, escaped];
    await visit(
      `/?debug-state=${ordered.id}:b.on;a.on;b.on;c.on;a.on,${escaped.id}:a.on;a%2Eon`,
      appOf(machines),
      { fixtures: machines.map((machine) => machine.fixtures) },
    );

    expect({
      previewed: await previewed([ordered.id, escaped.id]),
      copied: (await copy('Copy link')).copied,
    }).toEqual({
      previewed: { [ordered.id]: ['a.on', 'b.on', 'c.on'], [escaped.id]: ['a.on'] },
      copied: [`http://localhost:3000/?debug-state=${ordered.id}:b.on;a.on;c.on,${escaped.id}:a.on`],
    });
  });
});

// The value of the param, for a checkout machine and a cart machine with these ids.
type Value = (checkout: string, cart: string) => string;

const MALFORMED: [string, Value, [string[], string[]], (checkout: string) => string[]][] = [
  ['an empty value', () => '', [[], []], () => []],
  ['only commas', () => ',,,', [[], []], () => []],
  ['trailing and double commas', (c, k) => `${k}:empty,,${c}:payment.error,`, [['payment.error'], ['empty']], () => []],
  [
    'empty leaves between good ones',
    (c) => `${c}:;payment.error;;shipping.express;`,
    [['payment.error', 'shipping.express'], []],
    () => [],
  ],
  [
    'a segment without a colon',
    (c, k) => `${c},${k}:empty`,
    [[], ['empty']],
    (c) => [`Skipped "${c}": expected <machineId>:<leaf>.`],
  ],
  [
    'an empty machine id',
    (_, k) => `:payment.error,${k}:empty`,
    [[], ['empty']],
    () => ['Skipped ":payment.error": the machine id is empty.'],
  ],
  [
    'a segment with no leaves',
    (c, k) => `${c}:,${k}:empty`,
    [[], ['empty']],
    (c) => [`Skipped "${c}:": no leaves after the machine id.`],
  ],
  [
    'a segment with only empty leaves',
    (c, k) => `${c}:;;,${k}:empty`,
    [[], ['empty']],
    (c) => [`Skipped "${c}:;;": no leaves after the machine id.`],
  ],
  [
    'a bad escape in a leaf',
    (c, k) => `${c}:%E0%A4%A,${k}:empty`,
    [[], ['empty']],
    (c) => [`Skipped "${c}:%E0%A4%A": invalid percent-encoding.`],
  ],
  [
    'a bad escape in a machine id',
    (_, k) => `%E0%A4%A:idle,${k}:empty`,
    [[], ['empty']],
    () => ['Skipped "%E0%A4%A:idle": invalid percent-encoding.'],
  ],
  ['a bad escape without a colon', () => '%E0%A4%A', [[], []], () => ['Ignored "%E0%A4%A": invalid percent-encoding.']],
  [
    'several bad segments',
    (_, k) => `x,${k}:empty,:y`,
    [[], ['empty']],
    () => ['Skipped "x": expected <machineId>:<leaf>.', 'Skipped ":y": the machine id is empty.'],
  ],
  [
    'a machine named twice, where the later segment wins',
    (c, k) => `${c}:payment.error,${k}:empty,${c}:payment.success`,
    [['payment.success'], ['empty']],
    (c) => [`Skipped "${c}:payment.error": machine "${c}" appears again in "${c}:payment.success", which wins.`],
  ],
  [
    // %63 is "c", the first letter of the checkout id.
    'a machine named twice, once with an escape',
    (c) => `${c}:payment.error,%63${c.slice(1)}:payment.success`,
    [['payment.success'], []],
    (c) => [
      `Skipped "${c}:payment.error": machine "${c}" appears again in "%63${c.slice(1)}:payment.success", which wins.`,
    ],
  ],
  [
    'a machine named twice, where the later segment has no leaves',
    (c) => `${c}:payment.error,${c}:`,
    [['payment.error'], []],
    (c) => [`Skipped "${c}:": no leaves after the machine id.`],
  ],
  ['a lone %', () => '%', [[], []], () => ['Ignored "%": invalid percent-encoding.']],
  ['a lone colon', () => ':', [[], []], () => ['Skipped ":": the machine id is empty.']],
  ['two colons', () => '::', [[], []], () => ['Skipped "::": the machine id is empty.']],
  ['a lone semicolon', () => ';', [[], []], () => ['Skipped ";": expected <machineId>:<leaf>.']],
  ['a colon between commas', () => ',:,', [[], []], () => ['Skipped ":": the machine id is empty.']],
  ['a % on each side of the colon', () => '%:%', [[], []], () => ['Skipped "%:%": invalid percent-encoding.']],
  ['a bad escape before the colon', () => '%ZZ:a', [[], []], () => ['Skipped "%ZZ:a": invalid percent-encoding.']],
  ['a bad escape after the colon', () => 'a:%ZZ', [[], []], () => ['Skipped "a:%ZZ": invalid percent-encoding.']],
  ['a % after the colon', () => 'a:%', [[], []], () => ['Skipped "a:%": invalid percent-encoding.']],
  // The URL replaces a lone surrogate with U+FFFD.
  ['a lone surrogate', () => '\uD800', [[], []], () => ['Skipped "\uFFFD": expected <machineId>:<leaf>.']],
];

describe('malformed links', () => {
  test.each(MALFORMED)('with %s, previews what it can and warns about the rest', async (_, value, leaves, errors) => {
    const output = watchConsole();
    const checkout = createCheckoutMachine();
    const cart = createCartMachine();
    await visit(
      `/?debug-state=${value(checkout.id, cart.id)}`,
      <>
        <Instance machine={checkout} />
        <Instance machine={cart} />
      </>,
    );

    const live: string[] = [];

    for (const [index, id] of [checkout.id, cart.id].entries()) {
      if (leaves[index].length > 0) live.push(liveWarning(leaves[index].join(', '), await keyOf(id)));
    }

    expect({
      previewed: await previewed([checkout.id, cart.id]),
      warnings: output.warn,
      errors: output.error,
    }).toEqual({
      previewed: { [checkout.id]: leaves[0], [cart.id]: leaves[1] },
      warnings: [...errors(checkout.id).map((error) => linkWarning(error)), ...live],
      errors: [],
    });
  });
});

describe('where the link sits in the query', () => {
  test.each<[string, (checkout: string) => string, StateViewerProps, string[]]>([
    ['among other params', (c) => `?a=1&debug-state=${c}:payment.error&b=2`, {}, ['payment.error']],
    ['that is missing', () => '?a=1&b=2', {}, []],
    ['without =', () => '?debug-state&a=1', {}, []],
    ['that is empty', () => '?debug-state=&a=1', {}, []],
    ['under an escaped name', (c) => `?debug%2Dstate=${c}:payment.error`, {}, ['payment.error']],
    [
      'twice, where the first one counts',
      (c) => `?debug-state=${c}:payment.error&debug-state=${c}:payment.success`,
      {},
      ['payment.error'],
    ],
    ['after a name that is a bad escape', (c) => `?%E0%A4%A=1&debug-state=${c}:payment.error`, {}, ['payment.error']],
    [
      'under the urlParam prop',
      (c) => `?debug-state=${c}:payment.success&state=${c}:payment.error`,
      { urlParam: 'state' },
      ['payment.error'],
    ],
    [
      "under a urlParam with a space, written as '+'",
      (c) => `?my+state=${c}:payment.error`,
      { urlParam: 'my state' },
      ['payment.error'],
    ],
  ])('reads a link %s', async (_, search, props, leaves) => {
    const output = watchConsole();
    const machine = createCheckoutMachine();
    await visit(`/${search(machine.id)}`, <Instance machine={machine} />, props);

    await show(machine.id);
    expect({ previewed: panel().previewed, warnings: output.warn }).toEqual({
      previewed: leaves,
      warnings: leaves.length === 0 ? [] : [liveWarning(leaves.join(', '), shownKey())],
    });
  });

  test('a link to the live state still previews it, so it blocks events', async () => {
    const machine = createToggleMachine();
    await visit(
      `/?debug-state=${machine.id}:on&state=${machine.id}:off`,
      <Instance machine={machine} events={['TOGGLE']} />,
      { urlParam: 'state' },
    );
    fireEvent.click(screen.getByRole('button', { name: 'TOGGLE' }));
    await flush();

    await show(machine.id);
    expect({ shown: shown(), previewed: panel().previewed }).toEqual({ shown: [OFF], previewed: ['off'] });
  });
});

describe('instances', () => {
  test('a link previews every instance of its machine and no other, and warns for the first one only', async () => {
    const output = watchConsole();
    const checkout = createCheckoutMachine();
    const cart = createCartMachine();
    await visit(
      `/?debug-state=${checkout.id}:payment.error`,
      <>
        <Instance machine={checkout} />
        <Instance machine={checkout} />
        <Instance machine={cart} />
      </>,
    );

    expect({ shown: shown(), warnings: output.warn }).toEqual({
      shown: [ERROR, ERROR, FILLED],
      warnings: [liveWarning('payment.error', await keyOf(checkout.id))],
    });
  });

  test('a link previews an actor that registered before the overlay mounted, such as a connect()ed one', async () => {
    const machine = createToggleMachine();
    const actor = connect(createActor(machine).start());
    await visit(`/?other=1&debug-state=${machine.id}:on`, null);

    await show(machine.id);
    const result = { value: actor.getSnapshot().value, previewed: panel().previewed };
    actor.stop();
    expect(result).toEqual({ value: 'on', previewed: ['on'] });
  });

  test('a link previews an instance that mounted before the overlay, without a React error', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine();
    window.history.replaceState(null, '', `/?debug-state=${machine.id}:payment.error`);

    const view = render(
      <>
        <Instance machine={machine} />
        {null}
      </>,
    );

    await flush();
    view.rerender(
      <>
        <Instance machine={machine} />
        <StateViewer />
      </>,
    );
    await flush();

    expect({ shown: shown(), errors: output.error }).toEqual({ shown: [ERROR], errors: [] });
  });

  test('a link skips child machines, which only their parent runs, without a warning', async () => {
    const output = watchConsole();
    const fetcher = createFetcherMachine();
    await visit(`/?debug-state=${fetcher.id}:failed`, <Instance machine={createParentMachine(fetcher)} />);

    await show(fetcher.id);
    expect({ live: panel().live, previewed: panel().previewed, warnings: output.warn }).toEqual({
      live: ['loading'],
      previewed: [],
      warnings: [],
    });
  });

  test('a leaf the machine lacks drops out of the link with one warning for all instances', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine();
    await visit(
      `/?debug-state=${machine.id}:payment.error;nope`,
      <>
        <Instance machine={machine} />
        <Instance machine={machine} />
        <Instance machine={machine} />
      </>,
    );

    const key = await keyOf(machine.id);
    expect({ shown: shown(), warnings: output.warn }).toEqual({
      shown: [ERROR, ERROR, ERROR],
      warnings: [
        `[state-viewer] Ignoring "nope" in the preview of "${key}": not a leaf state of "${machine.id}".`,
        liveWarning('payment.error', key),
      ],
    });
  });

  test('a link with no leaf of the machine previews nothing, with one warning for all instances', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine();
    await visit(
      `/?debug-state=${machine.id}:nope`,
      <>
        <Instance machine={machine} />
        <Instance machine={machine} />
      </>,
    );

    expect({ shown: shown(), warnings: output.warn }).toEqual({
      shown: [LIVE, LIVE],
      warnings: [
        `[state-viewer] Can't preview "${await keyOf(machine.id)}": "nope" is not a leaf state of "${machine.id}".`,
      ],
    });
  });
});

describe('when the link ends', () => {
  test('a preview the developer picks ends the link of that machine only', async () => {
    const checkout = createCheckoutMachine();
    const toggle = createToggleMachine();

    const update = await visit(
      `/?debug-state=${checkout.id}:payment.error,${toggle.id}:on`,
      <>
        <Instance key="1" machine={checkout} />
      </>,
    );

    await preview(checkout.id, ['shipping.express']);

    await update(
      <>
        <Instance key="1" machine={checkout} />
        <Instance key="2" machine={checkout} />
        <Instance key="3" machine={toggle} />
      </>,
    );
    expect(shown()).toEqual([
      { value: { payment: 'editing', shipping: 'express' }, context: { note: 'live' } },
      LIVE,
      ON,
    ]);
  });

  test('Release ends the link, so instances that mount later show their own state', async () => {
    const machine = createCheckoutMachine();

    const update = await visit(
      `/?debug-state=${machine.id}:payment.error`,
      <>
        <Instance key="1" machine={machine} />
      </>,
    );

    await release(machine.id);

    await update(
      <>
        <Instance key="1" machine={machine} />
        <Instance key="2" machine={machine} />
      </>,
    );
    expect(shown()).toEqual([LIVE, LIVE]);
  });

  test('Release all ends every link', async () => {
    const checkout = createCheckoutMachine();
    const toggle = createToggleMachine();

    const update = await visit(
      `/?debug-state=${checkout.id}:payment.error,${toggle.id}:on`,
      <>
        <Instance key="1" machine={checkout} />
      </>,
    );

    await releaseAll();

    await update(
      <>
        <Instance key="1" machine={checkout} />
        <Instance key="2" machine={checkout} />
        <Instance key="3" machine={toggle} />
      </>,
    );
    expect(shown()).toEqual([LIVE, LIVE, OFF]);
  });

  test('the overlay doesn’t apply the link again when it remounts after the developer released it', async () => {
    const machine = createToggleMachine();
    window.history.replaceState(null, '', `/?debug-state=${machine.id}:on`);

    const view = render(
      <>
        <Instance machine={machine} />
        <StateViewer key="a" defaultOpen />
      </>,
    );

    await flush();
    const linked = shown();
    await release(machine.id);

    view.rerender(
      <>
        <Instance machine={machine} />
        <StateViewer key="b" defaultOpen />
      </>,
    );
    await flush();
    expect({ linked, remounted: shown() }).toEqual({ linked: [ON], remounted: [OFF] });
  });

  test('an instance that unmounts leaves the link, so the next one to mount shows it', async () => {
    const machine = createCheckoutMachine();

    const update = await visit(
      `/?debug-state=${machine.id}:payment.error`,
      <>
        <Instance key="1" machine={machine} />
      </>,
    );

    await update(<></>);

    await update(
      <>
        <Instance key="2" machine={machine} />
      </>,
    );
    expect(shown()).toEqual([ERROR]);
  });

  test('a link from a later URL replaces the earlier one for the instances that mount after it', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine();
    window.history.replaceState(null, '', `/?debug-state=${machine.id}:payment.error`);

    const view = render(
      <>
        <Instance key="1" machine={machine} />
        <StateViewer key="a" defaultOpen />
      </>,
    );

    await flush();

    window.history.replaceState(null, '', `/?debug-state=${machine.id}:shipping.express`);
    view.rerender(
      <>
        <Instance key="1" machine={machine} />
        <Instance key="2" machine={machine} />
        <StateViewer key="b" defaultOpen />
      </>,
    );
    await flush();
    expect({ shown: shown(), warnings: output.warn }).toEqual({
      shown: [ERROR, { value: { payment: 'editing', shipping: 'express' }, context: { note: 'live' } }],
      warnings: [
        liveWarning('payment.error', await keyOf(machine.id, 1)),
        liveWarning('shipping.express', await keyOf(machine.id, 2)),
      ],
    });
  });

  // A hidden <Activity> unmounts the effects of its components.
  // So the instance unregisters until the Activity shows it again.
  describeWithActivity('in an <Activity>', () => {
    test('an instance that the Activity hides and reveals again shows the link again', async () => {
      const machine = createCheckoutMachine();

      const app = (mode: 'visible' | 'hidden') => (
        <React.Activity mode={mode}>
          <Instance machine={machine} />
        </React.Activity>
      );

      const update = await visit(`/?debug-state=${machine.id}:payment.error`, app('visible'));
      const visible = shown();

      await update(app('hidden'));
      const hidden = shown();
      await update(app('visible'));
      expect({ visible, hidden, revealed: shown() }).toEqual({ visible: [ERROR], hidden: [], revealed: [ERROR] });
    });
  });
});

describe('fixtures and recordings', () => {
  test('fixtures that load after the link move its previews to them, so nothing warns', async () => {
    const output = watchConsole();
    const machine = createCheckoutMachine();
    const fixtures = async () => [defineFixtures(machine, { 'payment.error': { context: { note: 'declined' } } })];
    await visit(`/?debug-state=${machine.id}:payment.error`, <Instance machine={machine} />, { fixtures });

    await show(machine.id);
    expect({ shown: shown(), source: panel().source, warnings: output.warn }).toEqual({
      shown: [{ value: { payment: 'error', shipping: 'standard' }, context: { note: 'declined' } }],
      source: 'fixture',
      warnings: [],
    });
  });

  test('a link previews each instance with a fixture or a recording, as a preview from the panel does', async () => {
    const output = watchConsole();
    const checkout = createCheckoutMachine();
    // The overlay lists the checkout under its debug.id, and its fixtures still match it.
    const checkoutId = freshId('checkout-v2');
    const cart = createCartMachine();
    const at = Date.now();
    sessionStorage.setItem(
      `state-viewer:recorded:${cart.id}`,
      JSON.stringify({ v: 1, entries: [{ leaves: ['empty'], at, context: { items: [] } }] }),
    );
    await visit(
      `/?tab=2&debug-state=${checkoutId}:payment.error;shipping.express,${cart.id}:empty`,
      <>
        <Instance machine={checkout} id={checkoutId} />
        <Instance machine={checkout} id={checkoutId} />
        <Instance machine={cart} events={['ADD']} />
      </>,
      { fixtures: [defineFixtures(checkout, { 'payment.error': { context: { note: 'declined' } } })] },
    );
    const linked = shown();

    fireEvent.click(screen.getByRole('button', { name: 'ADD' }));
    await flush();
    await releaseAll();
    await show(cart.id);
    expect({ linked, released: shown(), newestBlocked: blockedEvents()[0], warnings: output.warn }).toEqual({
      linked: [
        { value: { payment: 'error', shipping: 'express' }, context: { note: 'declined' } },
        { value: { payment: 'error', shipping: 'express' }, context: { note: 'declined' } },
        { value: 'empty', context: { items: [] } },
      ],
      released: [LIVE, LIVE, FILLED],
      newestBlocked: `ADD · ${cart.id} · 1 · in empty`,
      warnings: [],
    });
  });
});

describe('Copy link', () => {
  test('copies the page URL with a link to each previewed machine, and warns when its instances differ', async () => {
    const checkout = createCheckoutMachine();
    const toggle = createToggleMachine();
    await visit(
      '/',
      <>
        <Instance machine={checkout} />
        <Instance machine={toggle} />
        <Instance machine={toggle} />
      </>,
    );
    window.history.replaceState(null, '', '/shop?tab=1#top');
    await show(checkout.id);
    const nothingPreviewed = await copy('Copy link');

    await preview(checkout.id, ['shipping.express', 'payment.error']);
    await preview(toggle.id, ['on'], { nth: 2 });
    expect({ nothingPreviewed, copied: await copy('Copy link'), warning: linkFooterWarning() }).toEqual({
      nothingPreviewed: { copied: [], status: '' },
      copied: {
        copied: [
          `http://localhost:3000/shop?tab=1&debug-state=${checkout.id}:shipping.express;payment.error,${toggle.id}:on#top`,
        ],
        status: 'Copy failed',
      },
      warning: partialWarning(toggle.id),
    });
  });

  test('the link holds the leaves the developer picked, not the filled-in ones, once per machine', async () => {
    const checkout = createCheckoutMachine();
    const toggle = createToggleMachine();
    await visit(
      '/',
      <>
        <Instance machine={checkout} />
        <Instance machine={toggle} />
        <Instance machine={toggle} />
        <Instance machine={createCartMachine()} />
      </>,
    );
    await preview(checkout.id, ['payment.error']);
    await preview(toggle.id, ['on']);
    await preview(toggle.id, ['on'], { nth: 2 });

    expect({ copied: (await copy('Copy link')).copied, warning: linkFooterWarning() }).toEqual({
      copied: [`http://localhost:3000/?debug-state=${checkout.id}:payment.error,${toggle.id}:on`],
      warning: '',
    });
  });

  test('of instances previewed differently, the link takes the shown one, or else the first to register', async () => {
    const checkout = createCheckoutMachine();
    const cart = createCartMachine();
    await visit(
      '/',
      <>
        <Instance machine={checkout} />
        <Instance machine={checkout} />
        <Instance machine={cart} />
      </>,
    );
    await preview(checkout.id, ['payment.error']);
    await preview(checkout.id, ['shipping.express'], { nth: 2 });
    const second = (await copy('Copy link')).copied;
    await show(cart.id);

    expect({ second, first: (await copy('Copy link')).copied, warning: linkFooterWarning() }).toEqual({
      second: [`http://localhost:3000/?debug-state=${checkout.id}:shipping.express`],
      first: [`http://localhost:3000/?debug-state=${checkout.id}:payment.error`],
      warning: partialWarning(checkout.id),
    });
  });

  test('the link lists machines in the order they registered, not the order they were previewed in', async () => {
    const checkout = createCheckoutMachine();
    const cart = createCartMachine();
    await visit(
      '/',
      <>
        <Instance machine={cart} />
        <Instance machine={checkout} />
      </>,
    );
    await preview(checkout.id, ['payment.error']);
    await preview(cart.id, ['empty']);

    expect((await copy('Copy link')).copied).toEqual([
      `http://localhost:3000/?debug-state=${cart.id}:empty,${checkout.id}:payment.error`,
    ]);
  });

  test('child machines, which a link can’t preview, don’t count as instances that differ', async () => {
    const fetcher = createFetcherMachine();
    await visit(
      '/',
      <>
        <Instance machine={fetcher} />
        <Instance machine={createParentMachine(fetcher)} />
      </>,
    );
    await preview(fetcher.id, ['failed']);

    expect({ copied: (await copy('Copy link')).copied, warning: linkFooterWarning() }).toEqual({
      copied: [`http://localhost:3000/?debug-state=${fetcher.id}:failed`],
      warning: '',
    });
  });

  // Copy link escapes ids as encodeURIComponent does, which keeps dots, parentheses and !'*~-_ readable.
  test.each([
    ['payment.error', 'payment.error'],
    ['(machine)', '(machine)'],
    ["it's!~*-_", "it's!~*-_"],
    ['a:b;c,d', 'a%3Ab%3Bc%2Cd'],
    ['50% & #1', '50%25%20%26%20%231'],
    ['x+y=z/?', 'x%2By%3Dz%2F%3F'],
    ['é🚀', '%C3%A9%F0%9F%9A%80'],
  ])('writes the id %j as %s, and a page reads it back', async (name, escaped) => {
    const machine = linked(name, [name]);
    // The machine id is the name and a suffix such as "-12", which needs no escape.
    const link = `debug-state=${escaped}${machine.id.slice(name.length)}:${escaped}`;
    await visit(`/?${link}`, appOf([machine]), { fixtures: [machine.fixtures] });

    expect({ previewed: await previewed([machine.id]), copied: (await copy('Copy link')).copied }).toEqual({
      previewed: { [machine.id]: [name] },
      copied: [`http://localhost:3000/?${link}`],
    });
  });

  test.each<[string, string, (link: string) => string]>([
    ['no query', '/', (link) => `?${link}`],
    ['a bare ?', '/?', (link) => `?${link}`],
    ['other params', '/?a=1&b=2', (link) => `?a=1&b=2&${link}`],
    ['an earlier link, which it replaces in place', '/?a=1&debug-state=cart:empty&b=2', (link) => `?a=1&${link}&b=2`],
    ['the param without =', '/?a=1&debug-state&b=2', (link) => `?a=1&${link}&b=2`],
    ['the param under an escaped name', '/?a=1&debug%2Dstate=cart:empty', (link) => `?a=1&${link}`],
    ['the param twice', '/?debug-state=cart:empty&a=1&debug-state=x:y', (link) => `?${link}&a=1`],
    ['empty pairs, which it drops', '/?&a=1&&b=2&', (link) => `?a=1&b=2&${link}`],
    [
      'params in any encoding, which it keeps byte for byte',
      '/?q=a%20b+c&tag=x&tag=y&empty=&flag&enc=%E2%9C%93&debug-state=cart:empty&raw=50%&%E0%A4%A=1&x=a:b;c,d&tag=z',
      (link) => `?q=a%20b+c&tag=x&tag=y&empty=&flag&enc=%E2%9C%93&${link}&raw=50%&%E0%A4%A=1&x=a:b;c,d&tag=z`,
    ],
  ])('on a page with %s, sets the param in the page’s query', async (_, page, query) => {
    const machine = createToggleMachine();
    await visit('/', <Instance machine={machine} />);
    window.history.replaceState(null, '', page);
    await preview(machine.id, ['on']);

    expect((await copy('Copy link')).copied).toEqual([
      `http://localhost:3000/${query(`debug-state=${machine.id}:on`)}`,
    ]);
  });

  test('writes the urlParam prop, and a page that opens the link with the same prop previews it', async () => {
    const machine = createToggleMachine();
    await visit('/', <Instance machine={machine} />, { urlParam: 'my state' });
    window.history.replaceState(null, '', '/?debug-state=cart:empty&my+state=x:y');
    await preview(machine.id, ['on']);
    const { copied } = await copy('Copy link');

    cleanup();
    await visit(copied[0] ?? '', <Instance machine={machine} />, { urlParam: 'my state' });
    expect({ copied, shown: shown() }).toEqual({
      copied: [`http://localhost:3000/?debug-state=cart:empty&my%20state=${machine.id}:on`],
      shown: [ON],
    });
  });
});

/** What a router does to change one param: it parses the query, sets the param and serializes every pair again. */
function rebuildQuery(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('page', '2');

  return parsed.href;
}

/** The raw value of the link param in a URL that Copy link copied. */
function linkValue(url: string): string {
  return url.slice(url.indexOf('debug-state=') + 'debug-state='.length).split(/[&#]/)[0] ?? '';
}

// Ids that collide with the separators, with URL syntax or with decoding.
// A second decode would read '%41' as 'A'.
// The panel helpers find a leaf with a CSS selector, and jsdom selectors do not match characters outside the BMP.
// So only the machine ids have emoji.
const AWKWARD: [string, string[]][] = [
  ['a:b;c,d', ['x:y', 'p;q', 'r,s']],
  ['100%', ['50%.done', '%41']],
  ['a&b#c', ['x+y', 'k=v']],
  ['with space', ['a/b?c', ' padded ']],
  ['café🚀', ['crème.brûlée', '☃.launch']],
  ['(machine)', ['(machine).idle']],
  ["it's!~*", ['done']],
];

describe('round trips', () => {
  test('a link stays readable in the address bar, and Copy link writes it back', async () => {
    const checkout = createCheckoutMachine();
    const cart = createCartMachine();
    const link = `debug-state=${checkout.id}:payment.error;shipping.express,${cart.id}:empty`;
    await visit(
      `/?${link}`,
      <>
        <Instance machine={checkout} />
        <Instance machine={cart} />
      </>,
    );

    await show(checkout.id);
    expect({ search: window.location.search, copied: (await copy('Copy link')).copied }).toEqual({
      search: `?${link}`,
      copied: [`http://localhost:3000/?${link}`],
    });
  });

  test('ids with any character survive Copy link, the browser’s URL parser and a reload', async () => {
    const machines = AWKWARD.map(([name, leaves]) => linked(name, leaves));
    await visit('/page?page=2#hash', appOf(machines), { fixtures: machines.map((machine) => machine.fixtures) });
    const copied = await copyLinkTo(machines);

    await reload(copied[0] ?? '', machines);
    const ids = machines.map((machine) => machine.id);
    expect({
      page: new URL(window.location.href).searchParams.get('page'),
      hash: window.location.hash,
      previewed: await previewed(ids),
    }).toEqual({
      page: '2',
      hash: '#hash',
      previewed: Object.fromEntries(machines.map((machine) => [machine.id, machine.leaves])),
    });
  });

  test("a '+' in an id survives the round trip, escaped as %2B", async () => {
    const machine = linked('a+b', ['c+d']);
    await visit('/', appOf([machine]), { fixtures: [machine.fixtures] });
    const copied = await copyLinkTo([machine]);

    await reload(copied[0] ?? '', [machine]);
    expect({ copied, previewed: await previewed([machine.id]) }).toEqual({
      copied: [`http://localhost:3000/?debug-state=a%2Bb${machine.id.slice('a+b'.length)}:c%2Bd`],
      previewed: { [machine.id]: ['c+d'] },
    });
  });

  test('after a reload, a copied link previews the same leaves, and other regions follow the instance', async () => {
    const machine = createCheckoutMachine();

    const fixtures = [
      defineFixtures(machine, {
        'payment.editing': { context: { note: 'editing' } },
        'shipping.express': { context: { note: 'express' } },
      }),
    ];

    await visit('/', <Instance machine={machine} events={['FAIL']} />, { fixtures });
    await preview(machine.id, ['shipping.express']);
    const previewing = shown();
    const { copied } = await copy('Copy link');

    // After the reload, the payment fails before the overlay mounts.
    // So the link previews an instance in payment.error.
    cleanup();
    window.history.replaceState(null, '', copied[0] ?? '');

    const view = render(
      <>
        <Instance machine={machine} events={['FAIL']} />
        {null}
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'FAIL' }));
    view.rerender(
      <>
        <Instance machine={machine} events={['FAIL']} />
        <StateViewer fixtures={fixtures} />
      </>,
    );
    await flush();
    expect({ previewing, copied, reloaded: shown() }).toEqual({
      previewing: [{ value: { payment: 'editing', shipping: 'express' }, context: { note: 'express' } }],
      copied: [`http://localhost:3000/?debug-state=${machine.id}:shipping.express`],
      reloaded: [{ value: { payment: 'error', shipping: 'express' }, context: { note: 'express' } }],
    });
  });
});

// App code that gives a link to URLSearchParams.set() escapes it again.
// A router that rebuilds the query decodes the value, then escapes it again.
// Both escape ':', so the overlay decodes a value without ':' one time.
describe('links that an app or a router escaped again', () => {
  test('URLSearchParams.set() with a copied link of ids with any character', async () => {
    const machines = AWKWARD.map(([name, leaves]) => linked(name, leaves));
    await visit('/', appOf(machines), { fixtures: machines.map((machine) => machine.fixtures) });
    const copied = await copyLinkTo(machines);

    const params = new URLSearchParams('a=1');
    params.set('debug-state', linkValue(copied[0] ?? ''));
    await reload(`/?${params}`, machines);
    expect({
      hasColon: window.location.search.includes(':'),
      previewed: await previewed(machines.map((machine) => machine.id)),
    }).toEqual({
      hasColon: false,
      previewed: Object.fromEntries(machines.map((machine) => [machine.id, machine.leaves])),
    });
  });

  test('URLSearchParams.set() with a link written by hand', async () => {
    const checkout = createCheckoutMachine();
    const spaced = linked('my machine', ['idle']);
    const params = new URLSearchParams();
    params.set('debug-state', `${checkout.id}:payment.error;shipping.express,${spaced.id}:idle`);
    await visit(
      `/?${params}`,
      <>
        <Instance machine={checkout} />
        {appOf([spaced])}
      </>,
      { fixtures: [spaced.fixtures] },
    );

    expect({ search: window.location.search, previewed: await previewed([checkout.id, spaced.id]) }).toEqual({
      search: `?debug-state=${checkout.id}%3Apayment.error%3Bshipping.express%2C${spaced.id.replace(' ', '+')}%3Aidle`,
      previewed: { [checkout.id]: ['payment.error', 'shipping.express'], [spaced.id]: ['idle'] },
    });
  });

  test('a router that rebuilt the query', async () => {
    const checkout = createCheckoutMachine();
    const cart = createCartMachine();

    const app = (
      <>
        <Instance machine={checkout} />
        <Instance machine={cart} />
      </>
    );

    await visit('/', app);
    window.history.replaceState(null, '', '/?a=1');
    await preview(checkout.id, ['payment.error', 'shipping.express']);
    await preview(cart.id, ['empty']);
    const copied = (await copy('Copy link')).copied[0] ?? '';

    cleanup();
    await visit(rebuildQuery(copied), app);
    expect({ search: window.location.search, shown: shown() }).toEqual({
      search: `?a=1&debug-state=${checkout.id}%3Apayment.error%3Bshipping.express%2C${cart.id}%3Aempty&page=2`,
      shown: [
        { value: { payment: 'error', shipping: 'express' }, context: { note: 'live' } },
        { value: 'empty', context: { items: ['apple'] } },
      ],
    });
  });

  test.each<[string, [string, string[]][]]>([
    ['dotted leaf ids', [['checkout', ['payment.card.error']]]],
    ['parentheses', [['(machine)', ['(machine).idle']]]],
    ['hyphens and underscores', [['sign-up_form', ['step-2.email_input']]]],
    ['spaces', [['my machine', ['waiting for user', ' padded ']]]],
    ["'+'", [['a+b', ['c+d', '+']]]],
    ['accents and emoji', [['café🚀', ['crème.brûlée', '☃.launch']]]],
    ['other URL punctuation', [['a&b#c', ['k=v', 'a/b?c', "it's!~*"]]]],
    [
      'several machines and parallel leaves',
      [
        ['checkout', ['payment.error', 'shipping.express']],
        ['cart', ['items.empty', 'promo.none']],
      ],
    ],
  ])('a router that rebuilt the query, with %s', async (_, specs) => {
    const output = watchConsole();
    const machines = specs.map(([name, leaves]) => linked(name, leaves));
    await visit('/', appOf(machines), { fixtures: machines.map((machine) => machine.fixtures) });
    const copied = await copyLinkTo(machines);

    await reload(rebuildQuery(copied[0] ?? ''), machines);
    expect({
      hasColon: window.location.search.includes(':'),
      previewed: await previewed(machines.map((machine) => machine.id)),
      warnings: output.warn,
    }).toEqual({
      hasColon: false,
      previewed: Object.fromEntries(machines.map((machine) => [machine.id, machine.leaves])),
      warnings: [],
    });
  });

  // The rebuild decodes the escaped ';', then escapes the whole value, so the ';' reads as a separator.
  // A format that keeps the ';' must change this test on purpose.
  test("a router that rebuilt the query splits a leaf id at its ';'", async () => {
    const output = watchConsole();
    const machine = linked('checkout', ['step;2']);
    await visit('/', appOf([machine]), { fixtures: [machine.fixtures] });
    const copied = await copyLinkTo([machine]);

    await reload(rebuildQuery(copied[0] ?? ''), [machine]);
    expect({ previewed: await previewed([machine.id]), warnings: output.warn }).toEqual({
      previewed: { [machine.id]: [] },
      warnings: [`[state-viewer] Can't preview "${shownKey()}": "step", "2" are not leaf states of "${machine.id}".`],
    });
  });
});
