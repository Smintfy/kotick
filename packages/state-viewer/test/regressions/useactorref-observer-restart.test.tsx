// An observer given to useActorRef hears what @xstate/react delivers to it when @xstate/react restarts an actor that
// already ended (spec §10.2, "Observers and the actor's ending"). An <Activity> that hides the component stops the
// actor with stopRootWithRehydration, which puts the done (or error) snapshot back, and starts it again when it
// reveals the component; StrictMode's simulated remount does the same to a machine that is done as soon as it starts.
// XState then sends every subscribed observer the done snapshot and complete again, or the error again, and the
// observer hears it as many times as with @xstate/react, whether the component passes the same observer on every
// render or a new one. What the hook remembers telling the observer only keeps previews from it: a preview applied
// after the restart reaches no observer that has heard how the actor ended, and its release doesn't repeat the ending.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createMachine, type Actor, type Observer } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { describeWithActivity, flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

const BROKEN = 'Broken on purpose';

const uploadMachine = createMachine({
  id: 'upload',
  initial: 'uploading',
  states: {
    uploading: {
      on: {
        UPLOADED: 'uploaded',
        BREAK: {
          actions: () => {
            throw new Error(BROKEN);
          },
        },
      },
    },
    failed: {},
    uploaded: { type: 'final' },
  },
});

/** Done as soon as it starts. `idle` is only there to be previewed. */
const instantMachine = createMachine({
  id: 'instant',
  initial: 'done',
  states: { idle: {}, done: { type: 'final' } },
});

type Hooks = Pick<typeof xstateReact, 'useActorRef'>;
type Form = 'stable' | 'inline';

const IMPLEMENTATIONS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
];

const FORMS: [observer: string, form: Form][] = [
  ['a stable', 'stable'],
  ['an inline', 'inline'],
];

// StrictMode runs a revealed component's effects twice, so @xstate/react restarts the actor twice on reveal.
const MODES: [mode: string, strict: boolean, restarts: number][] = [
  ['under StrictMode', true, 2],
  ['without StrictMode', false, 1],
];

const FINISHED = ['next:done:uploaded', 'complete'];
const FAILED = [`error:${BROKEN}`];

const ENDINGS: [ending: string, event: 'UPLOADED' | 'BREAK', told: string[]][] = [
  ['finishes', 'UPLOADED', FINISHED],
  ['fails', 'BREAK', FAILED],
];

const Activity = (
  React as unknown as {
    Activity: React.ComponentType<{ mode: 'visible' | 'hidden'; children: React.ReactNode }>;
  }
).Activity;

/**
 * Records what an observer hears, phase by phase; nothing is recorded before the first phase. `observer()` is what
 * the component passes to useActorRef on a render: the same object every time when `stable`, a new one otherwise.
 */
function createRecorder(form: Form) {
  const heard: Record<string, string[]> = {};
  let current: string[] = [];
  const observer: Observer<{ status: string; value: unknown }> = {
    next: (snapshot) => current.push(`next:${snapshot.status}:${String(snapshot.value)}`),
    error: (error) => current.push(`error:${(error as Error).message}`),
    complete: () => current.push('complete'),
  };
  return {
    heard,
    observer: () => (form === 'stable' ? observer : { ...observer }),
    phase(name: string): void {
      current = heard[name] = [];
    },
  };
}

/**
 * Someone previews each of `leaves` of the machine in the overlay, then closes it. @xstate/react has no previews, so
 * its control rows only wait as long.
 */
async function lookAround(previews: boolean, machineId: string, leaves: string[][]): Promise<void> {
  const key = previews ? keyOf(onlyHandle(machineId)) : undefined;
  for (const leaf of leaves) {
    if (key) {
      act(() => registry().preview(key, { leaves: leaf }));
      expect(registry().getOverride(key)).toBeDefined();
    }
    await flush();
  }
  if (key) act(() => registry().release());
  await flush();
}

/**
 * Mounts the upload inside an Activity and ends it with `event`, optionally re-renders the component once it ended,
 * then hides and reveals it and previews it. Returns what the observer heard in each phase from the ending on.
 */
