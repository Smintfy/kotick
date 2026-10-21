import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { Konat, type Theme } from 'konat';
import { defineFixtures, useMachine } from 'konat/xstate';
import { describe, expect, onTestFinished, test } from 'vitest';
import { createMachine, setup, type AnyStateMachine } from 'xstate';
import { watchConsole } from './support/console';
import type { Json } from './support/json';
import {
  copy,
  flush,
  freshId,
  isOpen,
  machines,
  marks,
  overlay,
  panel,
  pickCorner,
  preview,
  releaseAll,
  show,
  shownMachine,
  toggleState,
} from './support/panel';

const SETTINGS_KEY = 'konat:ui';

type CheckoutContext = { note: string };

type CheckoutEvent = { type: 'EXPRESS' } | { type: 'STANDARD' };

function createCheckoutMachine() {
  // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
  return setup({
    types: { context: {} as CheckoutContext, events: {} as CheckoutEvent },
  }).createMachine({
    id: freshId('checkout'),
    type: 'parallel',
    context: { note: 'live' },
    states: {
      shipping: {
        initial: 'standard',
        on: { EXPRESS: '.express', STANDARD: '.standard' },
        states: { standard: {}, express: {} },
      },
      payment: { initial: 'editing', states: { editing: {}, error: {}, success: { type: 'final' } } },
    },
  });
}

function createToggleMachine() {
  return createMachine({ id: freshId('toggle'), initial: 'off', states: { off: {}, on: {} } });
}

function Checkout({ machine }: { machine: AnyStateMachine }) {
  const [, send] = useMachine(machine);

  return (
    <>
      <button type="button" onClick={() => send({ type: 'EXPRESS' })}>
        Express
      </button>
      <button type="button" onClick={() => send({ type: 'STANDARD' })}>
        Standard
      </button>
    </>
  );
}

function Run({ machine }: { machine: AnyStateMachine }) {
  useMachine(machine);

  return null;
}

/**
 * Goes to `path` as the Next.js App Router does: it calls pushState() in an insertion effect, and Chrome tells the
 * listeners of the Navigation API in that call.
 */
