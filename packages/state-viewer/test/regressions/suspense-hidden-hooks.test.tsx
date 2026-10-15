// Suspense hiding content it already showed is not an unmount: when a sibling suspends on an update outside a
// transition (a React.lazy dialog opening, a suspense query given a new key), React shows the fallback and keeps the
// hidden tree, its state and its passive effects, so the actor @xstate/react started keeps running. The hooks keep
// that actor registered (hooks unregister on unmount), in its place in the list, previewed, and recorded
// while the content is hidden. A preview started, changed or released while the content
// is hidden shows once it is revealed, in the component and in the observer given to useActorRef. This
// holds with and without StrictMode, whose extra effect pass on revealed content restarts the actor. A label change,
// which registers the instance again, keeps it listed in place and previewed; a real unmount still unregisters it.

import { act, render, screen, type RenderResult } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SimulatedClock, createMachine, type AnyActorRef } from 'xstate';
import { useActorRef, useMachine } from '../../src/xstate';
import { flush, handlesOf, keyOf, registry, resetRegistry } from '../xstate/helpers';

/** `stuck` exists to be previewed. */
const toggleMachine = createMachine({
  id: 'toggle',
  initial: 'off',
  states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } }, stuck: {} },
});

/** Moves on by itself: loading, then loaded after a second, then settled after another. */
const loaderMachine = createMachine({
  id: 'loader',
  initial: 'loading',
  states: { loading: { after: { 1000: 'loaded' } }, loaded: { after: { 1000: 'settled' } }, settled: {} },
});

const actors: Record<string, AnyActorRef> = {};
/** The values the observer given to useActorRef was sent, in order. */
const observed: unknown[] = [];
let clock: SimulatedClock;

function Toggle({ name, label = name }: { name: string; label?: string }) {
  const [snapshot, , actorRef] = useMachine(toggleMachine, { debug: { label } });
  actors[name] = actorRef;
  return <output data-testid={name}>{String(snapshot.value)}</output>;
}

function Observed() {
  actors.observed = useActorRef(toggleMachine, { debug: { label: 'observed' } }, (snapshot) =>
    observed.push(snapshot.value),
  );
  return null;
}

function Loader() {
  const [snapshot] = useMachine(loaderMachine, { clock });
  return <output data-testid="loader">{String(snapshot.value)}</output>;
}

/** A dialog's code, loading or loaded. */
type DialogCode = { promise: Promise<void>; loaded: boolean };

/**
 * Stands in for a React.lazy dialog: throws its pending import, as React.lazy does, until its code has loaded. (With
 * React.use instead, an update to the hidden content while the code loads keeps the fallback showing in this test
 * environment, whatever the component, even one with only useState.)
 */
function Dialog({ code }: { code: DialogCode }) {
  if (!code.loaded) throw code.promise;
  return <p>dialog</p>;
}

type AppProps = { dialog?: DialogCode; withHidden?: boolean; hiddenLabel?: string; withLoader?: boolean };

/** Hook actors inside a Suspense boundary, around where the dialog suspends, and one outside it. */
function App({ dialog, withHidden = true, hiddenLabel, withLoader = false }: AppProps) {
  return (
    <>
      <React.Suspense fallback={<p>fallback</p>}>
        {withHidden ? <Toggle name="hidden" label={hiddenLabel} /> : null}
        <Observed />
        {withLoader ? <Loader /> : null}
        {dialog ? <Dialog code={dialog} /> : null}
      </React.Suspense>
      <Toggle name="outside" />
    </>
  );
}

const labels = () => handlesOf('toggle').map(({ label }) => label);
const shownIn = (name: string) => screen.getByTestId(name).textContent;

function keyOfLabel(label: string): string {
  const handle = handlesOf('toggle').find((candidate) => candidate.label === label);
  if (!handle) throw new Error(`No toggle labelled "${label}".`);
  return keyOf(handle);
}

/** XState's ProcessingStatus: 1 while running; stopRootWithRehydration resets it to 0 (NotStarted). */
const processingStatus = (actor: AnyActorRef | undefined) =>
  (actor as unknown as { _processingStatus: number } | undefined)?._processingStatus;

/** Previews `leaf` on each instance, or releases them without one, as someone in the overlay would. */
function show(keys: string[], leaf: string | undefined): void {
  act(() => {
    for (const key of keys) {
      if (leaf === undefined) registry().release(key);
      else registry().preview(key, { leaves: [leaf] });
    }
  });
}

const STRICT_MODES: [name: string, reactStrictMode: boolean][] = [
  ['under StrictMode', true],
  ['without StrictMode', false],
];

/** What happens to a preview of the hidden actors while the fallback shows: [preview before, preview while hidden]. */
const PREVIEW_CHANGES: [change: string, before: string | undefined, whileHidden: string | undefined][] = [
  ['started', undefined, 'on'],
  ['changed', 'on', 'stuck'],
  ['released', 'on', undefined],
];

