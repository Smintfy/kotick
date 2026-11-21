import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Shiru, type FixtureSet, type FixturesResult, type ShiruProps } from 'shiru';
import { onTestFinished } from 'vitest';
import { createActor, type Actor, type AnyActorRef, type AnyStateMachine } from 'xstate';
import { flush } from './panel';

export function page(app: ReactNode, props?: ShiruProps) {
  return (
    <>
      {app}
      <Shiru defaultOpen {...props} />
    </>
  );
}

export async function mount(app: ReactNode, props?: ShiruProps) {
  const view = render(page(app, props));
  await flush();

  return view;
}

export function start<TMachine extends AnyStateMachine>(machine: TMachine): Actor<TMachine> {
  const actor = createActor(machine).start();
  onTestFinished(() => {
    actor.stop();
  });

  return actor;
}

/** If the system has no such actor, the test fails here, not at a later call on `undefined`. */
export function systemActor(actor: AnyActorRef, systemId: string): AnyActorRef {
  const found = actor.system.get(systemId);

  if (found === undefined) throw new Error(`The system has no actor "${systemId}".`);

  return found;
}

export async function press(name: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name }));
  await flush();
}

type Settle = { resolve(result: FixturesResult): void; reject(reason: Error): void };

/** A fixtures loader whose import the test resolves or rejects, as `() => import('./fixtures')` does. */
export function lazyFixtures() {
  let settle!: Settle;

  const loaded = new Promise<FixturesResult>((resolve, reject) => {
    settle = { resolve, reject };
  });

  return {
    loader: () => loaded,
    async resolve(sets: FixtureSet[]) {
      await act(async () => settle.resolve({ default: sets }));
      await flush();
    },
    async reject(reason: Error) {
      await act(async () => settle.reject(reason));
      await flush();
    },
  };
}
