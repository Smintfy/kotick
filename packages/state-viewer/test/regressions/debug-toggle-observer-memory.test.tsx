// What the observer given to useActorRef has been told is kept per hook and real actor, whatever `debug.disabled` says
// (spec §10.2, "Observers and the actor's ending" and "Lifecycle"; R13). A dev toggle that takes a machine out of the
// debugger and puts it back leaves the actor the same, so the observer isn't new to it when debug is turned on:
// - An actor that finished while debug was disabled, from mount or after it was turned off, has told the observer how
//   it ended. Turning debug on and previewing the machine shows the observer no preview, and releasing the preview
//   doesn't repeat the done snapshot or complete: it hears nothing, as with @xstate/react, which knows nothing of
//   `debug`. An actor still running when debug is turned on is previewed as usual, the preview and then the real
//   snapshot reaching the observer once each.
// - Fast Refresh gives the component a new actor (a new machine object, as an edit to the machine's module makes)
//   while debug is disabled. That actor is the one the observer follows from then on, and the replaced one, which
//   @xstate/react stopped, has nothing left to show it. Turning debug on and off again, where the observer leaves the
//   preview as on a release, shows it the current actor's real snapshot only when it hasn't seen it: never a snapshot
//   of the replaced actor, and nothing it has already heard. The observer keeps the current actor's state and goes on
//   following it, as with @xstate/react.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import { useCallback, useMemo } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMachine, type Actor, type AnyActorRef, type Observer, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

const uploadMachine = createMachine({
  id: 'upload',
  initial: 'uploading',
  states: {
    uploading: { on: { UPLOADED: 'uploaded' } },
    failed: {},
    uploaded: { type: 'final' },
  },
});

/** A fresh machine object from a fresh config each call, as Fast Refresh re-evaluating the module gives. */
function createWizardMachine() {
  return createMachine({
    id: 'wizard',
    initial: 'account',
    states: {
      account: { on: { NEXT: 'address' } },
      address: { on: { NEXT: 'review' } },
      review: {},
    },
  });
}

type UploadSnapshot = SnapshotFrom<typeof uploadMachine>;
type WizardMachine = ReturnType<typeof createWizardMachine>;
type WizardSnapshot = SnapshotFrom<WizardMachine>;
type Hooks = Pick<typeof xstateReact, 'useActorRef'>;

const IMPLEMENTATIONS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
];

/** Stable ones: an inline observer is subscribed again on every render, and XState completes it on a done actor. */
const OBSERVERS: [name: string, kind: 'listener' | 'object'][] = [
  ['a stable listener (useCallback)', 'listener'],
  ['a stable observer object (useMemo)', 'object'],
];

const DISABLINGS: [when: string, fromMount: boolean][] = [
  ['from mount', true],
  ['after mount', false],
];

