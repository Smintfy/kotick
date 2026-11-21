'use client';

import { defineReducerMachine, useMachineReducer } from 'kotick/reducer';

type DoorState = { status: 'closed' } | { status: 'opening' } | { status: 'open'; openedAt: number };

type DoorEvent = { type: 'OPEN' } | { type: 'OPENED'; at: number } | { type: 'CLOSE' };

interface DoorInput {
  delay: number;
}

export const doorMachine = defineReducerMachine<DoorState, DoorEvent, DoorInput>()({
  id: 'door',
  discriminant: 'status',
  states: {
    closed: { on: { OPEN: () => ({ status: 'opening' }) } },
    opening: {
      on: { OPENED: (_state, event) => ({ status: 'open', openedAt: event.at }) },
      effect: (_state, send, input) => {
        const timer = setTimeout(() => send({ type: 'OPENED', at: Date.now() }), input().delay);

        return () => clearTimeout(timer);
      },
    },
    open: { on: { CLOSE: () => ({ status: 'closed' }) } },
  },
});

export function Door({ delay }: DoorInput) {
  const [state, dispatch] = useMachineReducer(doorMachine, { status: 'closed' }, { input: { delay } });

  return state.status === 'open' ? (
    <button type="button" onClick={() => dispatch({ type: 'CLOSE' })}>
      Close
    </button>
  ) : (
    <button type="button" disabled={state.status === 'opening'} onClick={() => dispatch({ type: 'OPEN' })}>
      Open
    </button>
  );
}
