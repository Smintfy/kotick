import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Konat, type KonatProps } from 'konat';
import { onTestFinished } from 'vitest';
import { createActor, type Actor, type AnyActorRef, type AnyStateMachine } from 'xstate';
import { flush } from './panel';

export function page(app: ReactNode, props?: KonatProps) {
  return (
    <>
      {app}
      <Konat defaultOpen {...props} />
    </>
  );
}

export async function mount(app: ReactNode, props?: KonatProps) {
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