beforeEach(() => {
  resetRegistry();
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe.each(IMPLEMENTATIONS)('%s', (_name, hooks, previews) => {
  describe.each(DISABLINGS)('debug disabled %s', (_when, fromMount) => {
    /**
     * Mounts the upload with useActorRef and the observer `kind` makes, which records each snapshot as `status:value`
     * and complete as `complete`, then disables debug if it wasn't from mount. `take()` returns what it heard since
     * the last call; `enable()` turns debug on.
     */
    async function mount(kind: 'listener' | 'object') {
      let heard: string[] = [];
      let actorRef: Actor<typeof uploadMachine> | undefined;
      function Upload({ disabled }: { disabled: boolean }) {
        const listener = useCallback((snapshot: UploadSnapshot) => {
          heard.push(`${snapshot.status}:${String(snapshot.value)}`);
        }, []);
        const object = useMemo<Observer<UploadSnapshot>>(
          () => ({ next: listener, complete: () => heard.push('complete') }),
          [listener],
        );
        const observer = kind === 'listener' ? listener : object;
        actorRef = hooks.useActorRef(uploadMachine, { debug: { disabled } } as never, observer);
        return null;
      }
      const view = render(<Upload disabled={fromMount} />);
      await flush();
      const take = (): string[] => {
        const taken = heard;
        heard = [];
        return taken;
      };
      // Under StrictMode @xstate/react starts the actor twice, and the observer hears each start.
      expect(take()).toEqual(['active:uploading', 'active:uploading']);
      if (!fromMount) {
        view.rerender(<Upload disabled />);
        await flush();
        // The observer leaves no preview: it has seen the real snapshot.
        expect(take()).toEqual([]);
      }
      return {
        take,
        finish: async () => {
          act(() => actorRef!.send({ type: 'UPLOADED' }));
          await flush();
        },
        enable: async () => {
          view.rerender(<Upload disabled={false} />);
          await flush();
        },
      };
    }

    /** Previews `failed` on the upload, as someone in the overlay would; only the adapter registers it. */
    async function previewFailed(): Promise<void> {
      if (previews) act(() => registry().preview(keyOf(onlyHandle('upload')), { leaves: ['failed'] }));
      await flush();
    }

    /** Closes the overlay, ending the preview. */
    async function release(): Promise<void> {
      if (previews) act(() => registry().release());
      await flush();
    }

    test.each(OBSERVERS)(
      '%s of an actor that finished while disabled hears nothing when debug is turned on and it is previewed',
      async (_kind, kind) => {
        const { take, finish, enable } = await mount(kind);
        await finish();
        expect(take()).toEqual(kind === 'listener' ? ['done:uploaded'] : ['done:uploaded', 'complete']);

        await enable();
        expect(take()).toEqual([]);
        await previewFailed();
        expect(take()).toEqual([]);
        await release();
        expect(take()).toEqual([]);
      },
    );

    test.each(OBSERVERS)(
      '%s of an actor still running when debug is turned on sees the preview, then the real snapshot, once each',
      async (_kind, kind) => {
        const { take, enable } = await mount(kind);

        await enable();
        expect(take()).toEqual([]);
        await previewFailed();
        expect(take()).toEqual(previews ? ['active:failed'] : []);
        await release();
        expect(take()).toEqual(previews ? ['active:uploading'] : []);
      },
    );
  });

  describe('Fast Refresh replaced the actor while debug was disabled', () => {
    /** When the user moves the wizard on after the actor was replaced: before debug is turned on, while it's on, or not. */
    const MOVES: [when: string, move: 'disabled' | 'enabled' | undefined][] = [
      ['the user moves on before debug is turned on again', 'disabled'],
      ['the user moves on while debug is on', 'enabled'],
      ['the user stays put', undefined],
    ];

    test.each(MOVES)(
      '%s: turning debug on and off again leaves the observer on the current actor’s state',
      async (_when, move) => {
        let heard: string[] = [];
        let actorRef: AnyActorRef | undefined;
        type Props = { machine: WizardMachine; disabled: boolean };
        function Wizard({ machine, disabled }: Props) {
          // An inline observer, as components usually write one: @xstate/react subscribes it to the current actor.
          actorRef = hooks.useActorRef(machine, { debug: { disabled } } as never, (snapshot: WizardSnapshot) => {
            heard.push(`${snapshot.status}:${String(snapshot.value)}`);
          });
          return null;
        }
        const props: Props = { machine: createWizardMachine(), disabled: false };
        const view = render(<Wizard {...props} />);
        const update = async (patch: Partial<Props>): Promise<void> => {
          Object.assign(props, patch);
          view.rerender(<Wizard {...props} />);
          await flush();
        };
        const next = async (): Promise<void> => {
          act(() => actorRef!.send({ type: 'NEXT' }));
          await flush();
        };
        const take = (): string[] => {
          const taken = heard;
          heard = [];
          return taken;
        };
        await flush();
        expect(take()).toEqual(['active:account', 'active:account']);

        // A dev toggle takes the wizard out of the debugger.
        await update({ disabled: true });
        expect(take()).toEqual([]);
        // The developer edits the machine's module: Fast Refresh renders the component with a new machine object, and
        // @xstate/react replaces the actor, carrying its state over.
        const replaced = actorRef!;
        await update({ machine: createWizardMachine() });
        expect(actorRef).not.toBe(replaced);
        expect(take()).toEqual(['active:account']);
        if (move === 'disabled') await next();

        // The toggle puts the wizard back in the debugger, and later takes it out again.
        await update({ disabled: false });
        if (move === 'enabled') await next();
        await update({ disabled: true });

        const current = move === undefined ? 'account' : 'address';
        expect(take()).toEqual(move === undefined ? [] : ['active:address']);
        expect(String((actorRef!.getSnapshot() as WizardSnapshot).value)).toBe(current);

        // The observer goes on following the current actor.
        await next();
        expect(take()).toEqual([move === undefined ? 'active:address' : 'active:review']);
      },
    );
  });
});
