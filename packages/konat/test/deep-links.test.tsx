import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Konat, type FixtureSet, type KonatProps } from 'konat';
import { defineFixtures, useActorRef, useMachine } from 'konat/xstate';
import { describe, expect, test } from 'vitest';
import { createMachine, setup, type AnyStateMachine } from 'xstate';
import { watchConsole } from './support/console';
import {
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

function createCheckoutMachine() {
  return createMachine({
    id: freshId('checkout'),
    type: 'parallel',
    context: { note: 'live' },
    states: {
      payment: { initial: 'editing', states: { editing: { on: { FAIL: 'error' } }, error: {}, success: {} } },
      shipping: { initial: 'standard', states: { standard: {}, express: {} } },
    },
  });
}

function createCartMachine() {
  return createMachine({
    id: freshId('cart'),
    context: { items: ['apple'] },
    initial: 'filled',
    states: { empty: {}, filled: {} },
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
const EXPRESS = { value: { payment: 'editing', shipping: 'express' }, context: { note: 'live' } };
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
async function visit(url: string, app: React.ReactNode, props: KonatProps = {}) {
  window.history.replaceState(null, '', url);

  const view = render(
    <>
      {app}
      <Konat defaultOpen {...props} />
    </>,
  );

  await flush();

  return async (next: React.ReactNode) => {
    view.rerender(
      <>
        {next}
        <Konat defaultOpen {...props} />
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
 * The key of the first instance of a machine.
 * Warnings name an instance by its key.
 */
async function keyOf(machineId: string): Promise<string> {
  await show(machineId);

  return shownKey();
}

function liveWarning(leaves: string, key: string): string {
  return `[konat] No recorded or fixture context for "${leaves}" on "${key}", so the preview uses the live context.`;
}

/** The warning under Copy link about machines whose instances a link can't reproduce. */
function linkFooterWarning(): string {
  const root = document.querySelector('[data-konat-root]')?.shadowRoot;

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

declare global {
  /** While it is true, React warns about each update outside act(). Testing Library sets it to true. */
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/**
 * Mounts `app` in a new root with createRoot and without act, as an app starts.
 * Returns the text of its first output at the end of the task that commits the mount, where the browser paints.
 */
async function firstPaint(app: React.ReactNode, { strict = true }: { strict?: boolean } = {}): Promise<string | null> {
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

      root.render(
        <Wrapper>
          {app}
          <EndOfCommit />
        </Wrapper>,
      );
    });
  } finally {
    root.unmount();
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

describe('the first paint', () => {
  // The overlay mounts its host with a state update in a layout effect.
  // Under StrictMode, React then runs all effects a second time before the paint, and the instance registers again.
  // That hides a link that comes too late, so this test mounts without StrictMode.
  test('an instance that mounts with the overlay shows the link', async () => {
    const machine = createCheckoutMachine();
    window.history.replaceState(null, '', `/?debug-state=${machine.id}:payment.error;shipping.express`);

    const painted = await firstPaint(
      <>
        <Instance machine={machine} />
        <Konat />
      </>,
      { strict: false },
    );

    expect(JSON.parse(painted ?? 'null')).toEqual({
      value: { payment: 'error', shipping: 'express' },
      context: { note: 'live' },
    });
  });

  // The overlay applied the link before the instance mounts.
  // So the observer hears the preview when the actor registers, in a layout effect of its hook.
  test('an observer given to useActorRef that mounts after the overlay shows the link', async () => {
    const machine = createToggleMachine();
    await visit(`/?debug-state=${machine.id}:on`, null);

    function WithObserver() {
      const [value, setValue] = React.useState('unknown');
      useActorRef(machine, undefined, (snapshot) => setValue(String(snapshot.value)));

      return <output>{value}</output>;
    }

    expect(await firstPaint(<WithObserver />)).toBe('on');
  });
});

// A search, for a checkout machine and a cart machine with these ids.
type Search = (checkout: string, cart: string) => string;

// What the search previews on the checkout and on the cart, and the warnings about the link.
const SEARCHES: [string, Search, [string[], string[]], (checkout: string) => string[], KonatProps?][] = [
  [
    'several machines and leaves, among other params',
    (c, k) => `?a=1&debug-state=${c}:payment.error;shipping.express,${k}:empty&b=2`,
    [['payment.error', 'shipping.express'], ['empty']],
    () => [],
  ],
  [
    'empty segments and empty leaves',
    (c, k) => `?debug-state=,${k}:empty,,${c}:;payment.error;;shipping.express;,`,
    [['payment.error', 'shipping.express'], ['empty']],
    () => [],
  ],
  ['the param without =', () => '?debug-state&a=1', [[], []], () => []],
  [
    'the param twice, where the first one counts',
    (c) => `?debug-state=${c}:payment.error&debug-state=${c}:payment.success`,
    [['payment.error'], []],
    () => [],
  ],
  [
    'the param after a name that is a bad escape',
    (c) => `?%E0%A4%A=1&debug-state=${c}:payment.error`,
    [['payment.error'], []],
    () => [],
  ],
  [
    "the urlParam prop, with its space written as '+'",
    (c) => `?debug-state=${c}:payment.success&my+state=${c}:payment.error`,
    [['payment.error'], []],
    () => [],
    { urlParam: 'my state' },
  ],
  [
    'a segment without a colon',
    (c, k) => `?debug-state=${c},${k}:empty`,
    [[], ['empty']],
    (c) => [`Skipped "${c}": expected <machineId>:<leaf>.`],
  ],
  [
    'an empty machine id',
    (_, k) => `?debug-state=:payment.error,${k}:empty`,
    [[], ['empty']],
    () => ['Skipped ":payment.error": the machine id is empty.'],
  ],
  [
    'a segment with no leaves',
    (c, k) => `?debug-state=${c}:;;,${k}:empty`,
    [[], ['empty']],
    (c) => [`Skipped "${c}:;;": no leaves after the machine id.`],
  ],
  [
    'a bad escape in a segment',
    (c, k) => `?debug-state=${c}:%E0%A4%A,${k}:empty`,
    [[], ['empty']],
    (c) => [`Skipped "${c}:%E0%A4%A": invalid percent-encoding.`],
  ],
  [
    'a bad escape in a value without a colon',
    () => '?debug-state=%E0%A4%A',
    [[], []],
    () => ['Ignored "%E0%A4%A": invalid percent-encoding.'],
  ],
  [
    'a machine named twice, where the later segment wins',
    (c, k) => `?debug-state=${c}:payment.error,${k}:empty,${c}:payment.success`,
    [['payment.success'], ['empty']],
    (c) => [`Skipped "${c}:payment.error": machine "${c}" appears again in "${c}:payment.success", which wins.`],
  ],
];

describe('reading a link', () => {
  test.each(SEARCHES)('with %s, previews what it can and warns about the rest', async (...row) => {
    const [, search, leaves, errors, props = {}] = row;
    const output = watchConsole();
    const checkout = createCheckoutMachine();
    const cart = createCartMachine();
    await visit(
      `/${search(checkout.id, cart.id)}`,
      <>
        <Instance machine={checkout} />
        <Instance machine={cart} />
      </>,
      props,
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
      warnings: [...errors(checkout.id).map((error) => `[konat] Deep link "debug-state": ${error}`), ...live],
      errors: [],
    });
  });
});

describe('what a link previews', () => {
  test('a link previews every instance of its machine and no other, without the leaves the machine lacks', async () => {
    const output = watchConsole();
    const checkout = createCheckoutMachine();
    const toggle = createToggleMachine();
    const cart = createCartMachine();
    await visit(
      `/?debug-state=${checkout.id}:payment.error;nope,${toggle.id}:nope`,
      <>
        <Instance machine={checkout} />
        <Instance machine={checkout} />
        <Instance machine={toggle} />
        <Instance machine={toggle} />
        <Instance machine={cart} />
      </>,
    );

    const checkoutKey = await keyOf(checkout.id);
    const toggleKey = await keyOf(toggle.id);
    // Each warning is for the first instance of its machine only.
    expect({ shown: shown(), warnings: output.warn }).toEqual({
      shown: [ERROR, ERROR, OFF, OFF, FILLED],
      warnings: [
        `[konat] Ignoring "nope" in the preview of "${checkoutKey}": not a leaf state of "${checkout.id}".`,
        liveWarning('payment.error', checkoutKey),
        `[konat] Can't preview "${toggleKey}": "nope" is not a leaf state of "${toggle.id}".`,
      ],
    });
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
        <Konat />
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
});

describe('when the link ends', () => {
  test.each<[string, (checkout: string) => Promise<void>, unknown[]]>([
    [
      'a preview the developer picks ends the link of that machine',
      (id) => preview(id, ['shipping.express']),
      [EXPRESS, LIVE, ON],
    ],
    ['Release ends the link of that machine', (id) => release(id), [LIVE, LIVE, ON]],
    ['Release all ends every link', () => releaseAll(), [LIVE, LIVE, OFF]],
  ])('%s, so instances that mount later show their own state', async (_, end, expected) => {
    const checkout = createCheckoutMachine();
    const toggle = createToggleMachine();

    const update = await visit(
      `/?debug-state=${checkout.id}:payment.error,${toggle.id}:on`,
      <>
        <Instance key="1" machine={checkout} />
      </>,
    );

    await end(checkout.id);

    await update(
      <>
        <Instance key="1" machine={checkout} />
        <Instance key="2" machine={checkout} />
        <Instance key="3" machine={toggle} />
      </>,
    );
    expect(shown()).toEqual(expected);
  });

  test('the overlay doesn’t apply the link again when it remounts after the developer released it', async () => {
    const machine = createToggleMachine();
    window.history.replaceState(null, '', `/?debug-state=${machine.id}:on`);

    const view = render(
      <>
        <Instance machine={machine} />
        <Konat key="a" defaultOpen />
      </>,
    );

    await flush();
    const linkedApps = shown();
    await release(machine.id);

    view.rerender(
      <>
        <Instance machine={machine} />
        <Konat key="b" defaultOpen />
      </>,
    );
    await flush();
    expect({ linked: linkedApps, remounted: shown() }).toEqual({ linked: [ON], remounted: [OFF] });
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

  test('the link holds the leaves picked on the shown instance, or else on the first to register', async () => {
    const checkout = createCheckoutMachine();
    const toggle = createToggleMachine();
    const cart = createCartMachine();
    await visit(
      '/',
      <>
        <Instance machine={checkout} />
        <Instance machine={checkout} />
        <Instance machine={toggle} />
        <Instance machine={toggle} />
        <Instance machine={cart} />
      </>,
    );
    // Each preview fills in a leaf of the other region, which the link leaves out.
    await preview(checkout.id, ['payment.error']);
    await preview(checkout.id, ['shipping.express'], { nth: 2 });
    await preview(toggle.id, ['on']);
    await preview(toggle.id, ['on'], { nth: 2 });
    await show(checkout.id, 2);
    const second = (await copy('Copy link')).copied;
    await show(cart.id);

    // The toggles are previewed alike, so only the checkout gets the warning.
    expect({ second, first: (await copy('Copy link')).copied, warning: linkFooterWarning() }).toEqual({
      second: [`http://localhost:3000/?debug-state=${checkout.id}:shipping.express,${toggle.id}:on`],
      first: [`http://localhost:3000/?debug-state=${checkout.id}:payment.error,${toggle.id}:on`],
      warning: partialWarning(checkout.id),
    });
  });

  test('writes the urlParam prop in place of the first link, and keeps the other params byte for byte', async () => {
    const machine = createToggleMachine();
    await visit('/', <Instance machine={machine} />, { urlParam: 'my state' });
    const before = 'q=a%20b+c&tag=x&empty=&flag&enc=%E2%9C%93&debug-state=cart:empty';
    const after = 'raw=50%&%E0%A4%A=1&x=a:b;c,d&tag=z';
    window.history.replaceState(null, '', `/?${before}&my+state=x:y&${after}&my%20state=z:w`);
    await preview(machine.id, ['on']);

    expect((await copy('Copy link')).copied).toEqual([
      `http://localhost:3000/?${before}&my%20state=${machine.id}:on&${after}`,
    ]);
  });

  test('after a reload, a copied link previews the same leaves, and other regions follow the instance', async () => {
    const machine = createCheckoutMachine();

    // The fixture of the leaf the developer picked wins over the fixture of the leaf that the preview fills in.
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
        <Konat fixtures={fixtures} />
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

// A router decodes the value before it escapes it again, so ids with ':' ';' ',' or '%' don't come back whole.
const ROUTED: [string, string[]][] = [
  ['checkout', ['payment.error', 'shipping.express']],
  ['sign-up_form', ['step-2.email_input']],
  ['(machine)', ['(machine).idle']],
  ['my machine', ['waiting for user', ' padded ']],
  ['a+b', ['c+d', '+']],
  ['café🚀', ['crème.brûlée', '☃.launch']],
  ['a&b#c', ['k=v', 'a/b?c', "it's!~*"]],
];

/** Gives the value of a copied link to URLSearchParams.set(), as app code can. */
function setParam(url: string): string {
  const params = new URLSearchParams('a=1');
  params.set('debug-state', linkValue(url));

  return `/?${params}`;
}

// App code that gives a link to URLSearchParams.set() escapes it again.
// A router that rebuilds the query decodes the value, then escapes it again.
// Both escape ':', so the overlay decodes a value without ':' one time.
describe('round trips', () => {
  test.each<[string, [string, string[]][], (copied: string) => string, boolean]>([
    ['Copy link and a reload', AWKWARD, (url) => url, true],
    ['app code that gives the copied link to URLSearchParams.set()', AWKWARD, setParam, false],
    ['a router that rebuilt the query', ROUTED, rebuildQuery, false],
  ])('ids survive %s', async (_, specs, reopen, hasColon) => {
    const output = watchConsole();
    const machines = specs.map(([name, leaves]) => linked(name, leaves));
    await visit('/', appOf(machines), { fixtures: machines.map((machine) => machine.fixtures) });
    const copied = await copyLinkTo(machines);

    await reload(reopen(copied[0] ?? ''), machines);
    expect({
      hasColon: window.location.search.includes(':'),
      previewed: await previewed(machines.map((machine) => machine.id)),
      warnings: output.warn,
    }).toEqual({
      hasColon,
      previewed: Object.fromEntries(machines.map((machine) => [machine.id, machine.leaves])),
      warnings: [],
    });
  });
});