function Router({ path }: { path: string }) {
  React.useInsertionEffect(() => {
    if (window.location.pathname === path) return;
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, [path]);

  return null;
}

async function click(element: Element): Promise<void> {
  fireEvent.click(element);
  await flush();
}

function bubble(): HTMLButtonElement {
  const found = overlay().querySelector<HTMLButtonElement>('button[aria-expanded]');

  if (!found) throw new Error('The overlay has no bubble.');

  return found;
}

function button(label: string): HTMLButtonElement {
  const found = [...overlay().querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label || candidate.textContent === label,
  );

  if (!found) throw new Error(`The overlay has no ${label} button.`);

  return found;
}

/** The corner and the color scheme of the overlay. */
function look() {
  const { position, theme } = overlay().querySelector<HTMLElement>('[data-position]')?.dataset ?? {};

  return { corner: position, theme };
}

/** The shown tree, a row per state: indented by its level, then its key, description, type and tags. */
function treeRows(): string[] {
  return [...overlay().querySelectorAll<HTMLElement>('[role="treeitem"]')].map((item) => {
    const row = item.hasAttribute('data-leaf') ? item : item.firstElementChild;
    const indent = '  '.repeat(Number(item.getAttribute('aria-level')) - 1);
    const key = row?.querySelector('[data-part="key"]')?.textContent;
    const description = row?.querySelector('[data-part="description"]')?.textContent;
    const badges = [...(row?.querySelectorAll('[data-part="type"], [data-part="tag"]') ?? [])].map((badge) => badge.textContent);
    const parts = [`${indent}${key}`];

    if (description !== undefined) parts.push(`“${description}”`);

    if (badges.length > 0) parts.push(`[${badges.join(', ')}]`);

    return parts.join(' ');
  });
}

/** The leaf ids of the shown tree, in the order it lists them. */
function leaves(): string[] {
  return [...overlay().querySelectorAll<HTMLElement>('[data-leaf]')].map((leaf) => leaf.dataset.leaf ?? '');
}

/** What a screen reader announces after each leaf's name, by leaf id. */
function announced(): Record<string, string> {
  return Object.fromEntries(
    [...overlay().querySelectorAll<HTMLElement>('[data-leaf]')].map((leaf) => [
      leaf.dataset.leaf,
      leaf.querySelector('[data-part="leaf-status"]')?.textContent?.replace(/^, /, ''),
    ]),
  );
}

/** The machine list: the title and chips of its header, and each row with the states on its right. */
async function machineList() {
  const rows = await machines();
  const states = [...overlay().querySelectorAll('button[data-machine] [data-part="row-end"]')].map((end) => end.textContent);

  return {
    header: [...overlay().querySelectorAll('header h2, header [data-part="chip"]')].map((part) => part.textContent),
    rows: rows.map((row, index) => `${row} · ${states[index]}`),
  };
}

function stored(): Json {
  const raw = localStorage.getItem(SETTINGS_KEY);

  return raw === null ? null : JSON.parse(raw);
}

function json(value: Json): string {
  return JSON.stringify(value, null, 2);
}

test('the bubble opens a panel that lists the page’s machines, a row shows its machine, and Close closes it', async () => {
  const machine = createCheckoutMachine();
  render(
    <>
      <Checkout machine={machine} />
      <Konat />
    </>,
  );
  await flush();

  // The bubble names the panel it opens, for assistive technology.
  const controlled = () => {
    const id = bubble().getAttribute('aria-controls');

    return id === null ? null : overlay().getElementById(id)?.getAttribute('aria-label');
  };

  const closed = { open: isOpen(), controls: controlled() };
  await click(bubble());
  const opened = { open: isOpen(), controls: controlled(), machines: await machines() };
  await show(machine.id);
  const shown = { machine: shownMachine(), live: panel().live };
  await click(button('Close'));
  expect({ closed, opened, shown, reclosed: { open: isOpen(), controls: controlled() } }).toEqual({
    closed: { open: false, controls: null },
    opened: { open: true, controls: 'Konat', machines: [machine.id] },
    shown: { machine: machine.id, live: ['shipping.standard', 'payment.editing'] },
    reclosed: { open: false, controls: null },
  });
});

describe('the machine list', () => {
  test('lists each machine with its states, its instances, a child tag and a preview mark, under the page’s path', async () => {
    window.history.replaceState(null, '', '/checkout');
    const checkout = createCheckoutMachine();
    const toggle = createToggleMachine();
    const fetcher = createMachine({ id: freshId('fetcher'), initial: 'loading', states: { loading: {}, failed: {} } });

    const parent = setup({ actors: { fetcher } }).createMachine({
      id: freshId('parent'),
      initial: 'active',
      states: { active: { invoke: { id: 'load', src: 'fetcher' } } },
    });

    render(
      <>
        <Checkout machine={checkout} />
        <Run machine={toggle} />
        <Run machine={toggle} />
        <Run machine={parent} />
        <Konat defaultOpen />
      </>,
    );
    await flush();

    const listed = await machineList();
    await preview(toggle.id, ['on'], { nth: 2 });
    const previewing = await machineList();
    window.history.pushState(null, '', '/cart');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await flush();
    expect({ listed, previewing, navigated: (await machineList()).header }).toEqual({
      listed: {
        header: ['Machines', '/checkout', '4'],
        rows: [
          `${checkout.id} · 5 states`,
          `${toggle.id} · 2 instances · 2 states`,
          `${parent.id} · 1 state`,
          `${fetcher.id} · child · 2 states`,
        ],
      },
      previewing: {
        header: ['Machines', '/checkout', '4'],
        rows: [
          `${checkout.id} · 5 states`,
          `${toggle.id} · 2 instances · previewing · 2 states`,
          `${parent.id} · 1 state`,
          `${fetcher.id} · child · 2 states`,
        ],
      },
      navigated: ['Machines', '/cart', '4'],
    });
  });

  test('the path follows a router that changes it in an insertion effect, and React logs no error', async () => {
    window.history.replaceState(null, '', '/checkout');
    const toggle = createToggleMachine();
    const output = watchConsole();

    const page = (path: string) => (
      <>
        <Router path={path} />
        <Run machine={toggle} />
        <Konat defaultOpen />
      </>
    );

    const { rerender } = render(page('/checkout'));
    await flush();
    rerender(page('/cart'));
    await flush();
    expect({ header: (await machineList()).header, errors: output.error }).toEqual({
      header: ['Machines', '/cart', '1'],
      errors: [],
    });
  });

  test('Back from a machine page shows the list again, and the panel forgets the machine', async () => {
    const toggle = createToggleMachine();

    const page = () => (
      <>
        <Run machine={toggle} />
        <Konat defaultOpen />
      </>
    );

    const { unmount } = render(page());
    await flush();

    await show(toggle.id);
    const shown = { machine: shownMachine(), saved: stored() };
    await click(button('Back'));
    const back = { machine: shownMachine(), saved: stored() };
    unmount();
    render(page());
    await flush();
    expect({ shown, back, reloaded: shownMachine() }).toEqual({
      shown: { machine: toggle.id, saved: { v: 1, machine: toggle.id } },
      back: { machine: 'none', saved: { v: 1 } },
      reloaded: 'none',
    });
  });

  test('the stored machine’s page opens when that machine registers, and the list shows while it is gone', async () => {
    const toggle = createToggleMachine();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ v: 1, open: true, machine: toggle.id }));

    const page = (mounted: boolean) => (
      <>
        {mounted && <Run machine={toggle} />}
        <Konat />
      </>
    );

    const { rerender } = render(page(false));
    await flush();

    const before = shownMachine();
    rerender(page(true));
    await flush();
    const registered = { machine: shownMachine(), live: panel().live };
    rerender(page(false));
    await flush();
    const gone = shownMachine();
    rerender(page(true));
    await flush();
    expect({ before, registered, gone, back: shownMachine() }).toEqual({
      before: 'none',
      registered: { machine: toggle.id, live: ['off'] },
      gone: 'none',
      back: toggle.id,
    });
  });
});

