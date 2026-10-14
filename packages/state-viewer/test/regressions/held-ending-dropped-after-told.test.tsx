// When @xstate/react stops a hook's actor (an <Activity> hides the component, StrictMode re-runs its effects), the hook
// ends the subscriptions made through its proxy along with @xstate/react's muted observers, except one still owed how
// the actor ended, which a preview held back. That one stays only until it hears the ending, then ends right there
// (spec §10.2, "Observers and the actor's ending"; R13). This covers subscribers without complete (a listener function,
// select().subscribe, an observer with next and error), which nothing else ends once they're told; one with complete
// ends on its complete. The subscriber hears the done snapshot when the preview ends: at the registry's next flush,
// which drops the preview of the instance that unregistered, or at the release, when the component registered again
// before that flush. Revealed again, the component restarts the finished actor under the same key, so the developer
// can preview it; the subscription made before the hook stopped the actor follows none of those previews, never hears
// done a second time, and leaves nothing listening to the page-wide registry. @xstate/react, which has no previews,
// tells it the ending once, when the actor finishes, and nothing after it stops the actor.

import { act, render } from '@testing-library/react';
import * as xstateReact from '@xstate/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fromCallback, setup, type Actor, type SnapshotFrom } from 'xstate';
import * as stateViewer from '../../src/xstate';
import { ACTOR_SELECT, flush, keyOf, onlyHandle, registry, resetRegistry } from '../xstate/helpers';

/** What the invoked worker uses to report the job finished, past the proxy (R12 blocks sends during a preview). */
let finish: (() => void) | undefined;

const jobMachine = setup({
  actors: {
    worker: fromCallback(({ sendBack }) => {
      finish = () => sendBack({ type: 'FINISHED' });
      return () => {
        finish = undefined;
      };
    }),
  },
}).createMachine({
  id: 'job',
  initial: 'running',
  states: {
    running: { invoke: { src: 'worker' }, on: { FINISHED: 'finished' } },
    waiting: {},
    finished: { type: 'final' },
  },
});

const Activity = (
  React as unknown as { Activity: React.ComponentType<{ mode: 'visible' | 'hidden'; children: React.ReactNode }> }
).Activity;

type Job = Actor<typeof jobMachine>;
type JobSnapshot = SnapshotFrom<typeof jobMachine>;
type Hooks = Pick<typeof xstateReact, 'useActorRef'>;

const IMPLEMENTATIONS: [name: string, hooks: Hooks, previews: boolean][] = [
  ['@xstate/react (control)', xstateReact, false],
  ['state-viewer/xstate', stateViewer as unknown as Hooks, true],
];

const entryOf = (snapshot: JobSnapshot): string => `${snapshot.status}:${snapshot.value}`;

/** Subscribers without complete, each recording what it hears as `status:value`. */
const SUBSCRIBERS: [kind: string, subscribe: (actorRef: Job, hear: (entry: string) => void) => void][] = [
  ['a listener function', (actorRef, hear) => actorRef.subscribe((snapshot) => hear(entryOf(snapshot)))],
  ['select().subscribe', (actorRef, hear) => actorRef.select(entryOf).subscribe(hear)],
  [
    'an observer with next and error',
    (actorRef, hear) =>
      actorRef.subscribe({ next: (snapshot) => hear(entryOf(snapshot)), error: () => hear('error') }),
  ],
];

const STRICT_MODES: [name: string, reactStrictMode: boolean][] = [
  ['under StrictMode', true],
  ['without StrictMode', false],
];

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

beforeEach(() => {
  resetRegistry();
  finish = undefined;
  // Previews of states without a recording or fixture warn about falling back to live context.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
});

