// R12 / G3: an event that reaches the proxy through XState's own delivery path (sendTo, forwardTo, delayed sends all
// end in system._relay -> target._send) has to be blocked during a preview, just like proxy.send().
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createActor, sendTo, setup, type AnyActorRef } from 'xstate';
import { connect, useActorRef, useSelector } from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

const targetMachine = setup({ types: { events: {} as { type: 'NEXT' } } }).createMachine({
  id: 'target',
  initial: 'a',
  states: { a: { on: { NEXT: 'b' } }, b: { on: { NEXT: 'c' } }, c: {} },
});

/** Another app actor that was handed the target (the proxy, since that's what the app holds) through its input. */
const senderMachine = setup({
  types: {
    context: {} as { target: AnyActorRef },
    input: {} as { target: AnyActorRef },
    events: {} as { type: 'PING' } | { type: 'PING_LATER' },
  },
}).createMachine({
  id: 'sender',
  context: ({ input }) => ({ target: input.target }),
  on: {
    PING: { actions: sendTo(({ context }) => context.target, { type: 'NEXT' }) },
    PING_LATER: { actions: sendTo(({ context }) => context.target, { type: 'NEXT' }, { delay: 10 }) },
  },
});

const actors: AnyActorRef[] = [];

beforeEach(() => {
  resetRegistry();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const actor of actors.splice(0)) actor.stop();
  window.dispatchEvent(new Event('pagehide'));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function startPair() {
  const real = createActor(targetMachine).start();
  actors.push(real);
  const proxy = connect(real);
  const sender = createActor(senderMachine, { input: { target: proxy } }).start();
  actors.push(sender);
  return { real, proxy, sender };
}

test('sendTo from another actor reaches the target normally (control)', async () => {
  const { real, sender } = startPair();
  await flush();

  sender.send({ type: 'PING' });

  expect(real.getSnapshot().value).toBe('b');
});

test('proxy.send is blocked and logged during a preview (control)', async () => {
  const { real, proxy } = startPair();
  await flush();
  const key = keyOf(onlyHandle('target'));
  registry().preview(key, { leaves: ['b'] });

  proxy.send({ type: 'NEXT' });

  expect(real.getSnapshot().value).toBe('a');
  expect(registry().getSnapshot().log.filter((entry) => entry.blocked)).toHaveLength(1);
});

test('an event another actor sends to the previewed proxy with sendTo is blocked and logged, not delivered', async () => {
  const { real, proxy, sender } = startPair();
  await flush();
  const key = keyOf(onlyHandle('target'));
  registry().preview(key, { leaves: ['b'] });

  sender.send({ type: 'PING' });
  await flush();

  // The real actor must not move, and the event must be in the log as blocked.
  expect(real.getSnapshot().value).toBe('a');
  expect(proxy.getSnapshot().value).toBe('b');
  const blocked = registry()
    .getSnapshot()
    .log.filter((entry) => entry.blocked && entry.instanceKey === key);
  expect(blocked.map((entry) => entry.event)).toEqual([{ type: 'NEXT' }]);
});

test('a delayed sendTo to the previewed proxy is blocked too', async () => {
  vi.useFakeTimers();
  const { real, sender } = startPair();
  await flush();
  const key = keyOf(onlyHandle('target'));
  registry().preview(key, { leaves: ['b'] });

  sender.send({ type: 'PING_LATER' });
  vi.advanceTimersByTime(20);

  expect(real.getSnapshot().value).toBe('a');
  expect(registry().getSnapshot().log.filter((entry) => entry.blocked && entry.instanceKey === key)).toHaveLength(1);
});

test('in React, a sibling actor given the hook-returned ref cannot move the previewed actor through sendTo', async () => {
  let senderRef: AnyActorRef | undefined;

  function Sender({ target }: { target: AnyActorRef }) {
    senderRef = useActorRef(senderMachine, { input: { target } });
    return null;
  }

  function App() {
    const targetRef = useActorRef(targetMachine);
    const value = useSelector(targetRef, (snapshot) => snapshot.value);
    return (
      <>
        <p data-testid="value">{String(value)}</p>
        <Sender target={targetRef} />
      </>
    );
  }

  render(<App />);
  await flush();
  const handle = onlyHandle('target');
  const key = keyOf(handle);
  act(() => registry().preview(key, { leaves: ['b'] }));
  await flush();
  expect(screen.getByTestId('value').textContent).toBe('b');

  act(() => senderRef!.send({ type: 'PING' }));
  await flush();

  // handle.getActiveLeaves() reads the real actor.
  expect(handle.getActiveLeaves()).toEqual(['a']);
  expect(registry().getSnapshot().log.filter((entry) => entry.blocked && entry.instanceKey === key)).toHaveLength(1);

  act(() => registry().release(key));
  await flush();
  expect(screen.getByTestId('value').textContent).toBe('a');
});