beforeEach(() => {
  resetRegistry();
  for (const name of Object.keys(actors)) delete actors[name];
  observed.length = 0;
  clock = new SimulatedClock();
  // Previews without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(STRICT_MODES)('hook actors whose content Suspense hides, %s', (_name, reactStrictMode) => {
  let view: RenderResult;

  async function mount(props: AppProps = {}): Promise<void> {
    view = render(<App {...props} />, { reactStrictMode });
    await flush();
    expect(labels()).toEqual(['hidden', 'observed', 'outside']);
  }

  /**
   * Opens the dialog, whose code starts loading, so the boundary hides its content and shows the fallback. Returns
   * what loads the code and reveals the content again.
   */
  async function hide(props: AppProps = {}): Promise<() => Promise<void>> {
    let load!: () => void;
    const code: DialogCode = { promise: new Promise<void>((resolve) => (load = resolve)), loaded: false };
    await act(async () => {
      view.rerender(<App {...props} dialog={code} />);
    });
    await flush();
    expect(screen.getByText('fallback')).toBeTruthy();
    // Hidden, not unmounted: @xstate/react's passive effects stay, so the actor it started is still running.
    expect(processingStatus(actors.hidden)).toBe(1);
    expect(processingStatus(actors.observed)).toBe(1);
    return async () => {
      await act(async () => {
        code.loaded = true;
        load();
        await code.promise;
      });
      await flush();
      expect(screen.queryByText('fallback')).toBeNull();
    };
  }

  test('stay listed, in place, and previewed while hidden, and show the preview once revealed', async () => {
    await mount();
    const key = keyOfLabel('hidden');
    show([key], 'on');
    expect(shownIn('hidden')).toBe('on');

    const reveal = await hide();
    expect(labels()).toEqual(['hidden', 'observed', 'outside']);
    expect(registry().getOverride(key)?.requested).toEqual(['on']);

    await reveal();
    expect(labels()).toEqual(['hidden', 'observed', 'outside']);
    expect(keyOfLabel('hidden')).toBe(key);
    expect(registry().getOverride(key)?.requested).toEqual(['on']);
    expect(shownIn('hidden')).toBe('on');
  });

  test('record the configurations their actor goes through while hidden', async () => {
    await mount({ withLoader: true });
    expect(shownIn('loader')).toBe('loading');

    const reveal = await hide({ withLoader: true });
    // The real actor keeps running underneath the fallback, through loaded to settled.
    act(() => clock.increment(1000));
    act(() => clock.increment(1000));
    await flush();
    await reveal();
    expect(shownIn('loader')).toBe('settled');

    const recorded = [...(registry().getSnapshot().data.loader?.recorded ?? [])].sort();
    expect(recorded).toEqual(['loaded', 'loading', 'settled']);
  });

  test.each(PREVIEW_CHANGES)(
    'a preview %s while hidden shows once revealed, in the component and the useActorRef observer',
    async (_change, before, whileHidden) => {
      await mount();
      const keys = [keyOfLabel('hidden'), keyOfLabel('observed')];
      if (before !== undefined) show(keys, before);
      expect({ hook: shownIn('hidden'), observer: observed.at(-1) }).toEqual({
        hook: before ?? 'off',
        observer: before ?? 'off',
      });

      const reveal = await hide();
      show(keys, whileHidden);
      await flush();
      await reveal();

      const expected = whileHidden ?? 'off';
      expect(actors.hidden.getSnapshot().value).toBe(expected);
      expect(actors.observed.getSnapshot().value).toBe(expected);
      expect({ hook: shownIn('hidden'), observer: observed.at(-1) }).toEqual({ hook: expected, observer: expected });
    },
  );

  test('a label change keeps the instance listed, in place, and previewed', async () => {
    await mount();
    const key = keyOfLabel('hidden');
    show([key], 'on');

    view.rerender(<App hiddenLabel="renamed" />);
    await flush();

    expect(labels()).toEqual(['renamed', 'observed', 'outside']);
    expect(keyOfLabel('renamed')).toBe(key);
    expect(registry().getOverride(key)?.requested).toEqual(['on']);
    expect(shownIn('hidden')).toBe('on');

    // Later previews of the renamed instance show too.
    show([key], 'stuck');
    expect(shownIn('hidden')).toBe('stuck');
    show([key], undefined);
    expect(shownIn('hidden')).toBe('off');
  });

  test('a real unmount still unregisters the instance and drops its preview', async () => {
    await mount();
    const key = keyOfLabel('hidden');
    show([key], 'on');

    view.rerender(<App withHidden={false} />);
    await flush();

    expect(labels()).toEqual(['observed', 'outside']);
    expect(registry().getOverride(key)).toBeUndefined();
    // @xstate/react stopped the actor (stopRootWithRehydration resets it to NotStarted).
    expect(processingStatus(actors.hidden)).toBe(0);
  });
});