describe.each(IMPLEMENTATIONS)('%s', (_name, hooks, previews) => {
  /**
   * Mounts the job's component in a visible Activity and subscribes `subscribe` through its actorRef. `take()` returns
   * what the subscriber heard since the last call; `shown()` is what the component's actorRef shows now.
   */
  async function mount(subscribe: (actorRef: Job, hear: (entry: string) => void) => void, reactStrictMode: boolean) {
    let current: Job | undefined;
    function JobPanel() {
      current = hooks.useActorRef(jobMachine);
      return null;
    }
    function App({ mode }: { mode: 'visible' | 'hidden' }) {
      return (
        <Activity mode={mode}>
          <JobPanel />
        </Activity>
      );
    }
    const view = render(<App mode="visible" />, { reactStrictMode });
    await flush();
    let heard: string[] = [];
    subscribe(current!, (entry) => heard.push(entry));
    return {
      take: (): string[] => {
        const taken = heard;
        heard = [];
        return taken;
      },
      shown: (): string => entryOf(current!.getSnapshot()),
      hide: () => view.rerender(<App mode="hidden" />),
      reveal: () => view.rerender(<App mode="visible" />),
    };
  }

  type Page = Awaited<ReturnType<typeof mount>>;

  /** Previews `waiting` on the job, as someone in the overlay would; only the adapter registers it. */
  async function previewWaiting(): Promise<void> {
    if (previews) act(() => registry().preview(keyOf(onlyHandle('job')), { leaves: ['waiting'] }));
    await flush();
  }

  async function release(): Promise<void> {
    if (previews) act(() => registry().release());
    await flush();
  }

  /** Previews `waiting`, and the real actor finishes underneath it (R13): the preview holds back the ending. */
  async function finishUnderPreview(page: Page): Promise<void> {
    await previewWaiting();
    expect(page.take()).toEqual(previews ? ['active:waiting'] : []);
    act(() => finish!());
    await flush();
    // The forced snapshot is made again when the invoked worker goes away, so a subscriber can be shown the preview
    // again; it isn't told the ending yet.
    expect(page.take().filter((entry) => entry !== 'active:waiting')).toEqual(previews ? [] : ['done:finished']);
  }

  /** The developer previews the actor the revealed component restarted, then releases it. */
  async function previewRestartedActor(page: Page): Promise<void> {
    await previewWaiting();
    expect(page.shown()).toBe(previews ? 'active:waiting' : 'done:finished');
    expect(page.take()).toEqual([]);
    await release();
    expect(page.shown()).toBe('done:finished');
    expect(page.take()).toEqual([]);
  }

  // XState's own actors have select() from XState 5.29.
  const subscribers =
    previews || ACTOR_SELECT ? SUBSCRIBERS : SUBSCRIBERS.filter(([kind]) => !kind.startsWith('select'));

  describe.each(subscribers)('%s made through the hook before an Activity hides the component', (_kind, subscribe) => {
    // Without StrictMode: under it React runs a revealed Activity's effects twice, and the second time the hook stops
    // the actor would end the subscription, already told, by itself.
    test('the actor finished under a preview, and the registry flushed while it was hidden: told the ending at the flush, it follows no preview after the reveal', async () => {
      const listening = countOverrideListeners();
      const page = await mount(subscribe, false);
      await finishUnderPreview(page);

      page.hide();
      await flush();
      await flush();
      // The registry dropped the preview of the instance that unregistered, which ended the preview.
      expect(page.take()).toEqual(previews ? ['done:finished'] : []);
      expect(registry().getSnapshot().overrides).toEqual({});

      page.reveal();
      await flush();
      expect(page.take()).toEqual([]);
      expect(listening()).toBe(0);

      await previewRestartedActor(page);
      expect(listening()).toBe(0);
    });

    test.each(STRICT_MODES)(
      'the actor finished under a preview, and the component was revealed before the registry flushed (%s): told the ending at the release, it follows no later preview',
      async (_mode, reactStrictMode) => {
        const listening = countOverrideListeners();
        const page = await mount(subscribe, reactStrictMode);
        await finishUnderPreview(page);

        page.hide();
        page.reveal();
        await flush();
        // The instance registered again before the registry's flush, so the preview stays and still holds the ending.
        if (previews) expect(Object.keys(registry().getSnapshot().overrides)).toEqual([keyOf(onlyHandle('job'))]);
        expect(page.take()).toEqual([]);

        await release();
        expect(page.take()).toEqual(previews ? ['done:finished'] : []);
        expect(listening()).toBe(0);

        await previewRestartedActor(page);
        expect(listening()).toBe(0);
      },
    );

    test('the actor finished before any preview: told the ending at once, it follows no preview after the reveal', async () => {
      const listening = countOverrideListeners();
      const page = await mount(subscribe, false);
      act(() => finish!());
      await flush();
      expect(page.take()).toEqual(['done:finished']);

      page.hide();
      await flush();
      await flush();
      page.reveal();
      await flush();
      expect(page.take()).toEqual([]);
      expect(listening()).toBe(0);

      await previewRestartedActor(page);
      expect(listening()).toBe(0);
    });
  });
});
