import { act, render } from '@testing-library/react';
import * as React from 'react';
import { useActorRef } from 'state-viewer/xstate';
import { describe, expect, test } from 'vitest';
import { createMachine, fromCallback, setup, type AnyActorRef, type Observer, type SnapshotFrom } from 'xstate';
import { page, press } from '../support/app';
import { describeWithActivity, IMPLEMENTATIONS } from '../support/hooks';
import { badge, flush, freshId, machines, preview, release } from '../support/panel';

function createToggleMachine() {
  return createMachine({
    id: freshId('toggle'),
    initial: 'off',
    states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } },
  });
}

/** An upload that its socket, an invoked callback actor, finishes when the test calls `finish()`. */
function createUpload(id = freshId('upload')) {
  const socket: { answer?: () => void } = {};
  const machine = setup({
    actors: {
      socket: fromCallback(({ sendBack }) => {
        socket.answer = () => sendBack({ type: 'UPLOADED' });
        return () => {
          socket.answer = undefined;
        };
      }),
    },
  }).createMachine({
    id,
    initial: 'uploading',
    states: {
      uploading: { invoke: { src: 'socket' }, on: { UPLOADED: 'uploaded' } },
      failed: {},
      uploaded: { type: 'final' },
    },
  });
  const finish = async (): Promise<void> => {
    act(() => socket.answer?.());
    await flush();
  };
  return { machine, finish };
}

/** A new machine object with the same id each call, as Fast Refresh makes when the developer edits its module. */
function createWizardMachine(id: string) {
  return createMachine({
    id,
    initial: 'account',
    states: {
      account: { on: { NEXT: 'address' } },
      address: { on: { NEXT: 'review' } },
      review: {},
    },
  });
}

type Snapshot = { status: string; value: unknown };

const label = (snapshot: Snapshot): string => `${snapshot.status}:${String(snapshot.value)}`;

type ObserverKind = { object: boolean; stable: boolean };

type Recorder = Observer<Snapshot> | ((snapshot: Snapshot) => void);

/**
 * The observer a component passes to useActorRef. It records each snapshot as `status:value`, and complete.
 * It is a listener or an observer object. It is new on each render, or the observer of the first render throughout.
 */
function useRecorder(heard: string[], { object, stable }: ObserverKind): Recorder {
  const next = (snapshot: Snapshot) => {
    heard.push(label(snapshot));
  };
  const inline = object ? { next, complete: () => heard.push('complete') } : next;
  const [first] = React.useState(() => inline);
  return stable ? first : inline;
}

test('debug.disabled takes the machine out of the overlay, and the observer goes on hearing the real actor', async () => {
  const machine = createToggleMachine();
  const heard: string[] = [];
  function Toggle({ disabled }: { disabled: boolean }) {
    const observer = useRecorder(heard, { object: false, stable: false });
    const actorRef = useActorRef(machine, { debug: { disabled } }, observer);
    return (
      <button type="button" onClick={() => actorRef.send({ type: 'TOGGLE' })}>
        Toggle
      </button>
    );
  }
  const view = render(page(<Toggle disabled={false} />));
  await flush();

  const mounted = { heard: heard.splice(0), listed: await machines() };
  view.rerender(page(<Toggle disabled />));
  await flush();
  const disabled = { heard: heard.splice(0), listed: await machines() };
  await press('Toggle');
  const toggled = heard.splice(0);
  view.rerender(page(<Toggle disabled={false} />));
  await flush();
  expect({ mounted, disabled, toggled, enabled: { heard, listed: await machines() } }).toEqual({
    // StrictMode starts the actor twice.
    mounted: { heard: ['active:off', 'active:off'], listed: [machine.id] },
    disabled: { heard: [], listed: [] },
    toggled: ['active:on'],
    enabled: { heard: [], listed: [machine.id] },
  });
});

