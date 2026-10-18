import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { connect, createActorContext, useActorRef, useMachine, useSelector } from 'state-viewer/xstate';
import { describe, expect, onTestFinished, test } from 'vitest';
import {
  createActor,
  createMachine,
  fromCallback,
  setup,
  waitFor,
  type Actor,
  type AnyActorRef,
  type AnyStateMachine,
  type Observer,
} from 'xstate';
import { page, press } from '../support/app';
import { alerts, Boundary } from '../support/boundary';
import { uncaught } from '../support/console';
import { ACTOR_SELECT, describeWithActivity, IMPLEMENTATIONS } from '../support/hooks';
import { badge, clickLeaf, flush, freshId, machines, overlay, preview, release, releaseAll } from '../support/panel';

const BROKEN = 'Upload broken';

/** The system id of the upload's actor. The server sends to the real actor by it, so a preview doesn't block it. */
const UPLOAD = 'upload';

function createUploadMachine() {
  return setup({ types: { events: {} as { type: 'UPLOADED' } | { type: 'BREAK' } } }).createMachine({
    id: freshId('upload'),
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
      paused: {},
      failed: {},
      uploaded: { type: 'final' },
    },
  });
}

/** What an observer records of a snapshot. Every machine snapshot has these. */
type Recorded = { status: string; value: unknown };
type RecordingObserver = Observer<Recorded> | ((snapshot: Recorded) => void);

function entry(snapshot: Recorded): string {
  return `${snapshot.status} ${String(snapshot.value)}`;
}

/** A listener function that records each snapshot in `heard`. */
function listenerInto(heard: string[]): (snapshot: Recorded) => void {
  return (snapshot) => heard.push(`next ${entry(snapshot)}`);
}

/** An observer object that records each call in `heard`. Without `error`, XState reports a failure as unhandled. */
function observerInto(heard: string[], { error = true } = {}): Observer<Recorded> {
  const observer: Observer<Recorded> = {
    next: (snapshot) => heard.push(`next ${entry(snapshot)}`),
    complete: () => heard.push('complete'),
  };
  if (error) observer.error = (cause) => heard.push(`error ${(cause as Error).message}`);
  return observer;
}

/** What the server sends to the real actor of the upload, as a socket would, past the proxy. */
function Server({ actorRef }: { actorRef: AnyActorRef }) {
  const send = (type: 'UPLOADED' | 'BREAK') => (actorRef.system.get(UPLOAD) as AnyActorRef).send({ type });
  return (
    <>
      <button type="button" onClick={() => send('UPLOADED')}>
        Finish upload
      </button>
      <button type="button" onClick={() => send('BREAK')}>
        Break upload
      </button>
    </>
  );
}

function shown(name = 'upload'): string | null {
  return screen.getByRole('status', { name }).textContent;
}

/** Previews `first`, clicks `then`, and releases the preview, as a developer who looks around does. */
async function lookAround(machineId: string, first: string, then: string): Promise<void> {
  await preview(machineId, [first]);
  await clickLeaf(then);
  await release(machineId);
}

/** The Release all row of the machine list, for a click that the overlay's flush doesn't follow at once. */
function releaseAllButton(): HTMLButtonElement {
  const found = [...overlay().querySelectorAll('button')].find(
    (button) => button.querySelector('[data-part="row-label"]')?.textContent === 'Release all',
  );
  if (!found) throw new Error('The machine list has no Release all button.');
  return found;
}

function messages(errors: unknown[]): string[] {
  return errors.map((error) => (error as Error).message);
}

describe.each(IMPLEMENTATIONS)(
  'the observer given to useActorRef, like @xstate/react, with %s',
  (_, hooks, previews) => {
    test.each<[string, (heard: string[]) => RecordingObserver, string[]]>([
      ['a listener function', listenerInto, ['next done uploaded']],
      ['an observer object', observerInto, ['next done uploaded', 'complete']],
    ])(
      '%s gets the done snapshot last once the preview that hid it is released, and nothing on later previews',
      async (_form, observe, ending) => {
        const machine = createUploadMachine();
        const heard: string[] = [];
        const observer = observe(heard);
        function Upload() {
          return <Server actorRef={hooks.useActorRef(machine, { systemId: UPLOAD }, observer)} />;
        }
        render(page(<Upload />));
        await flush();

        const started = heard.splice(0);
        if (previews) await preview(machine.id, ['failed']);
        const previewed = heard.splice(0);
        await press('Finish upload');
        const finished = heard.splice(0);
        if (previews) await release(machine.id);
        const released = heard.splice(0);
        if (previews) await lookAround(machine.id, 'failed', 'uploading');
        expect({ started, previewed, finished, released, later: heard }).toEqual({
          // StrictMode starts the actor twice.
          started: ['next active uploading', 'next active uploading'],
          previewed: previews ? ['next active failed'] : [],
          finished: previews ? [] : ending,
          released: previews ? ending : [],
          later: [],
        });
      },
    );
  },
);