describe('the host element', () => {
  test('is an open shadow root appended to document.body, outside the React tree, and styles only itself', async () => {
    const { container } = render(<Konat />);
    await flush();

    const hosts = [...document.querySelectorAll('[data-konat-root]')];
    expect({
      rendered: container.innerHTML,
      hosts: hosts.map((host) => ({
        parent: host.parentNode === document.body,
        last: document.body.lastElementChild === host,
        shadow: host.shadowRoot?.mode,
      })),
      pageStyles: document.querySelectorAll('style, link[rel="stylesheet"]').length,
      overlayStyles: overlay().querySelectorAll('style').length,
    }).toEqual({
      rendered: '',
      hosts: [{ parent: true, last: true, shadow: 'open' }],
      pageStyles: 0,
      overlayStyles: 1,
    });
  });

  test('goes into portalTarget, an element or a shadow root', async () => {
    const element = document.createElement('section');
    const outer = document.createElement('div');
    const shadowTarget = outer.attachShadow({ mode: 'open' });
    document.body.append(element, outer);
    onTestFinished(() => {
      element.remove();
      outer.remove();
    });

    const hostsIn = () => ({
      element: element.querySelectorAll('[data-konat-root]').length,
      shadow: shadowTarget.querySelectorAll('[data-konat-root]').length,
      document: document.querySelectorAll('[data-konat-root]').length,
    });

    const { rerender } = render(<Konat portalTarget={element} />);
    await flush();
    const inElement = hostsIn();
    rerender(<Konat portalTarget={shadowTarget} />);
    await flush();
    expect({ inElement, inShadow: hostsIn() }).toEqual({
      inElement: { element: 1, shadow: 0, document: 1 },
      inShadow: { element: 0, shadow: 1, document: 0 },
    });
  });

  test('is removed when <Konat /> unmounts', async () => {
    const { unmount } = render(<Konat />);
    await flush();
    const mounted = document.querySelectorAll('[data-konat-root]').length;
    unmount();
    expect({ mounted, unmounted: document.querySelectorAll('[data-konat-root]').length }).toEqual({
      mounted: 1,
      unmounted: 0,
    });
  });
});

