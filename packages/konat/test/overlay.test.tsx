import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { Konat } from 'konat';
import { defineFixtures, useMachine } from 'konat/xstate';
import { describe, expect, onTestFinished, test } from 'vitest';
import { createMachine, setup, type AnyStateMachine } from 'xstate';
import { mount } from './support/app';
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
 * The Next.js App Router calls pushState() in an insertion effect.
 * Chrome tells the listeners of the Navigation API during that call.
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

function look() {
  const { position } = overlay().querySelector<HTMLElement>('[data-position]')?.dataset ?? {};

  return { corner: position };
}

function treeRows(): string[] {
  return [...overlay().querySelectorAll<HTMLElement>('[role="treeitem"]')].map((item) => {
    const row = item.hasAttribute('data-leaf') ? item : item.firstElementChild;
    const indent = '  '.repeat(Number(item.getAttribute('aria-level')) - 1);

    return `${indent}${row?.querySelector('[data-part="key"]')?.textContent}`;
  });
}

function leaves(): string[] {
  return [...overlay().querySelectorAll<HTMLElement>('[data-leaf]')].map((leaf) => leaf.dataset.leaf ?? '');
}

function announced(): Record<string, string> {
  return Object.fromEntries(
    [...overlay().querySelectorAll<HTMLElement>('[data-leaf]')].map((leaf) => [
      leaf.dataset.leaf,
      leaf.querySelector('[data-part="leaf-status"]')?.textContent?.replace(/^, /, ''),
    ]),
  );
}

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
  const shown = shownMachine();
  await click(button('Close'));
  expect({ closed, opened, shown, reclosed: { open: isOpen(), controls: controlled() } }).toEqual({
    closed: { open: false, controls: null },
    opened: { open: true, controls: 'Konat', machines: [machine.id] },
    shown: machine.id,
    reclosed: { open: false, controls: null },
  });
});