describe('the component renders again between the ending and the release', () => {
  describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks, previews) => {
    // Apps usually pass an inline observer, a new one on each render, which @xstate/react subscribes again each time.
    test.each<[string, (heard: string[]) => () => RecordingObserver, string[]]>([
      ['an inline listener', (heard) => () => listenerInto(heard), ['next done uploaded']],
      [
        'a stable listener (useCallback)',
        (heard) => {
          const listener = listenerInto(heard);
          return () => listener;
        },
        ['next done uploaded'],
      ],
      [
        'an inline observer object',
        (heard) => () => observerInto(heard),
        // @xstate/react subscribes the observer of the new render to the ended actor, and XState completes it.
        // The preview held the ending back, so the observer of the new render hears it once, on the release.
        previews ? ['next done uploaded', 'complete'] : ['next done uploaded', 'complete', 'complete'],
      ],
    ])(
      '%s hears the upload finish once, though the component re-rendered before the release',
      async (_observer, make, ending) => {
        const machine = createUploadMachine();
        const heard: string[] = [];
        const observer = make(heard);
        function Upload({ hint }: { hint: string }) {
          const actorRef = hooks.useActorRef(machine, { systemId: UPLOAD }, observer());
          return (
            <>
              <p>{hint}</p>
              <Server actorRef={actorRef} />
            </>
          );
        }
        const view = render(page(<Upload hint="Uploading" />));
        await flush();
        heard.length = 0;

        if (previews) await preview(machine.id, ['failed']);
        await press('Finish upload');
        // A change in the parent renders the component again with a new prop.
        view.rerender(page(<Upload hint="Still uploading" />));
        await flush();
        const rerendered = heard.splice(0);
        if (previews) await release(machine.id);
        expect({ rerendered, released: heard }).toEqual({
          rerendered: previews ? ['next active failed'] : ending,
          released: previews ? ending : [],
        });
      },
    );

    test('an inline listener hears it when useSelector in the same component follows the preview', async () => {
      const machine = createUploadMachine();
      const heard: string[] = [];
      function Upload() {
        const actorRef = hooks.useActorRef(machine, { systemId: UPLOAD }, listenerInto(heard));
        const value = hooks.useSelector(actorRef, (snapshot) => String(snapshot.value));
        return (
          <>
            <output aria-label="upload">{value}</output>
            <Server actorRef={actorRef} />
          </>
        );
      }
      render(page(<Upload />));
      await flush();
      heard.length = 0;

      if (previews) await preview(machine.id, ['failed']);
      await press('Finish upload');
      // The developer clicks another state, and the component renders again through useSelector.
      if (previews) await clickLeaf('uploading');
      const previewing = { shown: shown(), heard: heard.splice(0) };
      if (previews) await release(machine.id);
      expect({ previewing, released: { shown: shown(), heard } }).toEqual({
        previewing: previews
          ? { shown: 'uploading', heard: ['next active failed', 'next active uploading'] }
          : { shown: 'uploaded', heard: ['next done uploaded'] },
        released: { shown: 'uploaded', heard: previews ? ['next done uploaded'] : [] },
      });
    });
  });
});

describe('the actor finished while no preview was on', () => {
  describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks, previews) => {
    /**
     * Mounts the upload, which passes a new observer to useActorRef on each render and reads the actor with
     * useSelector. Then the upload finishes, and the developer looks at two states of the finished upload.
     */
    async function finishThenLookAround(heard: string[], makeObserver: () => RecordingObserver) {
      const machine = createUploadMachine();
      function Upload() {
        const actorRef = hooks.useActorRef(machine, { systemId: UPLOAD }, makeObserver());
        const value = hooks.useSelector(actorRef, (snapshot) => String(snapshot.value));
        return (
          <>
            <output aria-label="upload">{value}</output>
            <Server actorRef={actorRef} />
          </>
        );
      }
      render(page(<Upload />));
      await flush();
      heard.length = 0;

      await press('Finish upload');
      const finished = heard.splice(0);
      if (previews) await lookAround(machine.id, 'failed', 'uploading');
      return { finished, shown: shown(), later: heard };
    }

    test('an inline listener hears nothing more once it heard the upload finish', async () => {
      const heard: string[] = [];
      expect(await finishThenLookAround(heard, () => listenerInto(heard))).toEqual({
        finished: ['next done uploaded'],
        shown: 'uploaded',
        later: [],
      });
    });

    test('an inline observer object gets the done snapshot only once, and complete each time it is subscribed again', async () => {
      const heard: string[] = [];
      expect(await finishThenLookAround(heard, () => observerInto(heard))).toEqual({
        // The component renders again when the upload finishes, with a new observer.
        finished: ['next done uploaded', 'complete', 'complete'],
        shown: 'uploaded',
        // It renders again for the preview, the click and the release.
        later: previews ? ['complete', 'complete', 'complete'] : [],
      });
    });
  });

  describe('a parent re-rendering the component while a preview shows over the finished actor', () => {
    test.each<[string, (heard: string[]) => () => RecordingObserver]>([
      ['an inline listener', (heard) => () => listenerInto(heard)],
      [
        'a stable listener',
        (heard) => {
          const listener = listenerInto(heard);
          return () => listener;
        },
      ],
    ])('passes nothing more to %s', async (_, make) => {
      const machine = createUploadMachine();
      const heard: string[] = [];
      const observer = make(heard);
      function Upload({ hint }: { hint: string }) {
        const actorRef = useActorRef(machine, { systemId: UPLOAD }, observer());
        return (
          <>
            <p>{hint}</p>
            <Server actorRef={actorRef} />
          </>
        );
      }
      const view = render(page(<Upload hint="a" />));
      await flush();
      heard.length = 0;

      await press('Finish upload');
      const finished = heard.splice(0);
      await preview(machine.id, ['failed']);
      view.rerender(page(<Upload hint="b" />));
      await flush();
      await release(machine.id);
      expect({ finished, later: heard }).toEqual({ finished: ['next done uploaded'], later: [] });
    });
  });
});

describe('the actor fails', () => {
  describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks, previews) => {
    test.each([
      ['with an error callback, the observer gets the error last, and the error is not reported as unhandled', true],
      [
        'without an error callback, the observer gets nothing for the failure, and XState reports the error as unhandled',
        false,
      ],
    ])('%s, and nothing when the failed actor is previewed', async (_, error) => {
      const machine = createUploadMachine();
      const heard: string[] = [];
      const observer = observerInto(heard, { error });
      function Upload() {
        return <Server actorRef={hooks.useActorRef(machine, { systemId: UPLOAD }, observer)} />;
      }
      render(page(<Upload />));
      await flush();
      heard.length = 0;

      const errors = await uncaught(() => fireEvent.click(screen.getByRole('button', { name: 'Break upload' })));
      const failed = heard.splice(0);
      if (previews) await lookAround(machine.id, 'failed', 'uploading');
      expect({ uncaught: messages(errors), failed, later: heard }).toEqual({
        uncaught: error ? [] : [BROKEN],
        failed: error ? [`error ${BROKEN}`] : [],
        later: [],
      });
    });
  });
});

