// An actor stopped while a preview shows: once the preview ends, every consumer of the actor shows its real snapshot,
// the last one it had before it stopped, as with @xstate/react (spec §10.2 "Observers and the actor's ending": a
// consumer that only re-renders is woken to leave the preview when the actor stopped; R10, R13). The preview ends
// through a release, or through the registry dropping it when a connect()ed actor unregisters on stopping. After that
// nothing previews them: useSelector and the hooks' store stop hearing about previews once the actor is stopped, though
// a hook keeps its stopped actor listed while the component is mounted (R1).

import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { assign, createActor, setup, type Actor } from 'xstate';
import { connect, useMachine, useSelector } from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

const sessionMachine = setup({ types: { context: {} as { user: string | null } } }).createMachine({
  id: 'session',
  initial: 'signedIn',
  context: { user: 'Ada' },
  states: {
    signedIn: { on: { SIGN_OUT: { target: 'signedOut', actions: assign({ user: null }) } } },
    signedOut: {},
    expired: {},
  },
});

type SessionActor = Actor<typeof sessionMachine>;

// Memoized, as context consumers and list rows often are, so it only re-renders when its own subscription says so.
const Indicator = React.memo(function Indicator({ session }: { session: SessionActor }) {
  const status = useSelector(session, (snapshot) => String(snapshot.value));
  return <output data-testid="selector">{status}</output>;
});

beforeEach(() => {
  resetRegistry();
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a connect()ed actor read with useSelector, stopped during a preview', () => {
  test('shows the real state once the registry drops the preview', async () => {
    const sessionActor = connect(createActor(sessionMachine).start(), { id: 'session' });
    render(<Indicator session={sessionActor} />);
    await flush();

    act(() => registry().preview(keyOf(onlyHandle('session')), { leaves: ['expired'] }));
    expect(screen.getByTestId('selector').textContent).toBe('expired');

    // The app tears the session down (say, on a route change) while someone is looking at the preview.
    act(() => {
      sessionActor.stop();
    });
    await flush();

    // The actor unregistered, so the registry dropped its preview, and nothing can preview it any more.
    expect(registry().getSnapshot().machines).toEqual([]);
    expect(registry().getSnapshot().overrides).toEqual({});
    expect(screen.getByTestId('selector').textContent).toBe('signedIn');
  });
});

describe('a useMachine actor the app stops during a preview', () => {
  let actorRef: SessionActor | undefined;

  function Session() {
    const [snapshot, , ref] = useMachine(sessionMachine);
    actorRef = ref;
    return (
      <>
        <output data-testid="hook">{String(snapshot.value)}</output>
        <Indicator session={ref} />
      </>
    );
  }

  const shown = () => ({
    hook: screen.getByTestId('hook').textContent,
    selector: screen.getByTestId('selector').textContent,
  });

  /** Mounts the session, previews `expired`, stops the real actor underneath and releases the preview. */
  async function stopDuringPreview(): Promise<string> {
    render(<Session />);
    await flush();
    const key = keyOf(onlyHandle('session'));

    act(() => registry().preview(key, { leaves: ['expired'] }));
    expect(shown()).toEqual({ hook: 'expired', selector: 'expired' });
    act(() => {
      actorRef?.stop();
    });
    await flush();

    act(() => registry().release(key));
    await flush();
    return key;
  }

  test('release shows the real state in the hook and in a useSelector consumer', async () => {
    await stopDuringPreview();

    expect(registry().getSnapshot().overrides).toEqual({});
    expect(shown()).toEqual({ hook: 'signedIn', selector: 'signedIn' });
  });

  test('nothing previews them afterwards, though the hook keeps the stopped actor listed', async () => {
    const key = await stopDuringPreview();
    expect(keyOf(onlyHandle('session'))).toBe(key);

    act(() => registry().preview(key, { leaves: ['signedOut'] }));
    await flush();
    expect(shown()).toEqual({ hook: 'signedIn', selector: 'signedIn' });

    act(() => registry().release(key));
    await flush();
    expect(shown()).toEqual({ hook: 'signedIn', selector: 'signedIn' });
  });
});
