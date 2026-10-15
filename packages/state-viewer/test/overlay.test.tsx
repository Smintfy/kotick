import { fireEvent, render, screen } from '@testing-library/react';
import { StateViewer, type Theme } from 'state-viewer';
import { defineFixtures, useMachine } from 'state-viewer/xstate';
import { describe, expect, onTestFinished, test } from 'vitest';
import { createMachine, setup, type AnyStateMachine } from 'xstate';
import {
  copy,
  flush,
  freshId,
  isOpen,
  marks,
  overlay,
  panel,
  preview,
  releaseAll,
  show,
} from './support/panel';

const SETTINGS_KEY = 'state-viewer:ui';

function createCheckoutMachine() {
  return setup({
    types: { context: {} as { note: string }, events: {} as { type: 'EXPRESS' } | { type: 'STANDARD' } },
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
function look(): { corner?: string; theme?: string } {
  const { position, theme } = overlay().querySelector<HTMLElement>('.sv-root')?.dataset ?? {};
  return { corner: position, theme };
}

/** The text of the selected Machine option, or `none` when the panel lists no machine. */
function shownMachine(): string {
  const picker = overlay().querySelector<HTMLSelectElement>('select[aria-label="Machine"]');
  return picker?.selectedOptions[0]?.textContent ?? 'none';
}

/** The shown tree, a row per state: indented by its level, then its key, description, type and tags. */
function treeRows(): string[] {
  return [...overlay().querySelectorAll<HTMLElement>('[role="treeitem"]')].map((item) => {
    const row = item.hasAttribute('data-leaf') ? item : item.firstElementChild;
    const indent = '  '.repeat(Number(item.getAttribute('aria-level')) - 1);
    const key = row?.querySelector('.sv-key')?.textContent;
    const description = row?.querySelector('.sv-description')?.textContent;
    const badges = [...(row?.querySelectorAll('.sv-type, .sv-tag') ?? [])].map((badge) => badge.textContent);
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
      leaf.querySelector('.sv-visually-hidden')?.textContent?.replace(/^, /, ''),
    ]),
  );
}

function stored(): unknown {
  const raw = localStorage.getItem(SETTINGS_KEY);
  return raw === null ? null : JSON.parse(raw);
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

test('the bubble opens a panel that shows the page’s machine, and Close closes it', async () => {
  const machine = createCheckoutMachine();
  render(
    <>
      <Checkout machine={machine} />
      <StateViewer />
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
  const opened = { open: isOpen(), controls: controlled(), machine: shownMachine(), live: panel().live };
  await click(button('Close'));
  expect({ closed, opened, reclosed: { open: isOpen(), controls: controlled() } }).toEqual({
    closed: { open: false, controls: null },
    opened: {
      open: true,
      controls: 'State viewer',
      machine: machine.id,
      live: ['shipping.standard', 'payment.editing'],
    },
    reclosed: { open: false, controls: null },
  });
});

describe('the host element', () => {
  test('is an open shadow root appended to document.body, outside the React tree, and styles only itself', async () => {
    const { container } = render(<StateViewer />);
    await flush();

    const hosts = [...document.querySelectorAll('[data-state-viewer-root]')];
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
      element: element.querySelectorAll('[data-state-viewer-root]').length,
      shadow: shadowTarget.querySelectorAll('[data-state-viewer-root]').length,
      document: document.querySelectorAll('[data-state-viewer-root]').length,
    });

    const { rerender } = render(<StateViewer portalTarget={element} />);
    await flush();
    const inElement = hostsIn();
    rerender(<StateViewer portalTarget={shadowTarget} />);
    await flush();
    expect({ inElement, inShadow: hostsIn() }).toEqual({
      inElement: { element: 1, shadow: 0, document: 1 },
      inShadow: { element: 0, shadow: 1, document: 0 },
    });
  });

  test('is removed when <StateViewer /> unmounts', async () => {
    const { unmount } = render(<StateViewer />);
    await flush();
    const mounted = document.querySelectorAll('[data-state-viewer-root]').length;
    unmount();
    expect({ mounted, unmounted: document.querySelectorAll('[data-state-viewer-root]').length }).toEqual({
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
        <StateViewer defaultOpen />
      </>,
    );
    await flush();
    const badge = () => ({
      badge: overlay().querySelector('.sv-badge')?.textContent ?? null,
      name: bubble().getAttribute('aria-label'),
      highlighted: bubble().hasAttribute('data-previewing'),
    });

    const seen = [badge()];
    await preview(machine.id, ['on'], { nth: 1 });
    seen.push(badge());
    await preview(machine.id, ['on'], { nth: 2 });
    seen.push(badge());
    await releaseAll();
    seen.push(badge());
    expect(seen).toEqual([
      { badge: null, name: 'State viewer', highlighted: false },
      { badge: '1', name: 'State viewer, 1 preview active', highlighted: true },
      { badge: '2', name: 'State viewer, 2 previews active', highlighted: true },
      { badge: null, name: 'State viewer', highlighted: false },
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
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

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
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

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
        <StateViewer defaultOpen fixtures={fixtures} />
      </>,
    );
    await flush();

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

  test('a machine without states has none to list', async () => {
    const machine = createMachine({ id: freshId('empty') });
    render(
      <>
        <Run machine={machine} />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

    const hint = overlay().querySelector('.sv-section')?.querySelector('.sv-hint')?.textContent;
    expect({ machine: shownMachine(), leaves: leaves(), hint }).toEqual({
      machine: machine.id,
      leaves: [],
      hint: 'This machine has no states to list.',
    });
  });

  test('without a machine on the page, the panel says how machines get there', async () => {
    render(<StateViewer defaultOpen />);
    await flush();

    expect({ machine: shownMachine(), body: overlay().querySelector('.sv-body')?.textContent }).toEqual({
      machine: 'none',
      body:
        'No machines yet. Hooks from state-viewer/xstate register their actors as they mount, and connect() ' +
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
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

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
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

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
    const cycle: Record<string, unknown> = { name: 'loop' };
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
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

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
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

    expect({ copied: (await copy('Copy JSON')).copied, context: panel().context }).toEqual({
      copied: ['"[Unserializable: no]"'],
      context: ['boom: "[Unreadable]"'],
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
        <StateViewer />
      </>
    );
    const { unmount } = render(page());
    await flush();
    const first = { open: isOpen(), corner: look().corner };
    await click(bubble());
    await show(toggle.id);
    await click(button('Move to the next corner'));
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

  test('Move to the next corner goes clockwise', async () => {
    render(<StateViewer defaultOpen />);
    await flush();

    const corners: (string | undefined)[] = [];
    for (let step = 0; step < 4; step += 1) {
      await click(button('Move to the next corner'));
      corners.push(look().corner);
    }
    expect(corners).toEqual(['bottom-left', 'top-left', 'top-right', 'bottom-right']);
  });

  test('a stored corner applies only while the position prop is the one the user moved away from', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ v: 1, position: 'top-left', positionDefault: 'bottom-right' }));
    const { rerender } = render(<StateViewer />);
    await flush();

    const corners = [look().corner];
    rerender(<StateViewer position="top-right" />);
    corners.push(look().corner);
    rerender(<StateViewer position="bottom-right" />);
    corners.push(look().corner);
    expect(corners).toEqual(['top-left', 'top-right', 'top-left']);
  });

  test('without a stored corner, the position prop places the overlay', async () => {
    render(<StateViewer position="top-right" />);
    await flush();
    expect(look().corner).toBe('top-right');
  });

  test('defaultOpen applies until the user opens or closes the panel', async () => {
    const { unmount } = render(<StateViewer defaultOpen />);
    await flush();
    const first = { open: isOpen(), saved: stored() };
    await click(button('Close'));
    unmount();

    render(<StateViewer defaultOpen />);
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
      render(<StateViewer />);
      await flush();

      const before = { open: isOpen(), corner: look().corner };
      await click(bubble());
      expect({ before, saved: stored() }).toEqual({ before: shown, saved });
    });
  });
});

test('the theme prop sets the color scheme, and an unknown theme follows the system', async () => {
  const { rerender } = render(<StateViewer />);
  await flush();

  const themes = [look().theme];
  for (const theme of ['light', 'dark', 'neon']) {
    rerender(<StateViewer theme={theme as Theme} />);
    themes.push(look().theme);
  }
  expect(themes).toEqual(['system', 'light', 'dark', 'system']);
});