describe('an observer passed only after the actor ended', () => {
  // The component passes its observer only while its panel is open: `panelOpen ? onChange : undefined`.
  // @xstate/react subscribes it to an actor that XState stopped, and XState calls only its complete or error.
  describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks, previews) => {
    /**
     * Mounts the upload with its panel closed. `lookAround()` records a marker in `heard` for each step: the developer
     * previews the ended upload, the user opens the panel, the developer clicks another state and releases the preview.
     */
    async function mountUpload(heard: string[], observer: RecordingObserver) {
      const machine = createUploadMachine();
      function Upload({ panelOpen }: { panelOpen: boolean }) {
        return <Server actorRef={hooks.useActorRef(machine, { systemId: UPLOAD }, panelOpen ? observer : undefined)} />;
      }
      const view = render(page(<Upload panelOpen={false} />));
      await flush();
      const setPanel = async (panelOpen: boolean) => {
        view.rerender(page(<Upload panelOpen={panelOpen} />));
        await flush();
      };
      return {
        setPanel,
        previewPaused: async () => {
          if (!previews) return;
          await preview(machine.id, ['paused']);
          await release(machine.id);
        },
        lookAround: async () => {
          heard.push('[preview failed]');
          if (previews) await preview(machine.id, ['failed']);
          heard.push('[panel opens]');
          await setPanel(true);
          heard.push('[click paused]');
          if (previews) await clickLeaf('paused');
          heard.push('[release]');
          if (previews) await release(machine.id);
        },
      };
    }

    test('a listener passed after the upload finished hears nothing', async () => {
      const heard: string[] = [];
      const upload = await mountUpload(heard, listenerInto(heard));
      await press('Finish upload');

      await upload.lookAround();
      expect(heard).toEqual(['[preview failed]', '[panel opens]', '[click paused]', '[release]']);
    });

    test('an observer passed after the upload finished hears complete only, at once', async () => {
      const heard: string[] = [];
      const upload = await mountUpload(heard, observerInto(heard));
      await press('Finish upload');

      await upload.lookAround();
      expect(heard).toEqual(['[preview failed]', '[panel opens]', 'complete', '[click paused]', '[release]']);
    });

    test('an observer shown the upload before the panel closed hears only complete when it reopens', async () => {
      const heard: string[] = [];
      const upload = await mountUpload(heard, observerInto(heard));
      await upload.setPanel(true);
      await upload.previewPaused();
      await upload.setPanel(false);
      await press('Finish upload');
      const earlier = heard.splice(0);

      await upload.lookAround();
      expect({ earlier, heard }).toEqual({
        earlier: previews ? ['next active paused', 'next active uploading'] : [],
        heard: ['[preview failed]', '[panel opens]', 'complete', '[click paused]', '[release]'],
      });
    });

    test('an error callback passed after the upload failed hears the error at once', async () => {
      const heard: string[] = [];
      const upload = await mountUpload(heard, observerInto(heard));
      // No observer has an error callback yet, so XState reports the failure as unhandled.
      const errors = await uncaught(() => fireEvent.click(screen.getByRole('button', { name: 'Break upload' })));

      await upload.lookAround();
      expect({ uncaught: messages(errors), heard }).toEqual({
        uncaught: [BROKEN],
        heard: ['[preview failed]', '[panel opens]', `error ${BROKEN}`, '[click paused]', '[release]'],
      });
    });
  });
});

describe('@xstate/react restarts an actor that ended', () => {
  // XState sends the ending again to each observer when @xstate/react restarts the actor.
  // A preview after the restart reaches no observer that heard how the actor ended.
  const KINDS: [observer: string, inline: boolean][] = [
    ['a stable', false],
    ['an inline', true],
  ];

  /** Records each call in the current phase. With `inline`, `observer()` makes a new observer on each call. */
  function createRecorder(inline: boolean) {
    const heard: Record<string, string[]> = {};
    let current: string[] = [];
    const observer: Observer<Recorded> = {
      next: (snapshot) => current.push(`next ${entry(snapshot)}`),
      error: (cause) => current.push(`error ${(cause as Error).message}`),
      complete: () => current.push('complete'),
    };
    return {
      heard,
      observer: () => (inline ? { ...observer } : observer),
      phase(name: string): void {
        current = heard[name] = [];
      },
    };
  }

  describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks, previews) => {
    // StrictMode runs the effects of a revealed component twice, so @xstate/react restarts the actor twice.
    describeWithActivity.each([
      ['under StrictMode', true, 2],
      ['without StrictMode', false, 1],
    ])('%s, an Activity hides and reveals the component', (_mode, strict, restarts) => {
      describe.each([
        ['finishes', 'Finish upload', ['next done uploaded', 'complete']],
        ['fails', 'Break upload', [`error ${BROKEN}`]],
      ])('after the actor %s', (_ending, button, told) => {
        /** Ends the upload, renders it again if `rerender`, hides and reveals it, then looks at it in the overlay. */
        async function endHideReveal(inline: boolean, rerender: boolean): Promise<Record<string, string[]>> {
          const machine = createUploadMachine();
          const { heard, observer, phase } = createRecorder(inline);
          function Upload() {
            return <Server actorRef={hooks.useActorRef(machine, { systemId: UPLOAD }, observer())} />;
          }
          const app = (mode: 'visible' | 'hidden') =>
            page(
              <React.Activity mode={mode}>
                <Upload />
              </React.Activity>,
            );
          const view = render(app('visible'), { reactStrictMode: strict });
          await flush();

          phase('ending');
          await press(button);
          if (rerender) {
            phase('rerender');
            view.rerender(app('visible'));
            await flush();
          }
          phase('hide');
          view.rerender(app('hidden'));
          await flush();
          phase('reveal');
          view.rerender(app('visible'));
          await flush();
          phase('preview');
          if (previews) await lookAround(machine.id, 'failed', 'uploading');
          return heard;
        }

        const restarted = Array.from({ length: restarts }, () => told).flat();

        test.each(KINDS)(
          '%s observer hears the ending again on each restart, and no preview',
          async (_kind, inline) => {
            expect(await endHideReveal(inline, false)).toEqual({
              ending: told,
              hide: [],
              reveal: restarted,
              preview: [],
            });
          },
        );

        test.each(KINDS)(
          '%s observer, passed again once the actor ended, hears the ending again on each restart, and no preview',
          async (_kind, inline) => {
            expect(await endHideReveal(inline, true)).toEqual({
              ending: told,
              // @xstate/react subscribes an inline observer to the ended actor, and XState tells it only how it ended.
              // It doesn't subscribe a stable observer again.
              rerender: inline ? told.slice(-1) : [],
              hide: [],
              reveal: restarted,
              preview: [],
            });
          },
        );
      });
    });

    describe('of a machine done as soon as it starts', () => {
      /** Mounts a machine that is done at once, then looks at it in the overlay. */
      async function mountInstant(inline: boolean, reactStrictMode: boolean) {
        const machine = createMachine({
          id: freshId('instant'),
          initial: 'done',
          states: { idle: {}, done: { type: 'final' } },
        });
        const { heard, observer, phase } = createRecorder(inline);
        function Instant() {
          hooks.useActorRef(machine, undefined, observer());
          return null;
        }
        phase('mount');
        render(page(<Instant />), { reactStrictMode });
        await flush();
        phase('preview');
        if (previews) await lookAround(machine.id, 'idle', 'done');
        return heard;
      }

      test.each(KINDS)(
        '%s observer hears the ending again when StrictMode remounts the component, and no preview',
        async (_kind, inline) => {
          expect(await mountInstant(inline, true)).toEqual({
            mount: ['next done done', 'complete', 'next done done', 'complete'],
            preview: [],
          });
        },
      );

      test.each(KINDS)(
        '%s observer hears the ending once without StrictMode, and no preview',
        async (_kind, inline) => {
          expect(await mountInstant(inline, false)).toEqual({ mount: ['next done done', 'complete'], preview: [] });
        },
      );
    });
  });
});

