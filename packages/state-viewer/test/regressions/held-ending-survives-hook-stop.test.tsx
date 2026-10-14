// A subscription made through a hook's proxy, such as a waitFor an event handler starts, hears how the actor ended even
// when a preview held that back and the component goes away before the preview ends (spec §10.2, "Observers and the
// actor's ending", R13). When the hook's actor finishes or fails while a preview shows, the subscription keeps following
// the preview and is owed the ending. If the component then unmounts, or an <Activity> hides it, the hook ends the
// proxy's subscriptions along with @xstate/react's stop, but not one still owed the ending: that one gets the done
// snapshot, then complete (or error), when the preview ends, which is at the registry's next flush, where it drops the
// preview of the instance that unregistered, or when the developer releases the preview before then. So waitFor resolves
// with the real done snapshot, or rejects with the actor's error, as it does with @xstate/react, which tells it when the
// actor finishes, and nothing of the actor is left listening to the page-wide registry afterwards. A subscription owed
// nothing, because the actor was still running, ends silently with the hook's actor, as with @xstate/react.

import { act, render, screen } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fromCallback, setup, waitFor, type AnyActorRef } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { flush, HAS_ACTIVITY, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

const Activity = (
  React as unknown as { Activity: React.ComponentType<{ mode: 'visible' | 'hidden'; children: React.ReactNode }> }
).Activity;

type Answer = 'SAVED' | 'REJECTED';

/** What the invoked save request uses to answer, as a server response would, past the proxy (R12 blocks its send). */
let respond: ((type: Answer) => void) | undefined;

const formMachine = setup({
  actors: {
    save: fromCallback(({ sendBack }) => {
      respond = (type) => sendBack({ type });
      return () => {
        respond = undefined;
      };
    }),
  },
}).createMachine({
  id: 'form',
  initial: 'editing',
  states: {
    editing: { on: { SUBMIT: 'saving' } },
    saving: {
      invoke: { src: 'save' },
      on: {
        SAVED: 'saved',
        REJECTED: {
          actions: () => {
            throw new Error('Save rejected');
          },
        },
      },
    },
    failed: {},
    saved: { type: 'final' },
  },
});

type Hooks = Pick<typeof xstateReact, 'useActorRef'>;
const svHooks = stateViewer as unknown as Hooks;

const IMPLEMENTATIONS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['state-viewer/xstate', svHooks, true],
];

const CLOSINGS: [how: string, withActivity: boolean][] = [
  ['unmounts', false],
  // React 18 has no <Activity>.
  ...(HAS_ACTIVITY ? [['is hidden by an Activity', true] as [string, boolean]] : []),
];

const ANSWERS: [result: string, answer: Answer][] = [
  ['succeeds', 'SAVED'],
  ['fails', 'REJECTED'],
];

/** How the page's waitFor settles, and the status it shows then. */
const HEARD: Record<Answer, { outcome: string; status: string }> = {
  SAVED: { outcome: 'resolved:done:saved', status: 'saved' },
  REJECTED: { outcome: 'rejected:Save rejected', status: 'error' },
};

/** Counts the registry override listeners added from now on and not removed yet. */
function countOverrideListeners(): () => number {
  const target = registry();
  const original = target.onOverride.bind(target);
  let active = 0;
  vi.spyOn(target, 'onOverride').mockImplementation((key, listener) => {
    active++;
    const off = original(key, listener);
    let on = true;
    return () => {
      if (on) {
        on = false;
        active--;
      }
      off();
    };
  });
  return () => active;
}

/**
 * A page that tracks the save of a form shown in a dialog: the form's submit handler hands its actor to the page,
 * which awaits waitFor on it, logs how it settled and shows the outcome. A closed dialog unmounts the form, or, with
 * `withActivity`, an Activity hides it.
 */
function setupPage(hooks: Hooks, withActivity: boolean, log: string[]) {
  let track: ((actorRef: AnyActorRef) => void) | undefined;
  function Form() {
    const actorRef = hooks.useActorRef(formMachine);
    return (
      <button
        onClick={() => {
          actorRef.send({ type: 'SUBMIT' });
          track?.(actorRef);
        }}
      >
        Save
      </button>
    );
  }
  function Page({ dialog }: { dialog: 'open' | 'closed' }) {
    const [status, setStatus] = React.useState('idle');
    track = (actorRef) => {
      setStatus('saving');
      waitFor(actorRef, (snapshot) => snapshot.status === 'done').then(
        (snapshot) => {
          log.push(`resolved:${snapshot.status}:${String(snapshot.value)}`);
          setStatus('saved');
        },
        (error: Error) => {
          log.push(`rejected:${error.message}`);
          setStatus('error');
        },
      );
    };
    const form = withActivity ? (
      <Activity mode={dialog === 'open' ? 'visible' : 'hidden'}>
        <Form />
      </Activity>
    ) : (
      dialog === 'open' && <Form />
    );
    return (
      <>
        <output>{status}</output>
        {form}
      </>
    );
  }
  return Page;
}

