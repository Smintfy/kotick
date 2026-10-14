// <StateViewer /> with the XState adapter: the overlay reads the page's registry, previews through it, and renders in
// a shadow root (spec §6.5, §10.6). Every test renders under StrictMode (test/setup.ts).

import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { createActor, createMachine, setup } from 'xstate';
import type { MachineHandle } from '../../src/core/types';
import { StateViewer } from '../../src/index';
import { SETTINGS_KEY } from '../../src/overlay/settings';
import { connect, defineFixtures, useMachine } from '../../src/xstate';
import { flush, handlesOf, keyOf, registry, resetRegistry } from '../xstate/helpers';

const checkoutMachine = setup({
  types: {
    context: {} as { note: string },
    events: {} as { type: 'PAY' } | { type: 'RETRY' } | { type: 'EXPRESS' },
  },
}).createMachine({
  id: 'checkout',
  type: 'parallel',
  context: { note: 'live' },
  states: {
    shipping: {
      initial: 'standard',
      on: { EXPRESS: '.express' },
      states: {
        standard: { description: 'Free, 3 to 5 days' },
        express: {},
      },
    },
    payment: {
      initial: 'editing',
      states: {
        editing: { on: { PAY: 'processing' } },
        processing: { tags: ['busy'] },
        error: { on: { RETRY: 'processing' } },
        success: { type: 'final' },
        last: { type: 'history' },
      },
    },
  },
});

const toggleMachine = createMachine({
  id: 'toggle',
  initial: 'off',
  context: { flips: 0 },
  states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } },
});

const fetcherMachine = createMachine({ id: 'fetcher', initial: 'loading', states: { loading: {}, failed: {} } });
const parentMachine = setup({ actors: { fetcher: fetcherMachine } }).createMachine({
  id: 'parent',
  initial: 'active',
  states: { active: { invoke: { id: 'load', src: 'fetcher' } } },
});

let checkoutMounts = 0;

function Checkout() {
  const [snapshot, send] = useMachine(checkoutMachine);
  const mounted = React.useRef(false);
  // Refs survive StrictMode's simulated unmount, so this counts real mounts only.
  React.useLayoutEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    checkoutMounts += 1;
  });
  return (
    <div>
      <p data-testid="checkout">{JSON.stringify(snapshot.value)}</p>
      <p data-testid="note">{snapshot.context.note}</p>
      <button type="button" onClick={() => send({ type: 'RETRY' })}>
        Retry
      </button>
      <button type="button" onClick={() => send({ type: 'EXPRESS' })}>
        Express
      </button>
      <input aria-label="Card number" />
    </div>
  );
}

function Toggle({ label }: { label?: string }) {
  const [snapshot] = useMachine(toggleMachine, label ? { debug: { label } } : undefined);
  return <span data-testid="toggle">{String(snapshot.value)}</span>;
}

function Parent() {
  useMachine(parentMachine);
  return null;
}

// Helpers for the overlay, which lives in a shadow root that Testing Library's screen doesn't reach.

function host(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-state-viewer-root]');
  if (!element) throw new Error('No overlay host on the page.');
  return element;
}

function $<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  return host().shadowRoot!.querySelector<T>(selector);
}

function $$<T extends HTMLElement = HTMLElement>(selector: string): T[] {
  return [...host().shadowRoot!.querySelectorAll<T>(selector)];
}

function bubble(): HTMLButtonElement {
  return $<HTMLButtonElement>('.sv-bubble')!;
}

function panel(): HTMLElement | null {
  return $('.sv-panel');
}

function button(name: string): HTMLButtonElement {
  const found = $$<HTMLButtonElement>('button').find(
    (candidate) => candidate.textContent === name || candidate.getAttribute('aria-label') === name,
  );
  if (!found) throw new Error(`No "${name}" button in the overlay.`);
  return found;
}

function select(label: 'Machine' | 'Instance'): HTMLSelectElement {
  return $<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
}

function options(label: 'Machine' | 'Instance'): string[] {
  return [...select(label).options].map((option) => option.textContent ?? '');
}