describe('a waitFor on the actor of a hook whose component goes away while a preview holds back the ending', () => {
  // A form in a dialog hands its actor to the page when the user saves, and the page awaits waitFor on it.
  // The save answers during a preview, and the dialog closes before the preview ends.
  const FORM = 'form';
  const REJECTED = 'Save rejected';

  function createFormMachine() {
    return setup({
      types: { events: {} as { type: 'SUBMIT' } | { type: 'SAVED' } | { type: 'REJECTED' } },
    }).createMachine({
      id: freshId('form'),
      initial: 'editing',
      states: {
        editing: { on: { SUBMIT: 'saving' } },
        saving: {
          on: {
            SAVED: 'saved',
            REJECTED: {
              actions: () => {
                throw new Error(REJECTED);
              },
            },
          },
        },
        failed: {},
        saved: { type: 'final' },
      },
    });
  }

  type Answer = 'SAVED' | 'REJECTED';
  type UseFormActorRef = (machine: ReturnType<typeof createFormMachine>, options: { systemId: string }) => AnyActorRef;

  /** How the waitFor of the page settles, and the status that the page shows then. */
  const HEARD: Record<Answer, { outcome: string; status: string }> = {
    SAVED: { outcome: 'resolved done saved', status: 'saved' },
    REJECTED: { outcome: `rejected ${REJECTED}`, status: 'error' },
  };

  const ANSWERS: [result: string, answer: Answer][] = [
    ['succeeds', 'SAVED'],
    ['fails', 'REJECTED'],
  ];

  /**
   * Opens the page and saves the form. Then, with `previews`, the developer previews `failed`, and the server sends
   * `answer`, if there is one. The log gets `answer` before the server answers, and `close` before the dialog closes.
   * A closed dialog unmounts the form, or, with `withActivity`, an Activity hides it.
   */
  async function saveAndAnswerDuringPreview(
    useFormActorRef: UseFormActorRef,
    previews: boolean,
    withActivity: boolean,
    answer: Answer | undefined,
  ) {
    const machine = createFormMachine();
    const log: string[] = [];
    let saved: AnyActorRef | undefined;
    function Form({ onSave }: { onSave: (actorRef: AnyActorRef) => void }) {
      const actorRef = useFormActorRef(machine, { systemId: FORM });
      return (
        <button
          type="button"
          onClick={() => {
            actorRef.send({ type: 'SUBMIT' });
            onSave(actorRef);
          }}
        >
          Save
        </button>
      );
    }
    function Page({ dialog }: { dialog: 'open' | 'closed' }) {
      const [status, setStatus] = React.useState('idle');
      const track = (actorRef: AnyActorRef) => {
        saved = actorRef;
        setStatus('saving');
        waitFor(actorRef, (snapshot) => snapshot.status === 'done').then(
          (snapshot) => {
            log.push(`resolved ${entry(snapshot)}`);
            setStatus('saved');
          },
          (error: Error) => {
            log.push(`rejected ${error.message}`);
            setStatus('error');
          },
        );
      };
      const form = <Form onSave={track} />;
      return (
        <>
          <output aria-label="save">{status}</output>
          {withActivity ? (
            <React.Activity mode={dialog === 'open' ? 'visible' : 'hidden'}>{form}</React.Activity>
          ) : (
            dialog === 'open' && form
          )}
        </>
      );
    }
    const view = render(page(<Page dialog="open" />));
    await flush();
    await press('Save');

    if (previews) await preview(machine.id, ['failed']);
    if (answer) {
      log.push('answer');
      await act(async () => {
        (saved!.system.get(FORM) as AnyActorRef).send({ type: answer });
      });
    }
    return {
      log,
      close: (): void => {
        log.push('close');
        view.rerender(page(<Page dialog="closed" />));
      },
    };
  }

  describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks, previews) => {
    function closeBeforeTheRelease(withActivity: boolean): void {
      test.each(ANSWERS)('the save %s during the preview: the page hears it', async (_result, answer) => {
        const page = await saveAndAnswerDuringPreview(hooks.useActorRef, previews, withActivity, answer);
        page.close();
        await flush();
        await flush();

        // @xstate/react tells waitFor when the actor ends.
        // state-viewer tells it when the overlay drops the preview of the instance that left.
        const { outcome, status } = HEARD[answer];
        expect({ log: page.log, status: shown('save'), previewing: badge(), machines: await machines() }).toEqual({
          log: previews ? ['answer', 'close', outcome] : ['answer', outcome, 'close'],
          status,
          previewing: '',
          machines: [],
        });
      });

      test('the save still running: the page keeps waiting, as the hook stops the actor', async () => {
        const page = await saveAndAnswerDuringPreview(hooks.useActorRef, previews, withActivity, undefined);
        page.close();
        await flush();
        await flush();

        expect({ log: page.log, status: shown('save'), previewing: badge(), machines: await machines() }).toEqual({
          log: ['close'],
          status: 'saving',
          previewing: '',
          machines: [],
        });
      });
    }

    describe('the dialog unmounts before the preview is released', () => {
      closeBeforeTheRelease(false);
    });

    describeWithActivity('the dialog is hidden by an Activity before the preview is released', () => {
      closeBeforeTheRelease(true);
    });
  });

  describe('the developer releases the preview', () => {
    test.each(ANSWERS)('the save %s during the preview, released while the dialog is open', async (_result, answer) => {
      const page = await saveAndAnswerDuringPreview(useActorRef, true, false, answer);
      const answered = [...page.log];

      page.log.push('release');
      await releaseAll();
      const { outcome, status } = HEARD[answer];
      expect({ answered, log: page.log, status: shown('save') }).toEqual({
        answered: ['answer'],
        log: ['answer', 'release', outcome],
        status,
      });
    });

    /** Closes the dialog, then releases the preview before the overlay flushes. */
    async function releaseBeforeTheFlush(withActivity: boolean) {
      const page = await saveAndAnswerDuringPreview(useActorRef, true, withActivity, 'SAVED');
      // Release all is on the machine list. Going there flushes the overlay, so it comes before the close.
      await machines();
      page.close();
      // The overlay keeps the preview of the instance that left until its next flush, which comes after this click.
      page.log.push('release');
      fireEvent.click(releaseAllButton());
      await flush();
      return { log: page.log, status: shown('save'), previewing: badge() };
    }

    const RELEASED = { log: ['answer', 'close', 'release', 'resolved done saved'], status: 'saved', previewing: '' };

    test('the dialog unmounts, then the preview is released before the overlay flushes', async () => {
      expect(await releaseBeforeTheFlush(false)).toEqual(RELEASED);
    });

    describeWithActivity('in an Activity', () => {
      test('the dialog is hidden by an Activity, then the preview is released before the overlay flushes', async () => {
        expect(await releaseBeforeTheFlush(true)).toEqual(RELEASED);
      });
    });
  });
});

