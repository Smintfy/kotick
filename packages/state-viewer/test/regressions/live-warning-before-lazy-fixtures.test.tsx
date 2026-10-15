// A deep link to a state that has a fixture, with `<StateViewer fixtures={() => import(...)}>`.
// The link previews the instance as it registers, before the loader is done, so the preview starts on the live context.
// The registry warned at that time that the state has no recorded or fixture context.
// Then the fixtures registered, and the preview changed to the fixture, so the warning was false.
// Now a preview on the default order holds that warning while a fixture load is pending.
// It warns when the last load ends, and only if it still uses the live context then.
// A preview with a source that the caller chose is not resolved again, so it warns at once, as before.

import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { setup } from 'xstate';
import type { FixtureSet } from '../../src/core/types';
import { StateViewer } from '../../src/index';
import { defineFixtures, useMachine } from '../../src/xstate';
import { flush, handlesOf, keyOf, registry, resetRegistry } from '../xstate/helpers';

const signupMachine = setup({
  types: {
    context: {} as { email: string; error: string | null },
    events: {} as { type: 'SUBMIT' },
  },
}).createMachine({
  id: 'signup',
  context: { email: 'live@example.org', error: null },
  initial: 'editing',
  states: {
    editing: { on: { SUBMIT: 'submitting' } },
    submitting: {},
    failed: {},
  },
});

// No fixture for 'submitting'.
const signupFixtures = [
  defineFixtures(signupMachine, { failed: { context: { email: 'ada@example.com', error: 'Taken' } } }),
];

function Signup() {
  const [snapshot] = useMachine(signupMachine);
  return <output data-testid="signup">{`${String(snapshot.value)}:${snapshot.context.email}`}</output>;
}

type Loaded = { default: readonly FixtureSet[] };

/** A fixtures loader that is pending until the test resolves or rejects it. */
function deferredLoader() {
  let resolve!: (loaded: Loaded) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Loaded>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return {
    loader: vi.fn(() => promise),
    resolve: (sets: readonly FixtureSet[]) => act(async () => resolve({ default: sets })),
    reject: (error: unknown) => act(async () => reject(error)),
  };
}

let warn: MockInstance<typeof console.warn>;

const liveWarnings = () =>
  warn.mock.calls.map(([message]) => String(message)).filter((message) => message.includes('No recorded or fixture'));

const signupKeys = () => handlesOf('signup').map(keyOf);