describe('an observer that the component passes after the actor moved', () => {
  describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks, previews) => {
    test('turning debug.disabled on, with nothing previewed, sends the observer nothing until the next change', async () => {
      const machine = createToggleMachine();
      const heard: string[] = [];
      const onChange = (snapshot: Snapshot) => {
        heard.push(label(snapshot));
      };
      // The component listens only while its panel is open, as an onChange prop or an analytics hook may.
      function Toggle({ panelOpen, disabled }: { panelOpen: boolean; disabled: boolean }) {
        const actorRef = hooks.useActorRef(machine, { debug: { disabled } } as never, panelOpen ? onChange : undefined);
        return (
          <button type="button" onClick={() => actorRef.send({ type: 'TOGGLE' })}>
            Toggle
          </button>
        );
      }
      const view = render(page(<Toggle panelOpen={false} disabled={false} />));
      await flush();

      // The user flips the toggle, then opens the panel that listens to it.
      await press('Toggle');
      view.rerender(page(<Toggle panelOpen disabled={false} />));
      await flush();
      const opened = { heard: heard.splice(0), listed: await machines() };
      view.rerender(page(<Toggle panelOpen disabled />));
      await flush();
      const disabled = { heard: heard.splice(0), listed: await machines() };
      await press('Toggle');
      expect({ opened, disabled, toggled: heard }).toEqual({
        // @xstate/react subscribes the observer to an actor that already moved, and XState sends it nothing.
        opened: { heard: [], listed: previews ? [machine.id] : [] },
        disabled: { heard: [], listed: [] },
        toggled: ['active:off'],
      });
    });
  });
});

describe('while a preview shows', () => {
  /** Each observer, and what it hears when the actor finishes. */
  const OBSERVERS: [name: string, kind: ObserverKind, ending: string[]][] = [
    ['an inline listener', { object: false, stable: false }, ['done:uploaded']],
    ['a stable listener', { object: false, stable: true }, ['done:uploaded']],
    ['an inline observer object', { object: true, stable: false }, ['done:uploaded', 'complete']],
    ['a stable observer object', { object: true, stable: true }, ['done:uploaded', 'complete']],
  ];

  describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks, previews) => {
    /** Mounts the upload with the observer, and previews `failed` on it. `disable()` renders it with debug.disabled. */
    async function mountAndPreview(kind: ObserverKind) {
      const upload = createUpload();
      const heard: string[] = [];
      function Upload({ disabled }: { disabled: boolean }) {
        hooks.useActorRef(upload.machine, { debug: { disabled } } as never, useRecorder(heard, kind));
        return null;
      }
      const view = render(page(<Upload disabled={false} />));
      await flush();
      if (previews) await preview(upload.machine.id, ['failed']);
      const disable = async (): Promise<void> => {
        view.rerender(page(<Upload disabled />));
        await flush();
      };
      return { heard, finish: upload.finish, disable };
    }

    /** What the observer hears as the actor starts, under StrictMode twice, and as the preview shows. */
    const previewing = ['active:uploading', 'active:uploading', ...(previews ? ['active:failed'] : [])];

    describe('when the actor finished under the preview', () => {
      test.each(OBSERVERS)(
        '%s gets the done snapshot, then complete if it has one, as debug is disabled, and nothing else of the hook',
        async (_kind, kind, ending) => {
          const { heard, finish, disable } = await mountAndPreview(kind);
          const previewed = heard.splice(0);

          await finish();
          const finished = heard.splice(0);
          await disable();
          const disabled = { heard: heard.splice(0), listed: await machines() };
          // A later render with debug still disabled.
          await disable();
          // @xstate/react subscribes an inline observer object again on each render, and XState completes it at once.
          const resubscribed = kind.object && !kind.stable ? ['complete'] : [];
          expect({ previewed, finished, disabled, later: heard }).toEqual({
            previewed: previewing,
            // The preview hides the ending.
            // It loses the socket that the real actor stops, so the observer hears the preview again.
            finished: previews ? ['active:failed'] : ending,
            disabled: { heard: [...(previews ? ending : []), ...resubscribed], listed: [] },
            later: resubscribed,
          });
        },
      );
    });

    describe('when the actor is still running', () => {
      test.each(OBSERVERS)(
        '%s is shown the real snapshot as debug is disabled, then follows the actor',
        async (_kind, kind, ending) => {
          const { heard, finish, disable } = await mountAndPreview(kind);
          const previewed = heard.splice(0);

          await disable();
          const disabled = { heard: heard.splice(0), listed: await machines() };
          await disable();
          const later = heard.splice(0);
          await finish();
          expect({ previewed, disabled, later, finished: heard }).toEqual({
            previewed: previewing,
            disabled: { heard: previews ? ['active:uploading'] : [], listed: [] },
            later: [],
            finished: ending,
          });
        },
      );
    });
  });

  describe('after a new machine replaced an actor that finished under the preview', () => {
    test.each([
      ['debug.disabled after a replacement', true],
      ['a release, as a control,', false],
    ])("%s delivers the old actor's owed ending before the new actor's", async (_, disabling) => {
      const id = freshId('upload');
      const uploads = { old: createUpload(id), new: createUpload(id) };
      const calls: string[] = [];
      const actorOf = (snapshot: SnapshotFrom<typeof uploads.old.machine>) =>
        snapshot.machine === uploads.old.machine ? 'old' : 'new';
      // The app builds the machine from a prop.
      // The new actor starts from the snapshot of the old one, so only the machine tells their snapshots apart.
      function Upload({ version, disabled }: { version: 'old' | 'new'; disabled: boolean }) {
        const observer: Observer<SnapshotFrom<typeof uploads.old.machine>> = {
          next: (snapshot) => calls.push(`${label(snapshot)} (${actorOf(snapshot)})`),
          complete: () => calls.push('complete'),
        };
        useActorRef(uploads[version].machine, { debug: { disabled } }, observer);
        return null;
      }
      const view = render(page(<Upload version="old" disabled={false} />));
      await flush();
      await preview(id, ['failed']);

      calls.length = 0;
      calls.push('[finish]');
      await uploads.old.finish();
      calls.push('[replace]');
      view.rerender(page(<Upload version="new" disabled={false} />));
      await flush();
      if (disabling) {
        calls.push('[disable]');
        view.rerender(page(<Upload version="new" disabled />));
        await flush();
      } else {
        calls.push('[release]');
        await release(id);
      }
      expect(calls).toEqual([
        '[finish]',
        'active:failed (old)',
        '[replace]',
        'active:failed (new)',
        disabling ? '[disable]' : '[release]',
        // The old actor's owed ending first.
        'done:uploaded (old)',
        'complete',
        // XState repeats the ending of an actor started from a done snapshot.
        'done:uploaded (new)',
        'complete',
        // @xstate/react subscribes the new render's inline observer to the finished actor, and XState completes it.
        ...(disabling ? ['complete'] : []),
      ]);
    });
  });
});

