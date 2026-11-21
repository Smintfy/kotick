// An order as a reducer machine, for the tests that drive it through the panel.

import { act, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { defineReducerMachine, useMachineReducer, type ReducerMachine } from 'shiru/reducer';
import { freshId } from './panel';

export type OrderState =
  | { status: 'idle' }
  | { status: 'loading'; orderId: string }
  | { status: 'success'; receipt: string }
  | { status: 'error'; orderId: string; message: string };

export type OrderEvent =
  | { type: 'SUBMIT'; orderId: string }
  | { type: 'RESOLVE'; receipt: string }
  | { type: 'REJECT'; message: string }
  | { type: 'RETRY' };

export type OrderMachine = ReducerMachine<OrderState, OrderEvent, 'status'>;

/** A charge that the bank didn't answer yet. The test answers it. */
interface Charge {
  orderId: string;
  resolve(): void;
  reject(): void;
}

export interface Bank {
  /** What the effect of `loading` did, in order. */
  log: string[];
  charges: Charge[];
}

export function createBank(): Bank {
  return { log: [], charges: [] };
}

/**
 * Makes the machine again with the same `id`, as a Fast Refresh edit does.
 * `without` is a state that the edit removes from the definition.
 */
export function createOrderMachine(
  { log, charges }: Bank,
  id = freshId('order'),
  without?: OrderState['status'],
): OrderMachine {
  const machine = defineReducerMachine<OrderState, OrderEvent>();

  const states: Parameters<typeof machine>[0]['states'] = {
    idle: { on: { SUBMIT: (_state, event) => ({ status: 'loading', orderId: event.orderId }) } },
    loading: {
      on: {
        RESOLVE: (_state, event) => ({ status: 'success', receipt: event.receipt }),
        REJECT: (state, event) => ({ status: 'error', orderId: state.orderId, message: event.message }),
      },
      effect: (state, send) => {
        log.push(`start ${state.orderId}`);
        charges.push({
          orderId: state.orderId,
          resolve: () => send({ type: 'RESOLVE', receipt: `receipt of ${state.orderId}` }),
          reject: () => send({ type: 'REJECT', message: 'declined' }),
        });

        return () => {
          log.push(`cleanup ${state.orderId}`);
        };
      },
    },
    success: {},
    error: { on: { RETRY: (state) => ({ status: 'loading', orderId: state.orderId }) } },
  };

  if (without === undefined) return machine({ id, discriminant: 'status', states });
  const { [without]: _removed, ...kept } = states;

  // SAFETY: An edit removes the state from the union and from the definition, and the types then agree again.
  // The app keeps the state object that it had, so the tests keep the union and remove only the definition.
  return machine({ id, discriminant: 'status', states: kept as typeof states });
}

interface OrderProps {
  machine: OrderMachine;
  name?: string;
  label?: string;
  disabled?: boolean;
  /** Runs in the layout effect of a child after each commit, with the `dispatch` of the hook. */
  onCommit?: (dispatch: (event: OrderEvent) => void) => void;
}

function AfterCommit({ run }: { run: () => void }) {
  useLayoutEffect(run);

  return null;
}

export function Order({ machine, name = 'order', label, disabled, onCommit }: OrderProps) {
  const [state, dispatch] = useMachineReducer(machine, { status: 'idle' }, { debug: { label, disabled } });

  return (
    <>
      <output aria-label={name}>{JSON.stringify(state)}</output>
      <input aria-label={`${name} note`} />
      <button type="button" onClick={() => dispatch({ type: 'SUBMIT', orderId: 'o1' })}>
        {name}: submit
      </button>
      <button type="button" onClick={() => dispatch({ type: 'RETRY' })}>
        {name}: retry
      </button>
      {onCommit && <AfterCommit run={() => onCommit(dispatch)} />}
    </>
  );
}

export function shownOrder(name = 'order'): OrderState {
  return JSON.parse(screen.getByRole('status', { name }).textContent ?? 'null');
}

/** Answers the nth charge that the effect of `loading` started, as the bank does. */
export async function answer(bank: Bank, answer: 'resolve' | 'reject', nth = 1): Promise<void> {
  const charge = bank.charges[nth - 1];

  if (charge === undefined) throw new Error(`The effect of loading started no charge ${nth}.`);
  await act(async () => charge[answer]());
}