describe('the bubble', () => {
  test('counts the active previews in a badge and in its name', async () => {
    const machine = createToggleMachine();
    render(
      <>
        <Run machine={machine} />
        <Run machine={machine} />
        <Konat defaultOpen />
      </>,
    );
    await flush();

    const badge = () => ({
      badge: overlay().querySelector('[data-part="badge"]')?.textContent ?? null,
      name: bubble().getAttribute('aria-label'),
    });

    const seen = [badge()];
    await preview(machine.id, ['on'], { nth: 1 });
    seen.push(badge());
    await preview(machine.id, ['on'], { nth: 2 });
    seen.push(badge());
    await releaseAll();
    seen.push(badge());
    expect(seen).toEqual([
      { badge: null, name: 'Konat' },
      { badge: '1', name: 'Konat, 1 preview active' },
      { badge: '2', name: 'Konat, 2 previews active' },
      { badge: null, name: 'Konat' },
    ]);
  });
});

describe('the state tree', () => {
  function createEditorMachine() {
    return createMachine({
      id: freshId('editor'),
      initial: 'cart',
      states: {
        cart: { description: 'Items waiting to be paid for', tags: ['editable'] },
        payment: {
          // The tree names a state by its path, never by an id like this one.
          id: 'pay',
          initial: 'idle',
          tags: 'busy',
          states: {
            idle: { description: '' },
            error: { description: 'The card was declined', tags: ['error', 'retryable'] },
            previous: { type: 'history' },
          },
        },
        shipping: {
          type: 'parallel',
          description: 'Speed and wrapping are chosen independently',
          states: {
            speed: {
              initial: 'standard',
              states: { standard: {}, express: { id: 'fast' }, remembered: { type: 'history', history: 'deep' } },
            },
            gift: { tags: [] },
            saving: {
              type: 'parallel',
              states: { upload: { initial: 'pending', states: { pending: {}, failed: {} } }, spinner: {} },
            },
          },
        },
        done: { type: 'final' },
        resume: { type: 'history' },
      },
    });
  }

  const EDITOR_LEAVES = [
    'cart',
    'payment.idle',
    'payment.error',
    'shipping.speed.standard',
    'shipping.speed.express',
    'shipping.gift',
    'shipping.saving.upload.pending',
    'shipping.saving.upload.failed',
    'shipping.saving.spinner',
    'done',
  ];

  test('shows every state but history ones, nested, with descriptions, types and tags', async () => {
    const machine = createEditorMachine();
    render(
      <>
        <Run machine={machine} />
        <Konat defaultOpen />
      </>,
    );
    await flush();
    await show(machine.id);

    expect({
      label: overlay().querySelector('[role="tree"]')?.getAttribute('aria-label'),
      rows: treeRows(),
      leaves: leaves(),
    }).toEqual({
      label: `States of ${machine.id} · 1`,
      rows: [
        'cart “Items waiting to be paid for” [editable]',
        'payment [busy]',
        '  idle',
        '  error “The card was declined” [error, retryable]',
        'shipping “Speed and wrapping are chosen independently” [parallel]',
        '  speed',
        '    standard',
        '    express',
        '  gift',
        '  saving [parallel]',
        '    upload',
        '      pending',
        '      failed',
        '    spinner',
        'done [final]',
      ],
      leaves: EDITOR_LEAVES,
    });
  });

  test('each leaf it lists previews, final states and leaves of nested parallel states too', async () => {
    const machine = createEditorMachine();
    render(
      <>
        <Run machine={machine} />
        <Konat defaultOpen />
      </>,
    );
    await flush();
    await show(machine.id);

    const previewed: unknown[] = [];

    for (const leaf of leaves()) {
      await preview(machine.id, [leaf]);
      previewed.push(panel().previewed);
    }

    expect(previewed).toEqual(EDITOR_LEAVES.map((leaf) => [leaf]));
  });

  test('marks the live leaves and the data a preview of each leaf would use, and follows the app', async () => {
    const machine = createCheckoutMachine();
    const fixtures = [defineFixtures(machine, { 'payment.error': { context: { note: 'fixture' } } })];
    render(
      <>
        <Checkout machine={machine} />
        <Konat defaultOpen fixtures={fixtures} />
      </>,
    );
    await flush();
    await show(machine.id);

    const started = { live: panel().live, marks: marks(), announced: announced() };
    fireEvent.click(screen.getByRole('button', { name: 'Express' }));
    await flush();
    const moved = { live: panel().live, marks: marks() };
    // Both leaves are recorded now, so only the actor changes, and the panel follows it.
    fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
    await flush();
    expect({ started, moved, back: panel().live }).toEqual({
      started: {
        // The app recorded the context of its first state as it started.
        live: ['shipping.standard', 'payment.editing'],
        marks: {
          'shipping.standard': ['recorded'],
          'shipping.express': ['none'],
          'payment.editing': ['recorded'],
          'payment.error': ['fixture'],
          'payment.success': ['none'],
        },
        announced: {
          'shipping.standard': 'active, recorded context',
          'shipping.express': 'no recorded or fixture context',
          'payment.editing': 'active, recorded context',
          'payment.error': 'fixture',
          'payment.success': 'no recorded or fixture context',
        },
      },
      moved: {
        live: ['shipping.express', 'payment.editing'],
        marks: {
          'shipping.standard': ['recorded'],
          'shipping.express': ['recorded'],
          'payment.editing': ['recorded'],
          'payment.error': ['fixture'],
          'payment.success': ['none'],
        },
      },
      back: ['shipping.standard', 'payment.editing'],
    });
  });

  /** Picks the nth instance in the Instance picker, and stays on the machine page. */
  async function pickInstance(nth: number): Promise<void> {
    const picker = overlay().querySelector<HTMLSelectElement>('select[aria-label="Instance"]');
    const option = picker?.options[nth - 1];

    if (!picker || !option) throw new Error(`The machine page has no instance ${nth} to pick.`);
    fireEvent.change(picker, { target: { value: option.value } });
    await flush();
  }

  /** Whether each shown compound or parallel state is expanded, by its key. */
  function expanded(): Record<string, string | null> {
    return Object.fromEntries(
      [...overlay().querySelectorAll('[role="treeitem"][aria-expanded]')].map((item) => [
        item.firstElementChild?.querySelector('[data-part="key"]')?.textContent,
        item.getAttribute('aria-expanded'),
      ]),
    );
  }

  test('a click on a compound or parallel state hides the states in it, and a second click shows them again', async () => {
    const machine = createEditorMachine();
    render(
      <>
        <Run machine={machine} />
        <Konat defaultOpen />
      </>,
    );
    await flush();
    await show(machine.id);

    await toggleState('payment');
    await toggleState('saving');
    const collapsed = { expanded: expanded(), leaves: leaves() };
    await toggleState('payment');
    expect({ collapsed, expandedAgain: { expanded: expanded(), leaves: leaves() } }).toEqual({
      collapsed: {
        expanded: { payment: 'false', shipping: 'true', speed: 'true', saving: 'false' },
        leaves: ['cart', 'shipping.speed.standard', 'shipping.speed.express', 'shipping.gift', 'done'],
      },
      expandedAgain: {
        expanded: { payment: 'true', shipping: 'true', speed: 'true', saving: 'false' },
        leaves: [
          'cart',
          'payment.idle',
          'payment.error',
          'shipping.speed.standard',
          'shipping.speed.express',
          'shipping.gift',
          'done',
        ],
      },
    });
  });

  test('a state collapses for one instance, so another instance, or the same one shown again, shows every state', async () => {
    const machine = createEditorMachine();
    render(
      <>
        <Run machine={machine} />
        <Run machine={machine} />
        <Konat defaultOpen />
      </>,
    );
    await flush();
    await show(machine.id, 1);

    await toggleState('payment');
    const first = leaves();
    await pickInstance(2);
    const second = leaves();
    await pickInstance(1);
    expect({ first, second, firstAgain: leaves() }).toEqual({
      first: EDITOR_LEAVES.filter((leaf) => !leaf.startsWith('payment.')),
      second: EDITOR_LEAVES,
      firstAgain: EDITOR_LEAVES,
    });
  });

  test('a machine without states has none to list', async () => {
    const machine = createMachine({ id: freshId('empty') });
    render(
      <>
        <Run machine={machine} />
        <Konat defaultOpen />
      </>,
    );
    await flush();
    await show(machine.id);

    const hint = overlay().querySelector('section[aria-labelledby]')?.querySelector('[data-part="hint"]')?.textContent;
    expect({ machine: shownMachine(), leaves: leaves(), hint }).toEqual({
      machine: machine.id,
      leaves: [],
      hint: 'This machine has no states to list.',
    });
  });

  test('a description that is not text, as a JavaScript machine can give, is left out', async () => {
    const machine = createMachine({
      id: freshId('described'),
      initial: 'object',
      states: {
        // @ts-expect-error A JavaScript machine can give a description that is not a string.
        object: { description: { en: 'Waits for the server' } },
        // @ts-expect-error A JavaScript machine can give a description that is not a string.
        number: { description: 42 },
        text: { description: 'Shown' },
      },
    });

    render(
      <>
        <Run machine={machine} />
        <Konat defaultOpen />
      </>,
    );
    await flush();
    await show(machine.id);

    expect(treeRows()).toEqual(['object', 'number', 'text “Shown”']);
  });

  test('without a machine on the page, the panel says how machines get there', async () => {
    render(<Konat defaultOpen />);
    await flush();

    expect({ machines: await machines(), body: overlay().querySelector('[data-part="empty"]')?.textContent }).toEqual({
      machines: [],
      body:
        'No machines yet. Hooks from konat/xstate register their actors as they mount, and connect() ' +
        'registers actors created outside React.',
    });
  });
});

