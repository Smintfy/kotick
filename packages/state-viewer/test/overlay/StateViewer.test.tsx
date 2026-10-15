// <StateViewer /> with the XState adapter: the overlay reads the page's registry, previews through it, and renders in
// a shadow root. Every test renders under StrictMode (test/setup.ts).

import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { createActor, createMachine, setup } from 'xstate';
import { StateViewer } from '../../src/index';
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

function marks(id: string): string[] {
  return [...leaf(id).querySelectorAll<HTMLElement>('.sv-data')].map((mark) => mark.dataset.kind!);
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

beforeEach(() => {
  resetRegistry();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  checkoutMounts = 0;
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe('panel', () => {
  test('lists machines in registration order, and instances as "machine · n"', async () => {
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

  test('clicking a leaf previews it on the selected instance, without remounting the component', async () => {
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

  test('a leaf in another region joins the preview, a previewed leaf leaves it, and the last one releases', async () => {
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

  test('Release ends the instance’s preview, Release all ends every one, and the real state shows again', async () => {
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

  test('shows live context, or the preview’s with its source, and switches the source', async () => {
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

  test('lists child machines read-only under their parent', async () => {
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
});

describe('fixtures', () => {
  test('a lazy loader’s sets register once, and a preview made before they loaded picks them up', async () => {
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
  ])('previews linked machines as they register, so the first paint shows the preview, %s StrictMode', async (_, Wrapper) => {
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

describe('copying', () => {
  let writeText: MockInstance<(text: string) => Promise<void>>;

  beforeEach(() => {
    writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  test('copies a link with each previewed machine’s requested leaves', async () => {
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
});