// A hidden <Activity> runs the cleanup of the effects of its components.
// So @xstate/react stops the actor, and the hook stops listening to previews and unregisters.
// The overlay drops the preview of an instance that unregistered.
describeWithActivity('while an Activity hides the component', () => {
  /** When debug.disabled turns on: never, while the Activity hides the upload, or in the render that reveals it. */
  type Disabling = 'never' | 'while hidden' | 'on reveal';

  const DISABLINGS: [when: string, disabling: Disabling][] = [
    ['debug stays on', 'never'],
    ['debug.disabled turns on while an Activity hides the upload', 'while hidden'],
    ['debug.disabled turns on in the render that reveals the upload', 'on reveal'],
  ];

  const STRICT_MODES: [name: string, reactStrictMode: boolean][] = [
    ['under StrictMode', true],
    ['without StrictMode', false],
  ];

  const OBSERVERS: [name: string, stable: boolean][] = [
    ['an inline observer', false],
    ['a stable observer', true],
  ];

  /** The done snapshot, then complete: how XState tells an observer that the actor finished. */
  const DONE = ['done:uploaded', 'complete'];

  describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks, previews) => {
    describe.each(DISABLINGS)('%s', (_when, disabling) => {
      const disabled = disabling !== 'never';
      /** The markers of the steps between the actor's ending and the reveal, the reveal included. */
      const hideAndReveal = ['[hide]', ...(disabling === 'while hidden' ? ['[debug disabled]'] : []), '[reveal]'];
      /** The markers of the steps after the reveal, each followed by what the observer hears in it. */
      const later = (heard: string[]): string[] => [
        '[later render]',
        ...heard,
        ...(disabled ? ['[debug on]', ...heard] : []),
      ];

      describe.each(STRICT_MODES)('%s', (_mode, reactStrictMode) => {
        /**
         * Mounts the upload in an Activity, previews `failed`, and ends the actor underneath: the app stops it (the
         * user cancels), or the socket finishes it. A tab switch hides the upload, debug is disabled when `disabling`
         * says, and the upload shows again. Later the component renders for another reason, and a disabled debug is
         * turned on again. `calls` holds what the observer heard, with a marker before each step.
         */
        async function endThenHideAndReveal(stable: boolean, ending: 'stop' | 'finish') {
          const upload = createUpload();
          const calls: string[] = [];
          let actorRef: AnyActorRef | undefined;
          function Upload({ disabled }: { disabled: boolean }) {
            const observer = useRecorder(calls, { object: true, stable });
            actorRef = hooks.useActorRef(upload.machine, { debug: { disabled } } as never, observer);
            return null;
          }
          const app = (mode: 'visible' | 'hidden', disabled: boolean) =>
            page(
              <React.Activity mode={mode}>
                <Upload disabled={disabled} />
              </React.Activity>,
            );
          const view = render(app('visible', false), { reactStrictMode });
          await flush();
          if (previews) await preview(upload.machine.id, ['failed']);

          calls.length = 0;
          calls.push(ending === 'stop' ? '[app stops]' : '[finish]');
          if (ending === 'stop') act(() => actorRef?.stop());
          else await upload.finish();
          await flush();

          calls.push('[hide]');
          view.rerender(app('hidden', false));
          await flush();
          await flush();
          const hidden = badge();
          if (disabling === 'while hidden') {
            calls.push('[debug disabled]');
            view.rerender(app('hidden', true));
            await flush();
          }
          calls.push('[reveal]');
          view.rerender(app('visible', disabled));
          await flush();
          await flush();

          calls.push('[later render]');
          // Wait for real time, so that a delivery from a timer shows after this marker.
          await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
          view.rerender(app('visible', disabled));
          await flush();
          if (disabled) {
            calls.push('[debug on]');
            view.rerender(app('visible', false));
            await flush();
          }
          return { calls, hidden, status: actorRef?.getSnapshot().status };
        }

        test.each(OBSERVERS)(
          '%s given to useActorRef hears complete once, by the reveal, when the app stopped the actor during a preview',
          async (_kind, stable) => {
            expect(await endThenHideAndReveal(stable, 'stop')).toEqual({
              // The hook holds complete back until the reveal. @xstate/react tells the observer at the stop.
              calls: previews
                ? ['[app stops]', ...hideAndReveal, 'complete', ...later([])]
                : ['[app stops]', 'complete', ...hideAndReveal, ...later([])],
              hidden: '',
              status: 'stopped',
            });
          },
        );

        test.each(OBSERVERS)(
          "%s given to useActorRef hears a finished actor's ending as many times as with @xstate/react",
          async (_kind, stable) => {
            // @xstate/react starts the actor again on the reveal, and once more under StrictMode, which runs the
            // effects again. XState repeats a finished actor's ending each time.
            const restarts = reactStrictMode ? [...DONE, ...DONE] : DONE;
            // It subscribes an inline observer again on each later render, and XState completes it.
            const resubscribed = stable ? [] : ['complete'];
            expect(await endThenHideAndReveal(stable, 'finish')).toEqual({
              // The preview hides the ending, and loses the socket that the real actor stops.
              // The hook delivers the ending on the reveal, before the restarts repeat it.
              calls: previews
                ? ['[finish]', 'active:failed', ...hideAndReveal, ...DONE, ...restarts, ...later(resubscribed)]
                : ['[finish]', ...DONE, ...hideAndReveal, ...restarts, ...later(resubscribed)],
              hidden: '',
              status: 'done',
            });
          },
        );
      });
    });
  });
});