describe('the context rows', () => {
  test('show each value by its type, and expand arrays, objects, Maps and class instances', async () => {
    class Point {
      x = 1;
    }

    const machine = createMachine({
      id: freshId('values'),
      context: {
        text: 'hi',
        count: 3,
        nothing: null,
        missing: undefined,
        save: () => {},
        list: [1, 2],
        empty: {},
        object: { a: 1 },
        map: new Map([['k', 1]]),
        point: new Point(),
      },
    });

    render(
      <>
        <Run machine={machine} />
        <Konat defaultOpen />
      </>,
    );
    await flush();
    await show(machine.id);

    expect(panel().context).toEqual([
      'text: "hi"',
      'count: 3',
      'nothing: null',
      'missing: undefined',
      'save: ƒ save()',
      'list: Array(2)',
      '0: 1',
      '1: 2',
      'empty: {}',
      'object: {…}',
      'a: 1',
      'map: Map(1)',
      'k: 1',
      'point: Point {…}',
      'x: 1',
    ]);
  });
});

describe('Copy JSON', () => {
  test('copies the shown instance as indented JSON: its machine, leaves, preview and context', async () => {
    const machine = createCheckoutMachine();
    render(
      <>
        <Checkout machine={machine} />
        <Konat defaultOpen />
      </>,
    );
    await flush();
    await show(machine.id);

    const live = await copy('Copy JSON');
    await preview(machine.id, ['payment.error']);
    const previewing = await copy('Copy JSON');
    // jsdom has no clipboard, so the status always says the copy failed.
    expect({ live, previewing }).toEqual({
      live: {
        copied: [
          json({
            machine: machine.id,
            instance: `${machine.id} · 1`,
            leaves: ['shipping.standard', 'payment.editing'],
            preview: null,
            context: { note: 'live' },
          }),
        ],
        status: 'Copy failed',
      },
      previewing: {
        copied: [
          json({
            machine: machine.id,
            instance: `${machine.id} · 1`,
            leaves: ['payment.error', 'shipping.standard'],
            preview: { requested: ['payment.error'], source: 'live' },
            context: { note: 'live' },
          }),
        ],
        status: 'Copy failed',
      },
    });
  });

  test('turns what JSON can’t hold into placeholders, and repeats an object that is shared but not a cycle', async () => {
    type Loop = { name: string; self?: Loop };

    const cycle: Loop = { name: 'loop' };
    cycle.self = cycle;
    const shared = { n: 1 };

    const machine = setup({ actors: { child: createMachine({}) } }).createMachine({
      id: freshId('odd'),
      context: ({ spawn }) => ({
        cycle,
        shared: { a: shared, b: shared },
        fn: function save() {},
        big: 10n,
        map: new Map<unknown, unknown>([
          ['a', 1],
          [2, 'b'],
        ]),
        set: new Set([1, 2]),
        date: new Date(Date.UTC(2026, 9, 14)),
        error: new TypeError('nope'),
        actor: spawn('child', { id: 'helper' }),
        gone: undefined,
      }),
    });

    render(
      <>
        <Run machine={machine} />
        <Konat defaultOpen />
      </>,
    );
    await flush();
    await show(machine.id);

    const { copied } = await copy('Copy JSON');
    expect(copied.map((text) => JSON.parse(text).context)).toStrictEqual([
      {
        cycle: { name: 'loop', self: '[Circular]' },
        shared: { a: { n: 1 }, b: { n: 1 } },
        fn: '[Function save]',
        big: '10n',
        map: { a: 1, 2: 'b' },
        set: [1, 2],
        date: '2026-10-14T00:00:00.000Z',
        error: 'TypeError: nope',
        actor: '[Actor helper]',
      },
    ]);
  });

  test('copies a placeholder when reading the context throws, and the context rows keep rendering', async () => {
    const machine = createMachine({
      id: freshId('hostile'),
      context: {
        get boom(): never {
          throw new Error('no');
        },
      },
    });

    render(
      <>
        <Run machine={machine} />
        <Konat defaultOpen />
      </>,
    );
    await flush();
    await show(machine.id);

    expect({ copied: (await copy('Copy JSON')).copied, context: panel().context }).toEqual({
      copied: ['"[Unserializable: no]"'],
      context: ['boom: "[Unreadable]"'],
    });
  });

  test('the clicked button shows what the copy did for 2 s in place of its label, and keeps its name', async () => {
    const machine = createCheckoutMachine();
    render(
      <>
        <Checkout machine={machine} />
        <Konat defaultOpen />
      </>,
    );
    await flush();
    await preview(machine.id, ['payment.error']);

    const footer = () =>
      [...overlay().querySelectorAll('footer button')].map(
        (found) => `${found.getAttribute('aria-label')}: ${found.textContent}`,
      );

    await copy('Copy JSON');
    const afterJson = footer();
    await copy('Copy link');
    const afterLink = footer();
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await flush();
    // jsdom has no clipboard, so each copy fails.
    expect({ afterJson, afterLink, later: footer() }).toEqual({
      afterJson: ['Copy JSON: Copy failed', 'Copy link: Copy link'],
      afterLink: ['Copy JSON: Copy JSON', 'Copy link: Copy failed'],
      later: ['Copy JSON: Copy JSON', 'Copy link: Copy link'],
    });
  });
});