describe("a subscription through the hook's actor, made before an Activity hides the component", () => {
  // When @xstate/react stops the actor of a hook, the hook ends the subscriptions made through it.
  // A subscription that a preview still owes the ending stays until it hears the ending.
  // @xstate/react tells the subscription the ending once, when the actor finishes.
  // It tells it nothing after it stops the actor.
  const JOB = 'job';

  function createJobMachine() {
    return createMachine({
      id: freshId('job'),
      initial: 'running',
      states: { running: { on: { FINISHED: 'finished' } }, waiting: {}, finished: { type: 'final' } },
    });
  }

  type Job = Actor<ReturnType<typeof createJobMachine>>;
  type Subscribe = (actorRef: Job, hear: (heard: string) => void) => void;

  /** Subscribers without complete, which nothing else ends once they are told. */
  const SUBSCRIBERS: [kind: string, subscribe: Subscribe][] = [
    ['a listener function', (actorRef, hear) => actorRef.subscribe((snapshot) => hear(entry(snapshot)))],
    ['select().subscribe', (actorRef, hear) => actorRef.select(entry).subscribe(hear)],
    [
      'an observer with next and error',
      (actorRef, hear) => actorRef.subscribe({ next: (snapshot) => hear(entry(snapshot)), error: () => hear('error') }),
    ],
  ];

  describeWithActivity.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks, previews) => {
    /**
     * Mounts the component of the job in a visible Activity, and subscribes through the actor that useActorRef returns.
     * `take()` returns what the subscriber heard since the last call.
     */
    async function mount(subscribe: Subscribe, reactStrictMode: boolean) {
      const machine = createJobMachine();
      let current: Job | undefined;
      function JobPanel() {
        current = hooks.useActorRef(machine, { systemId: JOB });
        return null;
      }
      const app = (mode: 'visible' | 'hidden') =>
        page(
          <React.Activity mode={mode}>
            <JobPanel />
          </React.Activity>,
        );
      const view = render(app('visible'), { reactStrictMode });
      await flush();
      const heard: string[] = [];
      subscribe(current!, (entry) => heard.push(entry));

      const take = (): string[] => heard.splice(0);
      const previewWaiting = async () => {
        if (previews) await preview(machine.id, ['waiting']);
      };
      const releasePreview = async () => {
        if (previews) await release(machine.id);
      };
      return {
        take,
        hide: () => view.rerender(app('hidden')),
        reveal: () => view.rerender(app('visible')),
        release: releasePreview,
        finish: async () => {
          await act(async () => {
            (current!.system.get(JOB) as AnyActorRef).send({ type: 'FINISHED' });
          });
        },
        /** Previews `waiting`, and the real actor finishes under it: the preview holds back the ending. */
        finishUnderPreview: async () => {
          await previewWaiting();
          const previewed = take();
          await act(async () => {
            (current!.system.get(JOB) as AnyActorRef).send({ type: 'FINISHED' });
          });
          return { previewed, finished: take() };
        },
        /** The developer previews the actor that the revealed component restarted, then releases it. */
        previewRestarted: async () => {
          await previewWaiting();
          const previewing = { shown: entry(current!.getSnapshot()), heard: take() };
          await releasePreview();
          return { previewing, released: { shown: entry(current!.getSnapshot()), heard: take() } };
        },
      };
    }

    const UNDER_PREVIEW = {
      previewed: previews ? ['active waiting'] : [],
      finished: previews ? [] : ['done finished'],
    };
    const RESTARTED = {
      previewing: { shown: previews ? 'active waiting' : 'done finished', heard: [] },
      released: { shown: 'done finished', heard: [] },
    };

    // XState's own actors have select() from XState 5.29.
    const subscribers =
      previews || ACTOR_SELECT ? SUBSCRIBERS : SUBSCRIBERS.filter(([kind]) => !kind.startsWith('select'));

    describe.each(subscribers)('%s', (_kind, subscribe) => {
      // Without StrictMode: under it, React runs the effects of a revealed Activity twice. The second time, the hook
      // stops the actor, and that ends the subscription, which heard the ending already.
      test('the actor finished under a preview, and the overlay dropped the preview while the component was hidden: told the ending then, it follows no preview after the reveal', async () => {
        const page = await mount(subscribe, false);
        const underPreview = await page.finishUnderPreview();

        page.hide();
        await flush();
        await flush();
        const hidden = { heard: page.take(), previewing: badge() };
        page.reveal();
        await flush();
        const revealed = page.take();
        expect({ underPreview, hidden, revealed, restarted: await page.previewRestarted() }).toEqual({
          underPreview: UNDER_PREVIEW,
          hidden: { heard: previews ? ['done finished'] : [], previewing: '' },
          revealed: [],
          restarted: RESTARTED,
        });
      });

      test.each([
        ['under StrictMode', true],
        ['without StrictMode', false],
      ])(
        'the actor finished under a preview, and the component was revealed before the overlay flushed (%s): told the ending at the release, it follows no later preview',
        async (_mode, reactStrictMode) => {
          const page = await mount(subscribe, reactStrictMode);
          const underPreview = await page.finishUnderPreview();

          page.hide();
          page.reveal();
          await flush();
          // The instance registered again before the flush of the overlay, so the preview stays, and holds the ending.
          const revealed = { heard: page.take(), previewing: badge() };
          await page.release();
          const released = page.take();
          expect({ underPreview, revealed, released, restarted: await page.previewRestarted() }).toEqual({
            underPreview: UNDER_PREVIEW,
            revealed: { heard: [], previewing: previews ? '1' : '' },
            released: previews ? ['done finished'] : [],
            restarted: RESTARTED,
          });
        },
      );

      test('the actor finished before any preview: told the ending at once, it follows no preview after the reveal', async () => {
        const page = await mount(subscribe, false);
        await page.finish();
        const finished = page.take();

        page.hide();
        await flush();
        await flush();
        page.reveal();
        await flush();
        expect({ finished, revealed: page.take(), restarted: await page.previewRestarted() }).toEqual({
          finished: ['done finished'],
          revealed: [],
          restarted: RESTARTED,
        });
      });
    });
  });
});