function leaf(id: string): HTMLElement {
  const found = $$('[data-leaf]').find((item) => item.dataset.leaf === id);
  if (!found) throw new Error(`No "${id}" leaf in the tree.`);
  return found;
}

function leafIds(): string[] {
  return $$('[data-leaf]').map((item) => item.dataset.leaf!);
}

function marks(id: string): string[] {
  return [...leaf(id).querySelectorAll<HTMLElement>('.sv-data')].map((mark) => mark.dataset.kind!);
}

function logEntries(): string[] {
  return $$('.sv-log-entry').map((entry) => entry.textContent ?? '');
}

async function click(element: HTMLElement): Promise<void> {
  fireEvent.click(element);
  await flush();
}

async function openPanel(): Promise<void> {
  if (!panel()) await click(bubble());
  expect(panel()).not.toBeNull();
}

async function chooseMachine(machineId: string): Promise<void> {
  fireEvent.change(select('Machine'), { target: { value: machineId } });
  await flush();
}

function onlyKey(machineId: string): string {
  const handles = handlesOf(machineId);
  expect(handles).toHaveLength(1);
  return keyOf(handles[0]);
}

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  resetRegistry();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  checkoutMounts = 0;
  // Previews of states without a recording or fixture warn about falling back to live context.
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe('host', () => {
  test('renders into an open shadow root appended to document.body, not into the React tree (R20)', async () => {
    const { container } = render(<StateViewer />);
    await flush();

    expect(container.innerHTML).toBe('');
    const element = host();
    expect(element.parentElement).toBe(document.body);
    expect(element.shadowRoot?.mode).toBe('open');
    expect(document.querySelectorAll('[data-state-viewer-root]')).toHaveLength(1);
    // The styles live in the shadow root, and reset the host itself against page styles.
    expect(document.head.querySelector('style')).toBeNull();
    expect($('style')?.textContent).toMatch(/:host \{\s*all: initial !important;/);
    expect(bubble()).not.toBeNull();
  });

  test('appends the host to portalTarget, an element or a shadow root', async () => {
    const element = document.createElement('section');
    document.body.append(element);
    const { rerender } = render(<StateViewer portalTarget={element} />);
    await flush();
    expect(host().parentNode).toBe(element);

    const outer = document.createElement('div');
    document.body.append(outer);
    const shadowTarget = outer.attachShadow({ mode: 'open' });
    rerender(<StateViewer portalTarget={shadowTarget} />);
    await flush();
    expect(element.children).toHaveLength(0);
    expect(shadowTarget.querySelector('[data-state-viewer-root]')).not.toBeNull();

    element.remove();
    outer.remove();
  });

  test('removes the host on unmount', async () => {
    const { unmount } = render(<StateViewer />);
    await flush();
    unmount();
    expect(document.querySelector('[data-state-viewer-root]')).toBeNull();
  });
});

describe('toolbar', () => {
  test('shows a badge with the number of previews while any is active (R21)', async () => {
    render(
      <>
        <Toggle />
        <Toggle />
        <StateViewer />
      </>,
    );
    await flush();
    expect($('.sv-badge')).toBeNull();
    expect(bubble().getAttribute('aria-label')).toBe('State viewer');

    const [first, second] = handlesOf('toggle').map(keyOf);
    act(() => {
      registry().preview(first, { leaves: ['on'] });
      registry().preview(second, { leaves: ['on'] });
    });
    await flush();
    expect($('.sv-badge')?.textContent).toBe('2');
    expect(bubble().getAttribute('aria-label')).toBe('State viewer, 2 previews active');
    expect(bubble().hasAttribute('data-previewing')).toBe(true);

    act(() => registry().release());
    await flush();
    expect($('.sv-badge')).toBeNull();
  });

  test('opens and closes the panel', async () => {
    render(<StateViewer />);
    await flush();
    expect(panel()).toBeNull();
    expect(bubble().getAttribute('aria-expanded')).toBe('false');

    await click(bubble());
    expect(panel()).not.toBeNull();
    expect(bubble().getAttribute('aria-expanded')).toBe('true');
    expect(bubble().getAttribute('aria-controls')).toBe(panel()!.id);

    await click(button('Close'));
    expect(panel()).toBeNull();
  });
});

describe('panel', () => {
  test('lists machines in registration order, and instances as "machine · n" (R3, R22)', async () => {
    const actor = createActor(toggleMachine).start();
    const app = connect(actor, { id: 'app' });
    render(
      <>
        <Checkout />
        <Toggle />
        <Toggle label="Second toggle" />
        <StateViewer />
      </>,
    );
    await flush();
    await openPanel();

    // connect() registered first, so its machine is selected until the user picks another.
    expect(options('Machine')).toEqual(['app', 'checkout', 'toggle (2)']);
    expect(select('Machine').value).toBe('app');
    expect(select('Instance').disabled).toBe(true);

    await chooseMachine('toggle');
    expect(options('Instance')).toEqual(['toggle · 1', 'Second toggle · 2']);
    expect(select('Instance').disabled).toBe(false);

    act(() => registry().preview(keyOf(handlesOf('toggle')[1]), { leaves: ['on'] }));
    await flush();
    expect(options('Machine')).toEqual(['app', 'checkout', 'toggle (2) ●']);
    expect(options('Instance')).toEqual(['toggle · 1', 'Second toggle · 2 ●']);
    app.stop();
  });

  test('shows the selected instance’s tree: every state but history, with descriptions and tags (R6, R8)', async () => {
    render(
      <>
        <Checkout />
        <StateViewer />
      </>,
    );
    await flush();
    await openPanel();

    expect(leafIds()).toEqual([
      'shipping.standard',
      'shipping.express',
      'payment.editing',
      'payment.processing',
      'payment.error',
      'payment.success',
    ]);
    const groups = $$('.sv-group > .sv-node .sv-key').map((key) => key.textContent);
    expect(groups).toEqual(['shipping', 'payment']);
    expect($('[role="tree"]')?.getAttribute('aria-label')).toBe('States of checkout · 1');
    expect(leaf('shipping.standard').querySelector('.sv-description')?.textContent).toBe('Free, 3 to 5 days');
    expect(leaf('payment.processing').querySelector('.sv-tag')?.textContent).toBe('busy');
    expect(leaf('payment.success').querySelector('.sv-type')?.textContent).toBe('final');
  });

  test('marks the live leaves and which data a preview of each leaf would use (R7, R19)', async () => {
    render(
      <>
        <Checkout />
        <StateViewer
          fixtures={[defineFixtures(checkoutMachine, { 'payment.error': { context: { note: 'fixture' } } })]}
        />
      </>,
    );
    await flush();
    await openPanel();

    const live = $$('[data-leaf][data-active]').map((item) => item.dataset.leaf);
    expect(live).toEqual(['shipping.standard', 'payment.editing']);
    // The initial configuration was recorded as the actor started.
    expect(marks('shipping.standard')).toEqual(['recorded']);
    expect(marks('payment.error')).toEqual(['fixture']);
    expect(marks('payment.success')).toEqual(['none']);
    expect(leaf('payment.success').textContent).toContain('no recorded or fixture context');

    // Live changes follow without anything in the registry snapshot changing.
    fireEvent.click(screen.getByRole('button', { name: 'Express' }));
    await flush();
    expect($$('[data-leaf][data-active]').map((item) => item.dataset.leaf)).toEqual([
      'shipping.express',
      'payment.editing',
    ]);
    expect(marks('shipping.express')).toEqual(['recorded']);
  });

  test('clicking a leaf previews it on the selected instance, without remounting the component (R9, R10)', async () => {
    render(
      <>
        <Checkout />
        <StateViewer />
      </>,
    );
    await flush();
    await openPanel();
    const key = onlyKey('checkout');

    await click(leaf('payment.error'));
    expect(registry().getOverride(key)).toMatchObject({
      requested: ['payment.error'],
      leaves: ['payment.error', 'shipping.standard'],
    });
    expect(screen.getByTestId('checkout').textContent).toBe('{"shipping":"standard","payment":"error"}');
    expect(checkoutMounts).toBe(1);
    expect(leaf('payment.error').getAttribute('aria-selected')).toBe('true');
    expect(leaf('payment.error').querySelector('.sv-pin')).not.toBeNull();
    // The untouched region keeps its current leaf, which the preview shows.
    expect(leaf('shipping.standard').hasAttribute('data-filled')).toBe(true);
    expect($('.sv-title-count')?.textContent).toBe('1 previewing');
  });

  test('a leaf in another region joins the preview, a previewed leaf leaves it, and the last one releases (R9)', async () => {
    render(
      <>
        <Checkout />
        <StateViewer />
      </>,
    );
    await flush();
    await openPanel();
    const key = onlyKey('checkout');

    await click(leaf('payment.error'));
    await click(leaf('shipping.express'));
    expect(registry().getOverride(key)?.requested).toEqual(['shipping.express', 'payment.error']);

    // A leaf of the same region replaces the one there.
    await click(leaf('payment.success'));
    expect(registry().getOverride(key)?.requested).toEqual(['payment.success', 'shipping.express']);
    expect(screen.getByTestId('checkout').textContent).toBe('{"shipping":"express","payment":"success"}');

    await click(leaf('payment.success'));
    expect(registry().getOverride(key)?.requested).toEqual(['shipping.express']);
    await click(leaf('shipping.express'));
    expect(registry().getOverride(key)).toBeUndefined();
    expect(screen.getByTestId('checkout').textContent).toBe('{"shipping":"standard","payment":"editing"}');
    expect(checkoutMounts).toBe(1);
  });

  test('lists events sent during a preview, newest first, and Clear empties the log (R12)', async () => {
    render(
      <>
        <Checkout />
        <StateViewer />
      </>,
    );
    await flush();
    await openPanel();
    expect(button('Clear').disabled).toBe(true);

    await click(leaf('payment.error'));
    await click(screen.getByRole('button', { name: 'Retry' }));
    await click(screen.getByRole('button', { name: 'Express' }));

    // Blocked: the preview still shows, and the real actor didn't move.
    expect(screen.getByTestId('checkout').textContent).toBe('{"shipping":"standard","payment":"error"}');
    const entries = logEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatch(/^EXPRESS\d\d:\d\d:\d\d\.\d{3}checkout · 1 · in payment\.error, shipping\.standard$/);
    expect(entries[1]).toMatch(/^RETRY/);
    expect($$('.sv-section-title').map((title) => title.textContent)).toContain('Blocked events (2)');

    await click(button('Clear'));
    expect(logEntries()).toEqual([]);
  });

  test('Release ends the instance’s preview, Release all ends every one, and the real state shows again (R13, R14)', async () => {
    render(
      <>
        <Checkout />
        <Toggle />
        <StateViewer />
      </>,
    );
    await flush();
    await openPanel();
    act(() => registry().preview(onlyKey('toggle'), { leaves: ['on'] }));
    await click(leaf('payment.error'));
    expect(screen.getByTestId('toggle').textContent).toBe('on');

    await click(button('Release'));
    expect(registry().getOverride(onlyKey('checkout'))).toBeUndefined();
    expect(screen.getByTestId('checkout').textContent).toBe('{"shipping":"standard","payment":"editing"}');
    expect(registry().getOverride(onlyKey('toggle'))).toBeDefined();
    expect(() => button('Release')).toThrow();

    await click(button('Release all'));
    expect(registry().getSnapshot().overrides).toEqual({});
    expect(screen.getByTestId('toggle').textContent).toBe('off');
    expect(button('Release all').disabled).toBe(true);
  });

  test('shows live context, or the preview’s with its source, and switches the source (R16)', async () => {
    render(
      <>
        <Checkout />
        <StateViewer
          fixtures={[defineFixtures(checkoutMachine, { 'payment.error': { context: { note: 'fixture' } } })]}
        />
      </>,
    );
    await flush();
    await openPanel();
    const json = () => $('[data-testid="sv-json"]')?.textContent;
    expect(json()).toBe('note: "live"');
    expect($('.sv-source')?.textContent).toBe('live');

    await click(leaf('payment.error'));
    expect(json()).toBe('note: "fixture"');
    expect(screen.getByTestId('note').textContent).toBe('fixture');
    const radios = $$<HTMLInputElement>('.sv-segment input');
    expect(radios.map((radio) => [radio.value, radio.checked, radio.disabled])).toEqual([
      ['recorded', false, true],
      ['fixture', true, false],
      ['live', false, false],
    ]);

    await click(radios[2]);
    const key = onlyKey('checkout');
    expect(registry().getOverride(key)).toMatchObject({ requested: ['payment.error'], source: 'live' });
    expect(json()).toBe('note: "live"');
    expect(screen.getByTestId('note').textContent).toBe('live');
    // Chosen, not a fallback, so there's no warning in the panel.
    expect($('.sv-section .sv-warning')).toBeNull();

    await click(leaf('payment.success'));
    expect($('.sv-section .sv-warning')?.textContent).toMatch(/No recording or fixture for this state/);
  });

  test('lists child machines read-only under their parent (R5)', async () => {
    render(
      <>
        <Parent />
        <StateViewer />
      </>,
    );
    await flush();
    await openPanel();
    expect(options('Machine')).toEqual(['parent', 'fetcher (child)']);

    await click(button('load · 1'));
    expect(select('Machine').value).toBe('fetcher');
    expect($('.sv-hint')?.textContent).toBe('Child of parent · 1. Child machines are listed read-only.');
    expect(leaf('loading').getAttribute('aria-disabled')).toBe('true');

    await click(leaf('failed'));
    expect(registry().getSnapshot().overrides).toEqual({});
  });

  test('keeps rendering when an adapter throws', async () => {
    const broken: MachineHandle = {
      machineId: 'broken',
      instanceId: 'b1',
      adapter: 'test',
      capabilities: { preview: true, live: false, children: false },
      describe: () => {
        throw new Error('describe');
      },
      getActiveLeaves: () => {
        throw new Error('leaves');
      },
      getContext: () => {
        throw new Error('context');
      },
      subscribe: () => {
        throw new Error('subscribe');
      },
      normalizeTarget: (leaves) => leaves,
    };
    act(() => {
      registry().register(broken);
    });
    render(<StateViewer />);
    await flush();
    await openPanel();

    expect(select('Machine').value).toBe('broken');
    expect($('.sv-body')?.textContent).toContain('This machine has no states to list.');
  });

  test('says so when no machine is registered', async () => {
    render(<StateViewer defaultOpen />);
    await flush();
    expect($('.sv-empty')?.textContent).toMatch(/^No machines yet/);
    expect(select('Machine')).toBeNull();
  });
});

describe('fixtures', () => {
  test('a lazy loader’s sets register once, and a preview made before they loaded picks them up (R16, R18)', async () => {
    let resolve!: (module: { default: unknown[] }) => void;
    const loader = vi.fn(() => new Promise<{ default: unknown[] }>((done) => (resolve = done)));
    const registerFixtures = vi.spyOn(registry(), 'registerFixtures');
    render(
      <>
        <Checkout />
        <StateViewer fixtures={loader as never} />
      </>,
    );
    await flush();
    await openPanel();
    await click(leaf('payment.error'));
    expect(registry().getOverride(onlyKey('checkout'))?.source).toBe('live');

    await act(async () => resolve({ default: [defineFixtures(checkoutMachine, { 'payment.error': { context: { note: 'late' } } })] }));
    await flush();
    expect(registry().getOverride(onlyKey('checkout'))).toMatchObject({ source: 'fixture', context: { note: 'late' } });
    expect(screen.getByTestId('note').textContent).toBe('late');
    expect(marks('payment.error')).toEqual(['fixture']);
    // StrictMode ran the effect twice; the set registered once.
    expect(registerFixtures).toHaveBeenCalledTimes(1);
  });
});

describe('deep links', () => {
  // Without StrictMode too: its second run of effects registers the instance again after every effect has run, which
  // would hide a link applied too late.
  test.each([
    ['with', React.StrictMode],
    ['without', React.Fragment],
  ])('previews linked machines as they register, so the first paint shows the preview, %s StrictMode (R27, §10.2)', async (_, Wrapper) => {
    window.history.replaceState(null, '', '/?debug-state=checkout:payment.error;shipping.express');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previous = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      // The DOM at the end of the task that commits the mount, where the browser paints.
      const painted = await new Promise<string | null>((resolve) => {
        function EndOfCommit() {
          React.useLayoutEffect(() => queueMicrotask(() => resolve(container.querySelector('p')?.textContent ?? null)), []);
          return null;
        }
        root.render(
          <Wrapper>
            <Checkout />
            <StateViewer />
            <EndOfCommit />
          </Wrapper>,
        );
      });
      expect(painted).toBe('{"shipping":"express","payment":"error"}');
    } finally {
      root.unmount();
      container.remove();
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previous;
    }
  });

  test('previews actors registered before the overlay mounted, such as connect()ed ones', async () => {
    const actor = connect(createActor(toggleMachine).start(), { id: 'app' });
    window.history.replaceState(null, '', '/?other=1&debug-state=app:on');
    render(<StateViewer />);
    await flush();
    expect(actor.getSnapshot().value).toBe('on');
    expect(registry().getOverride(onlyKey('app'))?.requested).toEqual(['on']);
    actor.stop();
  });

  test('reads the urlParam prop', async () => {
    window.history.replaceState(null, '', '/?debug-state=toggle:on&state=toggle:off');
    render(
      <>
        <Toggle />
        <StateViewer urlParam="state" />
      </>,
    );
    await flush();
    // 'off' is the live leaf, but the preview still applies, and blocks events.
    expect(registry().getOverride(onlyKey('toggle'))?.requested).toEqual(['off']);
    expect(screen.getByTestId('toggle').textContent).toBe('off');
  });

  test('isn’t applied again when the overlay remounts after the user released it', async () => {
    window.history.replaceState(null, '', '/?debug-state=toggle:on');
    const { rerender } = render(
      <>
        <Toggle />
        <StateViewer key="a" />
      </>,
    );
    await flush();
    expect(screen.getByTestId('toggle').textContent).toBe('on');

    act(() => registry().release());
    rerender(
      <>
        <Toggle />
        <StateViewer key="b" />
      </>,
    );
    await flush();
    expect(screen.getByTestId('toggle').textContent).toBe('off');
  });
});