describe('the machine list', () => {
  test('lists each machine with its states, its instances and a child tag, under the page’s path', async () => {
    window.history.replaceState(null, '', '/checkout');
    const checkout = createCheckoutMachine();
    const toggle = createToggleMachine();
    const fetcher = createMachine({ id: freshId('fetcher'), initial: 'loading', states: { loading: {}, failed: {} } });

    const parent = setup({ actors: { fetcher } }).createMachine({
      id: freshId('parent'),
      initial: 'active',
      states: { active: { invoke: { id: 'load', src: 'fetcher' } } },
    });

    await mount(
      <>
        <Checkout machine={checkout} />
        <Run machine={toggle} />
        <Run machine={toggle} />
        <Run machine={parent} />
      </>,
    );

    const listed = await machineList();
    window.history.pushState(null, '', '/cart');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await flush();
    expect({ listed, navigated: (await machineList()).header }).toEqual({
      listed: {
        header: ['Machines', '/checkout', '4'],
        rows: [
          `${checkout.id} · 5 states`,
          `${toggle.id} · 2 instances · 2 states`,
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
    const registered = shownMachine();
    rerender(page(false));
    await flush();
    const gone = shownMachine();
    rerender(page(true));
    await flush();
    expect({ before, registered, gone, back: shownMachine() }).toEqual({
      before: 'none',
      registered: toggle.id,
      gone: 'none',
      back: toggle.id,
    });
  });
});

describe('the host element', () => {
  test('is an open shadow root in document.body or in portalTarget, styles only itself, and leaves on unmount', async () => {
    const element = document.createElement('section');
    const outer = document.createElement('div');
    const shadowTarget = outer.attachShadow({ mode: 'open' });
    document.body.append(element, outer);
    onTestFinished(() => {
      element.remove();
      outer.remove();
    });

    const hostsIn = () => ({
      body: [...document.body.children].filter((child) => child.hasAttribute('data-konat-root')).length,
      element: element.querySelectorAll('[data-konat-root]').length,
      shadow: shadowTarget.querySelectorAll('[data-konat-root]').length,
    });

    const { container, rerender, unmount } = render(<Konat />);
    await flush();

    const inBody = {
      ...hostsIn(),
      rendered: container.innerHTML,
      mode: document.querySelector('[data-konat-root]')?.shadowRoot?.mode,
      pageStyles: document.querySelectorAll('style, link[rel="stylesheet"]').length,
      overlayStyles: overlay().querySelectorAll('style').length,
    };

    rerender(<Konat portalTarget={element} />);
    await flush();
    const inElement = hostsIn();
    rerender(<Konat portalTarget={shadowTarget} />);
    await flush();
    const inShadow = hostsIn();
    unmount();
    expect({ inBody, inElement, inShadow, unmounted: hostsIn() }).toEqual({
      inBody: { body: 1, element: 0, shadow: 0, rendered: '', mode: 'open', pageStyles: 0, overlayStyles: 1 },
      inElement: { body: 0, element: 1, shadow: 0 },
      inShadow: { body: 0, element: 0, shadow: 1 },
      unmounted: { body: 0, element: 0, shadow: 0 },
    });
  });
});

describe('the bubble', () => {
  test('counts the active previews in a badge and in its name', async () => {
    const machine = createToggleMachine();
    await mount(
      <>
        <Run machine={machine} />
        <Run machine={machine} />
      </>,
    );

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
        cart: {},
        payment: {
          // The tree names a state by its path, never by an id like this one.
          id: 'pay',
          initial: 'idle',
          states: {
            idle: {},
            error: {},
            previous: { type: 'history' },
          },
        },
        shipping: {
          type: 'parallel',
          states: {
            speed: {
              initial: 'standard',
              states: { standard: {}, express: { id: 'fast' }, remembered: { type: 'history', history: 'deep' } },
            },
            gift: {},
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

  test('shows every state but history ones, nested', async () => {
    const machine = createEditorMachine();
    await mount(<Run machine={machine} />);
    await show(machine.id);

    expect({
      label: overlay().querySelector('[role="tree"]')?.getAttribute('aria-label'),
      rows: treeRows(),
      leaves: leaves(),
    }).toEqual({
      label: `States of ${machine.id} · 1`,
      rows: [
        'cart',
        'payment',
        '  idle',
        '  error',
        'shipping',
        '  speed',
        '    standard',
        '    express',
        '  gift',
        '  saving',
        '    upload',
        '      pending',
        '      failed',
        '    spinner',
        'done',
      ],
      leaves: EDITOR_LEAVES,
    });
  });

  test('marks the data a preview of each leaf would use, and follows the app', async () => {
    const machine = createCheckoutMachine();
    const fixtures = [defineFixtures(machine, { 'payment.error': { context: { note: 'fixture' } } })];
    await mount(<Checkout machine={machine} />, { fixtures });
    await show(machine.id);

    const started = { marks: marks(), announced: announced() };
    fireEvent.click(screen.getByRole('button', { name: 'Express' }));
    await flush();
    expect({ started, moved: marks() }).toEqual({
      started: {
        // The app recorded the context of its first state as it started.
        marks: {
          'shipping.standard': ['recorded'],
          'shipping.express': ['none'],
          'payment.editing': ['recorded'],
          'payment.error': ['fixture'],
          'payment.success': ['none'],
        },
        announced: {
          'shipping.standard': 'recorded context',
          'shipping.express': 'no recorded or fixture context',
          'payment.editing': 'recorded context',
          'payment.error': 'fixture',
          'payment.success': 'no recorded or fixture context',
        },
      },
      moved: {
        'shipping.standard': ['recorded'],
        'shipping.express': ['recorded'],
        'payment.editing': ['recorded'],
        'payment.error': ['fixture'],
        'payment.success': ['none'],
      },
    });
  });

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
    await mount(<Run machine={machine} />);
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

  test('a machine without states has none to list', async () => {
    const machine = createMachine({ id: freshId('empty') });
    await mount(<Run machine={machine} />);
    await show(machine.id);

    const hint = overlay().querySelector('section[aria-labelledby]')?.querySelector('[data-part="hint"]')?.textContent;
    expect({ machine: shownMachine(), leaves: leaves(), hint }).toEqual({
      machine: machine.id,
      leaves: [],
      hint: 'This machine has no states to list.',
    });
  });

  test('without a machine on the page, the panel says how machines get there', async () => {
    await mount(null);

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

    await mount(<Run machine={machine} />);
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
  test('copies the shown instance as indented JSON: its machine, leaves, preview and context, and says how it went', async () => {
    const machine = createCheckoutMachine();
    await mount(<Checkout machine={machine} />);
    await show(machine.id);

    const footer = () =>
      [...overlay().querySelectorAll('footer button')].map(
        (found) => `${found.getAttribute('aria-label')}: ${found.textContent}`,
      );

    const live = await copy();
    await preview(machine.id, ['payment.error']);
    const previewing = await copy();
    const labels = footer();
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await flush();
    // jsdom has no clipboard, so the status always says the copy failed.
    expect({ live, previewing, labels, later: footer() }).toEqual({
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
      // The button shows the status in place of its label for 2 s, and keeps its name.
      labels: ['Copy JSON: Copy failed'],
      later: ['Copy JSON: Copy JSON'],
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

    await mount(<Run machine={machine} />);
    await show(machine.id);

    const { copied } = await copy();
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

    await mount(<Run machine={machine} />);
    await show(machine.id);

    expect({ copied: (await copy()).copied, context: panel().context }).toEqual({
      copied: ['"[Unserializable: no]"'],
      context: ['boom: "[Unreadable]"'],
    });
  });
});

describe('settings', () => {
  test('the panel remembers whether it is open, its corner and the shown machine, until Back shows the list', async () => {
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

    const second = render(page());
    await flush();
    const reloaded = { open: isOpen(), corner: look().corner, machine: shownMachine() };
    await click(button('Back'));
    second.unmount();
    render(page());
    await flush();
    expect({ first, saved, reloaded, back: { saved: stored(), machine: shownMachine() } }).toEqual({
      first: { open: false, corner: 'bottom-right' },
      saved: { v: 1, open: true, machine: toggle.id, position: 'bottom-left', positionDefault: 'bottom-right' },
      reloaded: { open: true, corner: 'bottom-left', machine: toggle.id },
      back: { saved: { v: 1, open: true, position: 'bottom-left', positionDefault: 'bottom-right' }, machine: 'none' },
    });
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
        'invalid fields next to valid ones',
        '{"v":1,"open":true,"position":"middle","positionDefault":"bottom-right","machine":""}',
        { open: true, corner: 'bottom-right' },
        { v: 1, open: false },
      ],
      [
        'a corner without the position prop it was chosen over',
        '{"v":1,"open":"yes","position":"top-left"}',
        { open: false, corner: 'bottom-right' },
        { v: 1, open: true },
      ],
      [
        'another version',
        '{"v":2,"open":true,"position":"top-left","positionDefault":"bottom-right"}',
        { open: false, corner: 'bottom-right' },
        { v: 1, open: true },
      ],
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