describe('an observer callback that throws', () => {
  // XState reports what an observer throws from a timer, and continues. The actor that state-viewer returns does too.
  const JOB = 'job';
  const JOB_FAILED = 'Job failed';

  function createJobMachine() {
    return createMachine({
      id: freshId('job'),
      initial: 'running',
      states: {
        running: {
          on: {
            FINISH: 'finished',
            FAIL: {
              actions: () => {
                throw new Error(JOB_FAILED);
              },
            },
          },
        },
        waiting: {},
        finished: { type: 'final' },
      },
    });
  }

  type JobMachine = ReturnType<typeof createJobMachine>;

  /** Records each call. With `'next'`, next throws on the done snapshot. With `'ending'`, complete and error throw. */
  function throwingObserver(heard: string[], throwing: 'next' | 'ending'): Observer<Recorded> {
    return {
      next: (snapshot) => {
        heard.push(`next ${entry(snapshot)}`);
        if (throwing === 'next' && snapshot.status === 'done') throw new TypeError('next failed');
      },
      complete: () => {
        heard.push('complete');
        if (throwing === 'ending') throw new Error('complete failed');
      },
      error: (cause) => {
        heard.push(`error ${(cause as Error).message}`);
        if (throwing === 'ending') throw new Error('error failed');
      },
    };
  }

  describe.each([
    ['with no preview on', false],
    ['while a preview hides the ending', true],
  ])('the actor that connect() returned finishes %s', (_, previews) => {
    /**
     * Starts the job outside React, connects it, and lets `observe` subscribe to the returned actor. With `previews`,
     * the developer previews `waiting`. Then the real actor finishes, and `read()` reads what the subscriber has then.
     * The overlay drops the preview of the actor that left at its next flush, and that ends the preview.
     */
    async function finishJob<T>(observe: (actor: Actor<JobMachine>) => () => T) {
      const machine = createJobMachine();
      const actor = createActor(machine).start();
      onTestFinished(() => {
        actor.stop();
      });
      const read = observe(connect(actor));
      render(page(null));
      await flush();
      if (previews) await preview(machine.id, ['waiting']);
      let held: T | undefined;
      const reported = await uncaught(() => {
        actor.send({ type: 'FINISH' });
        held = read();
      });
      return { held, reported: messages(reported) };
    }

    test('an observer whose next throws on the done snapshot still hears complete', async () => {
      const heard: string[] = [];
      const { held, reported } = await finishJob((actor) => {
        actor.subscribe(throwingObserver(heard, 'next'));
        return () => [...heard];
      });
      const preview = previews ? ['next active waiting'] : [];
      expect({ held, heard, reported }).toEqual({
        // The preview holds back the ending until the overlay drops it.
        held: previews ? preview : ['next done finished', 'complete'],
        heard: [...preview, 'next done finished', 'complete'],
        reported: ['next failed'],
      });
    });

    test('a waitFor whose predicate throws on the final snapshot still rejects', async () => {
      const checked: string[] = [];
      let settled = 'pending';
      const { held, reported } = await finishJob((actor) => {
        waitFor(actor, (snapshot) => {
          checked.push(entry(snapshot));
          if (snapshot.status === 'done') throw new TypeError('predicate failed');
          return false;
        }).then(
          (snapshot) => (settled = `resolved ${entry(snapshot)}`),
          (error: Error) => (settled = `rejected ${error.message}`),
        );
        return () => ({ checked: [...checked], settled });
      });
      // waitFor checks the snapshot that it starts with.
      const preview = previews ? ['active waiting'] : [];
      expect({ held, checked, settled, reported }).toEqual({
        held: { checked: ['active running', previews ? 'active waiting' : 'done finished'], settled: 'pending' },
        checked: ['active running', ...preview, 'done finished'],
        settled: 'rejected Actor terminated without satisfying predicate',
        reported: ['predicate failed'],
      });
    });
  });

  describe("a subscriber of the hook's actor whose complete or error throws", () => {
    describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks, previews) => {
      /** Mounts the job. useActorRef keeps its actor listed after the actor ends, so the developer can preview it. */
      async function mountJob() {
        const machine = createJobMachine();
        let actorRef: Actor<JobMachine> | undefined;
        function Job() {
          actorRef = hooks.useActorRef(machine, { systemId: JOB });
          return null;
        }
        render(page(<Job />));
        await flush();
        const heard: string[] = [];
        actorRef!.subscribe(throwingObserver(heard, 'ending'));
        return {
          heard,
          end: (type: 'FINISH' | 'FAIL') => (actorRef!.system.get(JOB) as AnyActorRef).send({ type }),
          shown: () => String(actorRef!.getSnapshot().value),
          previewWaiting: async () => {
            if (previews) await preview(machine.id, ['waiting']);
          },
          release: async () => {
            if (previews) await release(machine.id);
          },
        };
      }

      const ENDINGS: [callback: string, type: 'FINISH' | 'FAIL', told: string[], thrown: string, value: string][] = [
        ['complete', 'FINISH', ['next done finished', 'complete'], 'complete failed', 'finished'],
        ['error', 'FAIL', [`error ${JOB_FAILED}`], 'error failed', 'running'],
      ];

      test.each(ENDINGS)(
        'whose %s throws as the actor ends hears no preview of the ended actor afterwards',
        async (_callback, type, told, thrown, value) => {
          const job = await mountJob();
          const reported = await uncaught(() => job.end(type));
          const ended = job.heard.splice(0);

          await job.previewWaiting();
          expect({ reported: messages(reported), ended, previewing: { shown: job.shown(), heard: job.heard } }).toEqual(
            {
              reported: [thrown],
              ended: told,
              // The actor shows the preview, and the subscriber hears none of it.
              previewing: { shown: previews ? 'waiting' : value, heard: [] },
            },
          );
        },
      );

      test.each(ENDINGS)(
        'whose %s throws as the preview that held the ending back is released hears no preview afterwards',
        async (_callback, type, told, thrown, value) => {
          const job = await mountJob();
          await job.previewWaiting();
          const previewed = job.heard.splice(0);
          let ended: string[] = [];
          const reported = await uncaught(async () => {
            job.end(type);
            ended = job.heard.splice(0);
            await job.release();
          });
          const released = job.heard.splice(0);

          await job.previewWaiting();
          expect({
            reported: messages(reported),
            previewed,
            ended,
            released,
            previewing: { shown: job.shown(), heard: job.heard },
          }).toEqual({
            reported: [thrown],
            previewed: previews ? ['next active waiting'] : [],
            ended: previews ? [] : told,
            released: previews ? told : [],
            previewing: { shown: previews ? 'waiting' : value, heard: [] },
          });
        },
      );
    });
  });
});