describe('keyboard', () => {
  test('Alt+S toggles the panel from anywhere except while typing (R23)', async () => {
    render(
      <>
        <Checkout />
        <StateViewer />
      </>,
    );
    await flush();

    fireEvent.keyDown(screen.getByLabelText('Card number'), { key: 's', code: 'KeyS', altKey: true });
    await flush();
    expect(panel()).toBeNull();

    const outside = screen.getByRole('button', { name: 'Retry' });
    outside.focus();
    fireEvent.keyDown(outside, { key: 'ß', code: 'KeyS', altKey: true });
    await flush();
    expect(panel()).not.toBeNull();
    // Focus moves into the panel, on the tree's tab stop, so its keys work at once.
    expect(host().shadowRoot!.activeElement).toBe(leaf('shipping.standard'));

    fireEvent.keyDown(host().shadowRoot!.activeElement!, { key: 's', code: 'KeyS', altKey: true });
    await flush();
    expect(panel()).toBeNull();
    // Back where the shortcut was pressed.
    expect(document.activeElement).toBe(outside);
  });

  test('the shortcut can be changed or turned off', async () => {
    const { rerender } = render(<StateViewer shortcut="ctrl+shift+d" />);
    await flush();
    fireEvent.keyDown(window, { key: 's', code: 'KeyS', altKey: true });
    await flush();
    expect(panel()).toBeNull();
    fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
    await flush();
    expect(panel()).not.toBeNull();
    expect(button('Close').title).toBe('Close (Ctrl+Shift+D)');

    rerender(<StateViewer shortcut={false} />);
    fireEvent.keyDown(window, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
    await flush();
    expect(panel()).not.toBeNull();

    rerender(<StateViewer shortcut="hyper+x" />);
    await flush();
    expect(warn).toHaveBeenCalledWith('[state-viewer] Ignoring the shortcut "hyper+x": expected something like "alt+s".');
  });

  test('arrows move through the leaves, Enter previews or releases, Escape releases all', async () => {
    render(
      <>
        <Checkout />
        <Toggle />
        <StateViewer />
      </>,
    );
    await flush();
    act(() => registry().preview(onlyKey('toggle'), { leaves: ['on'] }));
    fireEvent.keyDown(window, { key: 's', code: 'KeyS', altKey: true });
    await flush();
    const focused = () => host().shadowRoot!.activeElement as HTMLElement;
    expect(focused().dataset.leaf).toBe('shipping.standard');

    fireEvent.keyDown(focused(), { key: 'ArrowDown' });
    fireEvent.keyDown(focused(), { key: 'ArrowDown' });
    fireEvent.keyDown(focused(), { key: 'ArrowUp' });
    await flush();
    expect(focused().dataset.leaf).toBe('shipping.express');
    expect(focused().tabIndex).toBe(0);
    expect(leaf('shipping.standard').tabIndex).toBe(-1);

    fireEvent.keyDown(focused(), { key: 'End' });
    await flush();
    expect(focused().dataset.leaf).toBe('payment.success');
    fireEvent.keyDown(focused(), { key: 'Enter' });
    await flush();
    expect(registry().getOverride(onlyKey('checkout'))?.requested).toEqual(['payment.success']);
    fireEvent.keyDown(focused(), { key: 'Enter' });
    await flush();
    expect(registry().getOverride(onlyKey('checkout'))).toBeUndefined();

    // Keys that a control handles itself stay with it.
    fireEvent.keyDown(select('Machine'), { key: 'ArrowDown' });
    fireEvent.keyDown(button('Close'), { key: 'Enter' });
    await flush();
    expect(registry().getOverride(onlyKey('checkout'))).toBeUndefined();

    fireEvent.keyDown(focused(), { key: 'Home' });
    fireEvent.keyDown(focused(), { key: 'Enter' });
    await flush();
    expect(Object.keys(registry().getSnapshot().overrides)).toHaveLength(2);
    fireEvent.keyDown(focused(), { key: 'Escape' });
    await flush();
    expect(registry().getSnapshot().overrides).toEqual({});
  });

  test('[ and ] switch to the previous and next machine', async () => {
    render(
      <>
        <Checkout />
        <Toggle />
        <Parent />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();
    expect(select('Machine').value).toBe('checkout');

    fireEvent.keyDown(panel()!, { key: ']' });
    await flush();
    expect(select('Machine').value).toBe('toggle');
    fireEvent.keyDown(panel()!, { key: '[' });
    fireEvent.keyDown(panel()!, { key: '[' });
    await flush();
    expect(select('Machine').value).toBe('fetcher');
  });

  test('switching machines from the tree keeps focus in the new tree', async () => {
    render(
      <>
        <Checkout />
        <Toggle />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();
    leaf('payment.error').focus();

    fireEvent.keyDown(leaf('payment.error'), { key: ']' });
    await flush();
    expect(select('Machine').value).toBe('toggle');
    // The live leaf is the new tab stop.
    expect(host().shadowRoot!.activeElement).toBe(leaf('off'));

    fireEvent.keyDown(leaf('off'), { key: '[' });
    await flush();
    expect(select('Machine').value).toBe('checkout');
    expect(host().shadowRoot!.activeElement).toBe(leaf('shipping.standard'));
  });
});

describe('persistence', () => {
  test('remembers whether the panel is open, its corner and the selected machine (R24)', async () => {
    const { unmount } = render(
      <>
        <Checkout />
        <Toggle />
        <StateViewer />
      </>,
    );
    await flush();
    expect($('.sv-root')?.dataset.position).toBe('bottom-right');
    await openPanel();
    await chooseMachine('toggle');
    await click(button('Move to the next corner'));
    expect($('.sv-root')?.dataset.position).toBe('bottom-left');
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!)).toEqual({
      v: 1,
      open: true,
      machine: 'toggle',
      position: 'bottom-left',
      positionDefault: 'bottom-right',
    });
    unmount();

    render(
      <>
        <Checkout />
        <Toggle />
        <StateViewer />
      </>,
    );
    await flush();
    expect(panel()).not.toBeNull();
    expect(select('Machine').value).toBe('toggle');
    expect($('.sv-root')?.dataset.position).toBe('bottom-left');
  });

  test('a stored corner gives way when the position prop changes', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ v: 1, position: 'top-left', positionDefault: 'bottom-right' }));
    const { rerender } = render(<StateViewer />);
    await flush();
    expect($('.sv-root')?.dataset.position).toBe('top-left');
    rerender(<StateViewer position="top-right" />);
    expect($('.sv-root')?.dataset.position).toBe('top-right');
  });

  test('defaultOpen applies until the user opens or closes the panel', async () => {
    const { unmount } = render(<StateViewer defaultOpen />);
    await flush();
    expect(panel()).not.toBeNull();
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
    await click(button('Close'));
    unmount();

    render(<StateViewer defaultOpen />);
    await flush();
    expect(panel()).toBeNull();
  });
});