describe('settings', () => {
  test('the panel remembers whether it is open, its corner and the shown machine', async () => {
    const checkout = createCheckoutMachine();
    const toggle = createToggleMachine();

    const page = () => (
      <>
        <Checkout machine={checkout} />
        <Run machine={toggle} />
        <Konat />
      </>
    );

    const { unmount } = render(page());
    await flush();
    const first = { open: isOpen(), corner: look().corner };
    await click(bubble());
    await pickCorner('Bottom left');
    await show(toggle.id);
    const saved = stored();
    unmount();

    render(page());
    await flush();
    expect({ first, saved, reloaded: { open: isOpen(), corner: look().corner, machine: shownMachine() } }).toEqual({
      first: { open: false, corner: 'bottom-right' },
      saved: { v: 1, open: true, machine: toggle.id, position: 'bottom-left', positionDefault: 'bottom-right' },
      reloaded: { open: true, corner: 'bottom-left', machine: toggle.id },
    });
  });

  test('picking a corner in Settings moves the bubble and the panel there', async () => {
    render(<Konat defaultOpen />);
    await flush();

    const checked = () => overlay().querySelector('[role="radiogroup"] input:checked')?.parentElement?.textContent;
    const corners: { corner?: string; checked?: string }[] = [];

    for (const label of ['Top left', 'Top right', 'Bottom left', 'Bottom right']) {
      await pickCorner(label);
      corners.push({ corner: look().corner, checked: checked() });
    }

    expect(corners).toEqual([
      { corner: 'top-left', checked: 'Top left' },
      { corner: 'top-right', checked: 'Top right' },
      { corner: 'bottom-left', checked: 'Bottom left' },
      { corner: 'bottom-right', checked: 'Bottom right' },
    ]);
  });

  test('a stored corner applies only while the position prop is the one the user moved away from', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ v: 1, position: 'top-left', positionDefault: 'bottom-right' }));
    const { rerender } = render(<Konat />);
    await flush();

    const corners = [look().corner];
    rerender(<Konat position="top-right" />);
    corners.push(look().corner);
    rerender(<Konat position="bottom-right" />);
    corners.push(look().corner);
    expect(corners).toEqual(['top-left', 'top-right', 'top-left']);
  });

  test('without a stored corner, the position prop places the overlay', async () => {
    render(<Konat position="top-right" />);
    await flush();
    expect(look().corner).toBe('top-right');
  });

  test('defaultOpen applies until the user opens or closes the panel', async () => {
    const { unmount } = render(<Konat defaultOpen />);
    await flush();
    const first = { open: isOpen(), saved: stored() };
    await click(button('Close'));
    unmount();

    render(<Konat defaultOpen />);
    await flush();
    expect({ first, reloaded: isOpen() }).toEqual({ first: { open: true, saved: null }, reloaded: false });
  });

  describe('stored settings the overlay can’t use', () => {
    test.each([
      [
        'invalid fields',
        '{"v":1,"open":"yes","position":"middle","positionDefault":"bottom-right","machine":""}',
        { open: false, corner: 'bottom-right' },
        { v: 1, open: true },
      ],
      [
        'invalid fields next to valid ones',
        '{"v":1,"open":true,"position":"middle","positionDefault":"bottom-right"}',
        { open: true, corner: 'bottom-right' },
        { v: 1, open: false },
      ],
      [
        'a corner without the position prop it was chosen over',
        '{"v":1,"position":"top-left"}',
        { open: false, corner: 'bottom-right' },
        { v: 1, open: true },
      ],
      [
        'another version',
        '{"v":2,"open":true,"position":"top-left","positionDefault":"bottom-right"}',
        { open: false, corner: 'bottom-right' },
        { v: 1, open: true },
      ],
      ['broken JSON', '{', { open: false, corner: 'bottom-right' }, { v: 1, open: true }],
      ['JSON that isn’t an object', 'null', { open: false, corner: 'bottom-right' }, { v: 1, open: true }],
    ])('%s: the overlay keeps what it can, and the next change replaces them', async (_name, raw, shown, saved) => {
      localStorage.setItem(SETTINGS_KEY, raw);
      render(<Konat />);
      await flush();

      const before = { open: isOpen(), corner: look().corner };
      await click(bubble());
      expect({ before, saved: stored() }).toEqual({ before: shown, saved });
    });
  });
});

test('the theme prop sets the color scheme, and an unknown theme follows the system', async () => {
  const { rerender } = render(<Konat />);
  await flush();

  const themes = [look().theme];

  for (const theme of ['light', 'dark'] satisfies Theme[]) {
    rerender(<Konat theme={theme} />);
    themes.push(look().theme);
  }

  // @ts-expect-error A JavaScript app can pass a theme that Theme does not have.
  rerender(<Konat theme="neon" />);
  themes.push(look().theme);

  expect(themes).toEqual(['system', 'light', 'dark', 'system']);
});