async function endHideReveal(
  hooks: Hooks,
  previews: boolean,
  { form, event, strict, rerender }: { form: Form; event: 'UPLOADED' | 'BREAK'; strict: boolean; rerender: boolean },
): Promise<Record<string, string[]>> {
  const { heard, observer, phase } = createRecorder(form);
  let actorRef: Actor<typeof uploadMachine> | undefined;
  function Upload() {
    actorRef = hooks.useActorRef(uploadMachine, undefined, observer());
    return null;
  }
  function App({ mode }: { mode: 'visible' | 'hidden' }) {
    return (
      <Activity mode={mode}>
        <Upload />
      </Activity>
    );
  }
  const view = render(<App mode="visible" />, { reactStrictMode: strict });
  await flush();

  phase('ending');
  act(() => actorRef?.send({ type: event }));
  await flush();
  if (rerender) {
    phase('rerender');
    view.rerender(<App mode="visible" />);
    await flush();
  }
  phase('hide');
  view.rerender(<App mode="hidden" />);
  await flush();
  phase('reveal');
  view.rerender(<App mode="visible" />);
  await flush();
  phase('preview');
  await lookAround(previews, 'upload', [['failed'], ['uploading']]);
  return heard;
}

/** Mounts a machine that is done as soon as it starts, then previews it. Returns what the observer heard. */
async function mountInstant(
  hooks: Hooks,
  previews: boolean,
  { form, strict }: { form: Form; strict: boolean },
): Promise<Record<string, string[]>> {
  const { heard, observer, phase } = createRecorder(form);
  function Instant() {
    hooks.useActorRef(instantMachine, undefined, observer());
    return null;
  }
  phase('mount');
  render(<Instant />, { reactStrictMode: strict });
  await flush();
  phase('preview');
  await lookAround(previews, 'instant', [['idle']]);
  return heard;
}

const repeat = (calls: string[], times: number): string[] => Array.from({ length: times }, () => calls).flat();

beforeEach(() => {
  resetRegistry();
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe.each(IMPLEMENTATIONS)('%s: an observer given to useActorRef', (_name, hooks, previews) => {
  describeWithActivity.each(MODES)('%s, an Activity hiding and revealing the component', (_mode, strict, restarts) => {
    describe.each(ENDINGS)('after the actor %s', (_ending, event, told) => {
      test.each(FORMS)(
        '%s observer hears the ending again on each restart, and no preview',
        async (_observer, form) => {
          const heard = await endHideReveal(hooks, previews, { form, event, strict, rerender: false });

          expect(heard).toEqual({ ending: told, hide: [], reveal: repeat(told, restarts), preview: [] });
        },
      );

      test.each(FORMS)(
        '%s observer, passed again once the actor ended, hears the ending again on each restart, and no preview',
        async (_observer, form) => {
          const heard = await endHideReveal(hooks, previews, { form, event, strict, rerender: true });

          // @xstate/react subscribes a new inline observer to the ended actor, and XState tells it the ending without a
          // snapshot: complete for a finished actor, the error for a failed one. A stable one isn't subscribed again.
          const rerender = form === 'inline' ? told.slice(-1) : [];
          expect(heard).toEqual({ ending: told, rerender, hide: [], reveal: repeat(told, restarts), preview: [] });
        },
      );
    });
  });

  describe('of a machine done as soon as it starts', () => {
    test.each(FORMS)(
      '%s observer hears the ending again when StrictMode remounts the component, and no preview',
      async (_observer, form) => {
        const heard = await mountInstant(hooks, previews, { form, strict: true });

        expect(heard).toEqual({ mount: repeat(['next:done:done', 'complete'], 2), preview: [] });
      },
    );

    test.each(FORMS)(
      '%s observer hears the ending once without StrictMode, and no preview',
      async (_observer, form) => {
        const heard = await mountInstant(hooks, previews, { form, strict: false });

        expect(heard).toEqual({ mount: ['next:done:done', 'complete'], preview: [] });
      },
    );
  });
});