describe('copying', () => {
  let writeText: MockInstance<(text: string) => Promise<void>>;

  beforeEach(() => {
    writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  test('copies a link with each previewed machine’s requested leaves (R26, §10.4)', async () => {
    window.history.replaceState(null, '', '/shop?tab=1#top');
    render(
      <>
        <Checkout />
        <Toggle />
        <Toggle />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();
    expect(button('Copy link').disabled).toBe(true);

    await click(leaf('payment.error'));
    await click(leaf('shipping.express'));
    act(() => registry().preview(keyOf(handlesOf('toggle')[1]), { leaves: ['on'] }));
    await flush();
    expect($('.sv-footer .sv-warning')?.textContent).toMatch(/won’t reproduce the current “toggle” previews exactly/);

    await click(button('Copy link'));
    expect(writeText).toHaveBeenCalledWith(
      'http://localhost:3000/shop?tab=1&debug-state=checkout:shipping.express;payment.error,toggle:on#top',
    );
    expect($('.sv-status')?.textContent).toBe('Link copied');
  });

  test('copies the selected instance as JSON (R26)', async () => {
    render(
      <>
        <Checkout />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();
    await click(button('Copy JSON'));
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual({
      machine: 'checkout',
      instance: 'checkout · 1',
      leaves: ['shipping.standard', 'payment.editing'],
      preview: null,
      context: { note: 'live' },
    });

    await click(leaf('payment.error'));
    await click(button('Copy JSON'));
    expect(JSON.parse(writeText.mock.calls[1][0])).toMatchObject({
      leaves: ['payment.error', 'shipping.standard'],
      preview: { requested: ['payment.error'], source: 'live' },
    });
    expect($('.sv-status')?.textContent).toBe('JSON copied');
  });
});

test('the theme prop sets the overlay’s color scheme (R25)', async () => {
  const { rerender } = render(<StateViewer />);
  await flush();
  expect($('.sv-root')?.dataset.theme).toBe('system');
  rerender(<StateViewer theme="dark" />);
  expect($('.sv-root')?.dataset.theme).toBe('dark');
  rerender(<StateViewer theme={'neon' as never} />);
  expect($('.sv-root')?.dataset.theme).toBe('system');
});