beforeEach(() => {
  resetRegistry();
  localStorage.clear();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe('a deep link applied before a lazy fixtures loader is done', () => {
  test('does not warn when the loaded fixtures give the preview context', async () => {
    window.history.replaceState(null, '', '/?debug-state=signup:failed');
    const { loader, resolve } = deferredLoader();
    render(
      <>
        <Signup />
        <StateViewer fixtures={loader} />
      </>,
    );
    await flush();
    const [key] = signupKeys();
    expect(registry().getOverride(key)?.source).toBe('live');
    expect(liveWarnings()).toEqual([]);

    await resolve(signupFixtures);
    await flush();
    expect(registry().getOverride(key)).toMatchObject({ source: 'fixture', context: { email: 'ada@example.com' } });
    expect(screen.getByTestId('signup').textContent).toBe('failed:ada@example.com');
    expect(liveWarnings()).toEqual([]);
  });

  test('warns when the loader is done, for a state that has no fixture', async () => {
    window.history.replaceState(null, '', '/?debug-state=signup:submitting');
    const { loader, resolve } = deferredLoader();
    render(
      <>
        <Signup />
        <StateViewer fixtures={loader} />
      </>,
    );
    await flush();
    expect(liveWarnings()).toEqual([]);

    await resolve(signupFixtures);
    await flush();
    expect(registry().getOverride(signupKeys()[0])?.source).toBe('live');
    expect(liveWarnings()).toEqual([
      `[state-viewer] No recorded or fixture context for "submitting" on "${signupKeys()[0]}", ` +
        'so the preview uses the live context.',
    ]);
  });

  test('warns when the loader fails', async () => {
    window.history.replaceState(null, '', '/?debug-state=signup:failed');
    const { loader, reject } = deferredLoader();
    render(
      <>
        <Signup />
        <StateViewer fixtures={loader} />
      </>,
    );
    await flush();
    expect(liveWarnings()).toEqual([]);

    await reject(new Error('Network'));
    await flush();
    expect(warn).toHaveBeenCalledWith('[state-viewer] The fixtures loader failed.', expect.any(Error));
    expect(liveWarnings()).toHaveLength(1);
  });

  test('warns once for all the instances of a machine', async () => {
    window.history.replaceState(null, '', '/?debug-state=signup:submitting');
    const { loader, resolve } = deferredLoader();
    render(
      <>
        <Signup />
        <Signup />
        <StateViewer fixtures={loader} />
      </>,
    );
    await flush();
    expect(signupKeys()).toHaveLength(2);
    expect(liveWarnings()).toEqual([]);

    await resolve(signupFixtures);
    await flush();
    expect(signupKeys().map((key) => registry().getOverride(key)?.source)).toEqual(['live', 'live']);
    expect(liveWarnings()).toHaveLength(1);
  });

  test('does not warn for a preview that is released before the loader is done', async () => {
    window.history.replaceState(null, '', '/?debug-state=signup:submitting');
    const { loader, resolve } = deferredLoader();
    render(
      <>
        <Signup />
        <StateViewer fixtures={loader} />
      </>,
    );
    await flush();
    act(() => registry().release(signupKeys()[0]));

    await resolve(signupFixtures);
    await flush();
    expect(liveWarnings()).toEqual([]);
  });

  test('waits for the load of a new fixtures input that starts before the first load is done', async () => {
    window.history.replaceState(null, '', '/?debug-state=signup:submitting');
    const first = deferredLoader();
    const second = deferredLoader();
    const { rerender } = render(
      <>
        <Signup />
        <StateViewer fixtures={first.loader} />
      </>,
    );
    await flush();
    rerender(
      <>
        <Signup />
        <StateViewer fixtures={second.loader} />
      </>,
    );
    await flush();

    await first.resolve(signupFixtures);
    await flush();
    expect(liveWarnings()).toEqual([]);

    await second.resolve(signupFixtures);
    await flush();
    expect(liveWarnings()).toHaveLength(1);
  });
});

describe('a preview made while a lazy fixtures loader is pending', () => {
  async function mountWhileLoading() {
    const deferred = deferredLoader();
    render(
      <>
        <Signup />
        <StateViewer fixtures={deferred.loader} />
      </>,
    );
    await flush();
    return { ...deferred, key: signupKeys()[0] };
  }

  test('on the default order, such as a click in the panel, warns only if no fixture loads for it', async () => {
    const { key, resolve } = await mountWhileLoading();
    act(() => registry().preview(key, { leaves: ['failed'] }));
    act(() => registry().preview(key, { leaves: ['submitting'] }));
    expect(liveWarnings()).toEqual([]);

    await resolve(signupFixtures);
    await flush();
    expect(liveWarnings()).toEqual([
      `[state-viewer] No recorded or fixture context for "submitting" on "${key}", so the preview uses the live context.`,
    ]);
  });

  test('with a source that the caller chose warns at once, as before', async () => {
    const { key, resolve } = await mountWhileLoading();
    act(() => registry().preview(key, { leaves: ['failed'], source: 'fixture' }));
    expect(liveWarnings()).toEqual([
      `[state-viewer] No recorded or fixture context for "failed" on "${key}", so the preview uses the live context.`,
    ]);

    // A chosen source is not resolved again, so the preview stays on the live context.
    await resolve(signupFixtures);
    await flush();
    expect(registry().getOverride(key)?.source).toBe('live');
    expect(liveWarnings()).toHaveLength(1);
  });

  test('on the live source that the caller chose does not warn, as before', async () => {
    const { key, resolve } = await mountWhileLoading();
    act(() => registry().preview(key, { leaves: ['submitting'], source: 'live' }));

    await resolve(signupFixtures);
    await flush();
    expect(liveWarnings()).toEqual([]);
  });
});

describe('Registry.expectFixtures()', () => {
  test('holds the warning until every pending load ends, and each end counts once', async () => {
    render(<Signup />);
    await flush();
    const [key] = signupKeys();
    const endFirst = registry().expectFixtures();
    const endSecond = registry().expectFixtures();
    act(() => registry().preview(key, { leaves: ['submitting'] }));

    endFirst();
    endFirst();
    expect(liveWarnings()).toEqual([]);

    endSecond();
    expect(liveWarnings()).toHaveLength(1);
  });

  test('without a pending load, a preview warns at once, as before', async () => {
    render(<Signup />);
    await flush();
    registry().expectFixtures()();
    act(() => registry().preview(signupKeys()[0], { leaves: ['submitting'] }));
    expect(liveWarnings()).toHaveLength(1);
  });
});