/**
 * Opens the page and submits the form, then someone looks at `failed` in the overlay (when the implementation has
 * one) while the server answers, if `answer` is given. Returns the page's log, with `answer` written just before the
 * server answers, and `close`, which writes `close` and closes the dialog.
 */
async function submitAndAnswerDuringPreview(
  hooks: Hooks,
  previews: boolean,
  withActivity: boolean,
  answer: Answer | undefined,
) {
  const log: string[] = [];
  const Page = setupPage(hooks, withActivity, log);
  const view = render(<Page dialog="open" />);
  await flush();
  act(() => screen.getByRole('button').click());
  await flush();
  expect(screen.getByRole('status').textContent).toBe('saving');

  const key = previews ? keyOf(onlyHandle('form')) : undefined;
  if (key) act(() => registry().preview(key, { leaves: ['failed'] }));
  await flush();
  if (answer) {
    log.push('answer');
    // The real actor keeps running underneath the preview (R13).
    act(() => respond!(answer));
    await flush();
  }
  const close = (): void => {
    log.push('close');
    view.rerender(<Page dialog="closed" />);
  };
  return { log, key, close };
}

beforeEach(() => {
  resetRegistry();
  respond = undefined;
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe.each(IMPLEMENTATIONS)('%s', (_name, hooks, previews) => {
  describe.each(CLOSINGS)('the dialog %s before the preview is released', (_how, withActivity) => {
    test.each(ANSWERS)('the save %s during the preview: the page hears it', async (_result, answer) => {
      const active = countOverrideListeners();
      const page = await submitAndAnswerDuringPreview(hooks, previews, withActivity, answer);
      page.close();
      await flush();
      await flush();

      // @xstate/react tells waitFor when the actor ends; the proxy, once the registry drops the preview of the
      // instance that unregistered.
      const { outcome, status } = HEARD[answer];
      expect(page.log).toEqual(previews ? ['answer', 'close', outcome] : ['answer', outcome, 'close']);
      expect(screen.getByRole('status').textContent).toBe(status);
      expect(registry().getSnapshot().machines).toEqual([]);
      expect(registry().getSnapshot().overrides).toEqual({});
      expect(active()).toBe(0);
    });

    test('the save still running: the page keeps waiting, as the hook stops the actor', async () => {
      const active = countOverrideListeners();
      const page = await submitAndAnswerDuringPreview(hooks, previews, withActivity, undefined);
      page.close();
      await flush();
      await flush();

      expect(page.log).toEqual(['close']);
      expect(screen.getByRole('status').textContent).toBe('saving');
      expect(registry().getSnapshot().overrides).toEqual({});
      expect(active()).toBe(0);
    });
  });
});

describe('state-viewer/xstate: the developer releases the preview', () => {
  test.each(ANSWERS)('the save %s during the preview, released while the dialog is open', async (_result, answer) => {
    const page = await submitAndAnswerDuringPreview(svHooks, true, false, answer);
    expect(page.log).toEqual(['answer']);

    page.log.push('release');
    act(() => registry().release());
    await flush();

    const { outcome, status } = HEARD[answer];
    expect(page.log).toEqual(['answer', 'release', outcome]);
    expect(screen.getByRole('status').textContent).toBe(status);
  });

  test.each(CLOSINGS)(
    'the dialog %s, then the preview is released before the registry flushes',
    async (_how, withActivity) => {
      const active = countOverrideListeners();
      const page = await submitAndAnswerDuringPreview(svHooks, true, withActivity, 'SAVED');
      page.close();
      // The registry keeps the preview of the instance that unregistered until its next flush.
      expect(Object.keys(registry().getSnapshot().overrides)).toEqual([page.key]);

      page.log.push('release');
      act(() => registry().release());
      await flush();

      expect(page.log).toEqual(['answer', 'close', 'release', 'resolved:done:saved']);
      expect(screen.getByRole('status').textContent).toBe('saved');
      expect(registry().getSnapshot().overrides).toEqual({});
      expect(active()).toBe(0);
    },
  );
});
