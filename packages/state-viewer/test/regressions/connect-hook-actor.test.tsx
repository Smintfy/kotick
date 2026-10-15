// connect() on the real actor behind a hook, reached the way XState apps look actors up (system.get with a systemId),
// returns the hook's proxy without registering the actor again. connect() given the same actor again returns
// the same proxy. The hook's instance stays the only one listed for the actor, and previewing it shows in the
// component, before and after the hook re-renders. The hook keeps its id and label: connect() given an id or a label
// for such an actor warns once and ignores them. connect() given the hook's proxy, which is what apps hold,
// does the same: one warning per hook actor, whether the app passes
// the proxy, the real actor, or both. A proxy connect() made itself comes back as it is, without a warning.

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest';
import { createActor, createMachine, type AnyActorRef } from 'xstate';
import { connect, useMachine } from '../../src/xstate';
import { flush, handlesOf, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

const HOOK_ACTOR_WARNING = 'connect() was given an actor that a hook already registers';

const toggleMachine = createMachine({
  id: 'toggle',
  initial: 'off',
  states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } },
});

let proxyRef: AnyActorRef | undefined;

function Toggle() {
  const [snapshot, , actorRef] = useMachine(toggleMachine, { systemId: 'toggle-root' });
  proxyRef = actorRef;
  return <output data-testid="value">{String(snapshot.value)}</output>;
}

const shown = () => screen.getByTestId('value').textContent;

/** The real actor behind the hook's proxy, as app code finds it through the system. */
function realActor(): AnyActorRef {
  const real = proxyRef?.system.get('toggle-root') as AnyActorRef | undefined;
  if (!real) throw new Error('The toggle did not render.');
  expect(real).not.toBe(proxyRef);
  return real;
}

/** Previews `on` on the toggle's only listed instance, checks the component shows it, and releases it. */
function expectPreviewShows(): void {
  const key = keyOf(onlyHandle('toggle'));
  act(() => registry().preview(key, { leaves: ['on'] }));
  expect(shown()).toBe('on');
  act(() => registry().release(key));
  expect(shown()).toBe('off');
}

let warn: MockInstance<typeof console.warn>;

/** Warnings about connect() being given a hook's actor; previews warn about other things. */
const hookActorWarnings = () => warn.mock.calls.filter(([message]) => String(message).includes(HOOK_ACTOR_WARNING));

beforeEach(() => {
  resetRegistry();
  proxyRef = undefined;
  // Previews of states without a recording or fixture warn about falling back to live context.
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('connect() on the real actor of a hook', () => {
  test('control: without connect(), previewing the hook instance shows', async () => {
    render(<Toggle />);
    await flush();
    expectPreviewShows();
  });

  test("returns the hook's proxy without registering the actor again", async () => {
    render(<Toggle />);
    await flush();
    const hookKey = keyOf(onlyHandle('toggle'));

    expect(connect(realActor())).toBe(proxyRef);
    await flush();

    expect(handlesOf('toggle').map(keyOf)).toEqual([hookKey]);
    expect(hookActorWarnings()).toEqual([]);
  });

  test("previews of the hook's instance keep showing, before and after the hook re-renders", async () => {
    const view = render(<Toggle />);
    await flush();
    connect(realActor());
    await flush();

    expectPreviewShows();

    view.rerender(<Toggle />);
    await flush();
    expect(handlesOf('toggle')).toHaveLength(1);
    expectPreviewShows();
  });

  test("given an id or a label, warns once and keeps the hook's id and label", async () => {
    render(<Toggle />);
    await flush();
    const hookHandle = onlyHandle('toggle');
    const real = realActor();

    expect(connect(real, { id: 'other-toggle' })).toBe(proxyRef);
    expect(connect(real, { label: 'Other toggle' })).toBe(proxyRef);
    expect(connect(real, { id: 'other-toggle', label: 'Other toggle' })).toBe(proxyRef);
    await flush();

    expect(hookActorWarnings()).toHaveLength(1);
    expect(registry().getSnapshot().machines).toEqual([hookHandle]);
    expect(hookHandle.label).toBeUndefined();
    expectPreviewShows();
  });
});

describe("connect() on a hook's proxy, as apps hold it", () => {
  test("returns the proxy without registering the actor again, and previews keep showing", async () => {
    render(<Toggle />);
    await flush();
    const hookHandle = onlyHandle('toggle');

    expect(connect(proxyRef as AnyActorRef)).toBe(proxyRef);
    await flush();

    expect(registry().getSnapshot().machines).toEqual([hookHandle]);
    expect(hookActorWarnings()).toEqual([]);
    expectPreviewShows();
  });

  test("given an id or a label, warns once, as for the real actor, and keeps the hook's id and label", async () => {
    render(<Toggle />);
    await flush();
    const hookHandle = onlyHandle('toggle');
    const proxy = proxyRef as AnyActorRef;

    expect(connect(proxy, { id: 'other-toggle', label: 'Other toggle' })).toBe(proxy);
    expect(connect(proxy, { id: 'other-toggle' })).toBe(proxy);
    expect(connect(proxy, { label: 'Other toggle' })).toBe(proxy);
    await flush();

    expect(hookActorWarnings()).toHaveLength(1);
    expect(registry().getSnapshot().machines).toEqual([hookHandle]);
    expect(hookHandle.label).toBeUndefined();
    expectPreviewShows();
  });

  test.each([
    ['the proxy, then the real actor', false],
    ['the real actor, then the proxy', true],
  ])('given %s, each with an id or a label, warns once, not twice', async (_order, realFirst) => {
    render(<Toggle />);
    await flush();
    const hookHandle = onlyHandle('toggle');
    const proxy = proxyRef as AnyActorRef;
    const given = realFirst ? [realActor(), proxy] : [proxy, realActor()];

    expect(connect(given[0], { id: 'other-toggle' })).toBe(proxy);
    expect(connect(given[1], { label: 'Other toggle' })).toBe(proxy);
    await flush();

    expect(hookActorWarnings()).toHaveLength(1);
    expect(registry().getSnapshot().machines).toEqual([hookHandle]);
  });

  test('a proxy connect() made, given another id, comes back as it is without a warning', async () => {
    const proxy = connect(createActor(toggleMachine).start());
    const handle = onlyHandle('toggle');

    expect(connect(proxy, { id: 'other-toggle' })).toBe(proxy);
    await flush();

    expect(warn.mock.calls).toEqual([]);
    expect(registry().getSnapshot().machines).toEqual([handle]);
    proxy.stop();
  });
});