describe('turned off and on again', () => {
  const OBSERVERS: [name: string, object: boolean][] = [
    ['a stable listener', false],
    ['a stable observer object', true],
  ];

  describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks, previews) => {
    describe.each([
      ['from mount', true],
      ['after mount', false],
    ])('debug disabled %s', (_when, fromMount) => {
      /** Mounts the upload with debug disabled, from mount or right after it. `enable()` turns debug on. */
      async function mountDisabled(object: boolean) {
        const upload = createUpload();
        const heard: string[] = [];
        function Upload({ disabled }: { disabled: boolean }) {
          const observer = useRecorder(heard, { object, stable: true });
          hooks.useActorRef(upload.machine, { debug: { disabled } } as never, observer);
          return null;
        }
        const view = render(page(<Upload disabled={fromMount} />));
        await flush();
        if (!fromMount) {
          view.rerender(page(<Upload disabled />));
          await flush();
        }
        const enable = async (): Promise<void> => {
          view.rerender(page(<Upload disabled={false} />));
          await flush();
        };
        return { heard, id: upload.machine.id, finish: upload.finish, enable };
      }

      test.each(OBSERVERS)(
        '%s of an actor that finished while disabled hears nothing when debug is turned on and it is previewed',
        async (_kind, object) => {
          const { heard, id, finish, enable } = await mountDisabled(object);
          await finish();
          const finished = heard.splice(0);

          await enable();
          if (previews) {
            await preview(id, ['failed']);
            await release(id);
          }
          expect({ finished, enabled: heard }).toEqual({
            finished: ['active:uploading', 'active:uploading', 'done:uploaded', ...(object ? ['complete'] : [])],
            enabled: [],
          });
        },
      );

      test.each(OBSERVERS)(
        '%s of an actor still running when debug is turned on sees the preview, then the real snapshot, once each',
        async (_kind, object) => {
          const { heard, id, enable } = await mountDisabled(object);
          await enable();
          if (previews) {
            await preview(id, ['failed']);
            await release(id);
          }
          expect(heard).toEqual([
            'active:uploading',
            'active:uploading',
            ...(previews ? ['active:failed', 'active:uploading'] : []),
          ]);
        },
      );
    });

    describe('Fast Refresh replaced the actor while debug was disabled', () => {
      test.each<[string, 'disabled' | 'enabled' | undefined]>([
        ['the user moves on before debug is turned on again', 'disabled'],
        ['the user moves on while debug is on', 'enabled'],
        ['the user stays put', undefined],
      ])("%s: turning debug on and off again leaves the observer on the current actor's state", async (_when, move) => {
        const id = freshId('wizard');
        const heard: string[] = [];
        let actorRef: AnyActorRef | undefined;
        type Props = { machine: ReturnType<typeof createWizardMachine>; disabled: boolean };
        function Wizard({ machine, disabled }: Props) {
          // An inline listener, as components usually write one: @xstate/react subscribes it to the current actor.
          actorRef = hooks.useActorRef(machine, { debug: { disabled } } as never, (snapshot: Snapshot) => {
            heard.push(label(snapshot));
          });
          return (
            <button type="button" onClick={() => actorRef?.send({ type: 'NEXT' })}>
              Next
            </button>
          );
        }
        const props: Props = { machine: createWizardMachine(id), disabled: false };
        const view = render(page(<Wizard {...props} />));
        await flush();
        const update = async (patch: Partial<Props>): Promise<void> => {
          Object.assign(props, patch);
          view.rerender(page(<Wizard {...props} />));
          await flush();
        };

        // A dev toggle takes the wizard out of the debugger.
        await update({ disabled: true });
        const mounted = heard.splice(0);
        // The developer edits the machine's module. @xstate/react replaces the actor, and carries its state over.
        const replaced = actorRef;
        await update({ machine: createWizardMachine(id) });
        const refreshed = { heard: heard.splice(0), replaced: actorRef !== replaced };
        if (move === 'disabled') await press('Next');
        // The toggle puts the wizard back in the debugger, and later takes it out again.
        await update({ disabled: false });
        if (move === 'enabled') await press('Next');
        await update({ disabled: true });
        const toggled = { heard: heard.splice(0), value: actorRef?.getSnapshot().value };
        await press('Next');
        expect({ mounted, refreshed, toggled, next: heard }).toEqual({
          mounted: ['active:account', 'active:account'],
          refreshed: { heard: ['active:account'], replaced: true },
          toggled:
            move === undefined ? { heard: [], value: 'account' } : { heard: ['active:address'], value: 'address' },
          next: [move === undefined ? 'active:address' : 'active:review'],
        });
      });
    });
  });
});