describe('an actor that fails while a preview hides the failure', () => {
  const CRASH = 'Upload crashed';

  /**
   * An upload that fails when its socket pushes BREAK. The push goes to the real actor, so a preview, which blocks
   * only what the app sends, doesn't block it. `retrying` and `done` are there to be previewed.
   */
  function createCrashingUpload() {
    const socket: { push?: () => void } = {};
    const machine = setup({
      actors: {
        socket: fromCallback(({ sendBack }) => {
          socket.push = () => sendBack({ type: 'BREAK' });
          return () => {
            socket.push = undefined;
          };
        }),
      },
    }).createMachine({
      id: freshId('crashing-upload'),
      initial: 'uploading',
      invoke: { src: 'socket' },
      states: {
        uploading: {
          on: {
            BREAK: {
              actions: () => {
                throw new Error(CRASH);
              },
            },
          },
        },
        retrying: {},
        done: {},
      },
    });
    return { machine, crash: () => socket.push?.() };
  }

  type CrashingMachine = ReturnType<typeof createCrashingUpload>['machine'];
  type AppProps = { showStatus: boolean };

  const SELECTOR_APPS = [
    'useSelector on the actor that useActorRef returns',
    "createActorContext's useSelector",
  ] as const;

  function Status({ value }: { value: string }) {
    return <output aria-label="upload">{value}</output>;
  }

  /** The apps that read the upload with useSelector. Each makes the actor, and mounts the reader with `showStatus`. */
  function createSelectorApps(
    machine: CrashingMachine,
  ): Record<(typeof SELECTOR_APPS)[number], (props: AppProps) => React.ReactNode> {
    const UploadContext = createActorContext(machine);
    function ContextStatus() {
      return <Status value={UploadContext.useSelector((snapshot) => String(snapshot.value))} />;
    }
    function RefStatus({ actorRef }: { actorRef: Actor<CrashingMachine> }) {
      return <Status value={useSelector(actorRef, (snapshot) => String(snapshot.value))} />;
    }
    return {
      'useSelector on the actor that useActorRef returns': function RefApp({ showStatus }: AppProps) {
        const actorRef = useActorRef(machine);
        return showStatus ? <RefStatus actorRef={actorRef} /> : null;
      },
      "createActorContext's useSelector": function ContextApp({ showStatus }: AppProps) {
        return <UploadContext.Provider>{showStatus ? <ContextStatus /> : null}</UploadContext.Provider>;
      },
    };
  }

  /** What the app shows: the status, or the error that its boundary caught. */
  function shownUpload(): string | null {
    return screen.queryByRole('status', { name: 'upload' })?.textContent ?? alerts()[0] ?? null;
  }

  /**
   * Renders `app` in an error boundary, previews `retrying` on the upload, and lets the real actor fail under the
   * preview. Returns the errors that reached the page uncaught, and a rerender that keeps the boundary.
   */
  async function failDuringPreview(machine: AnyStateMachine, crash: () => void, app: React.ReactNode) {
    const view = render(page(<Boundary>{app}</Boundary>));
    await flush();
    await preview(machine.id, ['retrying']);
    const errors = await uncaught(crash);
    return {
      uncaught: messages(errors),
      rerender: async (next: React.ReactNode) => {
        view.rerender(page(<Boundary>{next}</Boundary>));
        await flush();
      },
    };
  }

  test('useMachine follows later previews of the failed actor, and the release throws the failure to the boundary', async () => {
    const { machine, crash } = createCrashingUpload();
    function MachineApp() {
      const [snapshot] = useMachine(machine);
      return <Status value={String(snapshot.value)} />;
    }
    const failed = await failDuringPreview(machine, crash, <MachineApp />);
    const steps = [shownUpload()];
    await clickLeaf('done');
    steps.push(shownUpload());
    await release(machine.id);
    steps.push(shownUpload());
    expect({ uncaught: failed.uncaught, steps }).toEqual({ uncaught: [], steps: ['retrying', 'done', CRASH] });
  });

  describe.each(SELECTOR_APPS)('%s', (name) => {
    test('follows later previews of the failed actor', async () => {
      const { machine, crash } = createCrashingUpload();
      const App = createSelectorApps(machine)[name];
      const failed = await failDuringPreview(machine, crash, <App showStatus />);
      const steps = [shownUpload()];
      await clickLeaf('done');
      steps.push(shownUpload());
      await clickLeaf('uploading');
      steps.push(shownUpload());
      expect({ uncaught: failed.uncaught, steps }).toEqual({ uncaught: [], steps: ['retrying', 'done', 'uploading'] });
    });

    test('once the preview is released, re-renders and throws the real error to the boundary', async () => {
      const { machine, crash } = createCrashingUpload();
      const App = createSelectorApps(machine)[name];
      const failed = await failDuringPreview(machine, crash, <App showStatus />);
      const previewing = shownUpload();
      await release(machine.id);
      expect({ uncaught: failed.uncaught, previewing, released: alerts(), previews: badge() }).toEqual({
        uncaught: [],
        previewing: 'retrying',
        released: [CRASH],
        previews: '',
      });
    });

    test('a consumer that mounts while the failed actor is previewed follows previews, then throws on release', async () => {
      const { machine, crash } = createCrashingUpload();
      const App = createSelectorApps(machine)[name];
      const failed = await failDuringPreview(machine, crash, <App showStatus={false} />);
      // A tab opens, for example, while the developer keeps the preview.
      await failed.rerender(<App showStatus />);
      const steps = [shownUpload()];
      await clickLeaf('done');
      steps.push(shownUpload());
      await release(machine.id);
      steps.push(shownUpload());
      expect({ uncaught: failed.uncaught, steps }).toEqual({
        // When the actor failed, no subscriber handled errors, so XState reported it, as without a preview.
        uncaught: [CRASH],
        steps: ['retrying', 'done', CRASH],
      });
    });
  });

  test.each([
    ['with no preview on', false],
    ['while a preview hides the failure', true],
  ])(
    'an app observer with next and error on the actor that connect() returns gets the error last %s, and the failed actor leaves the overlay',
    async (_, previews) => {
      const { machine, crash } = createCrashingUpload();
      const actor = createActor(machine).start();
      onTestFinished(() => {
        actor.stop();
      });
      const upload = connect(actor);
      const heard: string[] = [];
      upload.subscribe({
        next: (snapshot) => heard.push(`next ${String(snapshot.value)}`),
        error: (error) => heard.push(`error ${(error as Error).message}`),
      });
      render(page(null));
      await flush();

      if (previews) await preview(machine.id, ['retrying']);
      const previewed = heard.splice(0);
      let held: string[] = [];
      const errors = await uncaught(() => {
        crash();
        held = [...heard];
      });
      const listed = await machines();
      expect({ previewed, held, uncaught: messages(errors), heard, machines: listed, previewing: badge() }).toEqual({
        previewed: previews ? ['next retrying'] : [],
        // The preview holds back the error until the overlay drops the preview of the actor that left.
        held: previews ? [] : [`error ${CRASH}`],
        uncaught: [],
        heard: [`error ${CRASH}`],
        machines: [],
        previewing: '',
      });
    },
  );
});

describe('an error that useSelector throws to an error boundary', () => {
  describe.each(IMPLEMENTATIONS)('like @xstate/react, with %s', (_, hooks) => {
    test('useActorRef and useSelector: an action error caught by an error boundary is not also reported as unhandled', async () => {
      const machine = createUploadMachine();
      function Upload() {
        const actorRef = hooks.useActorRef(machine);
        const value = hooks.useSelector(actorRef, (snapshot) => String(snapshot.value));
        return (
          <button type="button" onClick={() => actorRef.send({ type: 'BREAK' })}>
            {value}
          </button>
        );
      }
      render(
        <Boundary>
          <Upload />
        </Boundary>,
      );
      await flush();

      const errors = await uncaught(() => fireEvent.click(screen.getByRole('button', { name: 'uploading' })));
      expect({ alerts: alerts(), uncaught: messages(errors) }).toEqual({ alerts: [BROKEN], uncaught: [] });
    });
  });
});
