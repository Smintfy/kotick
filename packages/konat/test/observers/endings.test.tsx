import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { connect, useActorRef, useMachine, useSelector } from 'konat/xstate';
import { describe, expect, onTestFinished, test } from 'vitest';
import { createActor, setup, waitFor, type AnyActorRef, type Observer } from 'xstate';
import { page, press, systemActor } from '../support/app';
import { alerts, Boundary } from '../support/boundary';
import { errorMessage, uncaught } from '../support/console';
import { badge, clickLeaf, flush, freshId, machines, preview, release } from '../support/panel';

const BROKEN = 'Upload broken';

const UPLOAD_SYSTEM_ID = 'upload';

type UploadEvent = { type: 'UPLOADED' } | { type: 'BREAK' };

function createUploadMachine() {
  // SAFETY: XState reads the types of setup() only at compile time. It never reads this value.
  return setup({ types: { events: {} as UploadEvent } }).createMachine({
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

function entry(snapshot: Recorded): string {
  return `${snapshot.status} ${String(snapshot.value)}`;
}

/** An observer object that records each call in `heard`. Without `error`, XState reports a failure as unhandled. */
function observerInto(heard: string[], { error = true } = {}): Observer<Recorded> {
  const observer: Observer<Recorded> = {
    next: (snapshot) => heard.push(`next ${entry(snapshot)}`),
    complete: () => heard.push('complete'),
  };

  if (error) observer.error = (cause) => heard.push(`error ${errorMessage(cause)}`);

  return observer;
}

/** What the server sends to the upload, as a socket would. */
function Server({ actorRef }: { actorRef: AnyActorRef }) {
  const sendToReal = (type: 'UPLOADED' | 'BREAK') => systemActor(actorRef, UPLOAD_SYSTEM_ID).send({ type });

  return (
    <>
      <button type="button" onClick={() => sendToReal('UPLOADED')}>
        Finish upload
      </button>
      <button type="button" onClick={() => sendToReal('BREAK')}>
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

function messages(errors: unknown[]): string[] {
  return errors.map(errorMessage);
}

test('the observer given to useActorRef gets the done snapshot, then complete, once the preview that hid it is released, and nothing on later previews', async () => {
  const machine = createUploadMachine();
  const heard: string[] = [];
  const observer = observerInto(heard);

  function Upload() {
    return <Server actorRef={useActorRef(machine, { systemId: UPLOAD_SYSTEM_ID }, observer)} />;
  }

  render(page(<Upload />));
  await flush();

  const started = heard.splice(0);
  await preview(machine.id, ['failed']);
  const previewed = heard.splice(0);
  await press('Finish upload');
  const finished = heard.splice(0);
  await release(machine.id);
  const released = heard.splice(0);
  await lookAround(machine.id, 'failed', 'uploading');
  expect({ started, previewed, finished, released, later: heard }).toEqual({
    // StrictMode starts the actor twice.
    started: ['next active uploading', 'next active uploading'],
    previewed: ['next active failed'],
    finished: [],
    released: ['next done uploaded', 'complete'],
    later: [],
  });
});

// Apps usually pass an inline observer, a new one on each render, which @xstate/react subscribes again each time.
test('an inline observer follows the next preview, and hears the done snapshot once, at the release, though the component renders again before it', async () => {
  const machine = createUploadMachine();
  const heard: string[] = [];

  function Upload({ hint }: { hint: string }) {
    const actorRef = useActorRef(machine, { systemId: UPLOAD_SYSTEM_ID }, observerInto(heard));
    const value = useSelector(actorRef, (snapshot) => String(snapshot.value));

    return (
      <>
        <p>{hint}</p>
        <output aria-label="upload">{value}</output>
        <Server actorRef={actorRef} />
      </>
    );
  }

  const view = render(page(<Upload hint="Uploading" />));
  await flush();
  heard.length = 0;

  await preview(machine.id, ['failed']);
  await press('Finish upload');
  // A change in the parent renders the component again with a new prop.
  view.rerender(page(<Upload hint="Still uploading" />));
  await flush();
  // The developer clicks another state, and useSelector renders the component again.
  await clickLeaf('uploading');
  const previewing = { shown: shown(), heard: heard.splice(0) };
  await release(machine.id);
  expect({ previewing, released: { shown: shown(), heard } }).toEqual({
    previewing: { shown: 'uploading', heard: ['next active failed', 'next active uploading'] },
    // useSelector renders the component again on the release. @xstate/react subscribes the observer of that render to
    // the ended actor, and XState completes it at once.
    released: { shown: 'uploaded', heard: ['next done uploaded', 'complete', 'complete'] },
  });
});

test.each([
  ['with an error callback, the observer gets the error, and the error is not reported as unhandled', true],
  ['without an error callback, the observer gets nothing for the failure, and XState reports the error as unhandled', false],
])('the actor fails %s, and nothing when the failed actor is previewed', async (_, error) => {
  const machine = createUploadMachine();
  const heard: string[] = [];
  const observer = observerInto(heard, { error });

  function Upload() {
    return <Server actorRef={useActorRef(machine, { systemId: UPLOAD_SYSTEM_ID }, observer)} />;
  }

  render(page(<Upload />));
  await flush();
  heard.length = 0;

  const errors = await uncaught(() => fireEvent.click(screen.getByRole('button', { name: 'Break upload' })));
  const failed = heard.splice(0);
  await lookAround(machine.id, 'failed', 'uploading');
  expect({ uncaught: messages(errors), failed, later: heard }).toEqual({
    uncaught: error ? [] : [BROKEN],
    failed: error ? [`error ${BROKEN}`] : [],
    later: [],
  });
});

test('an observer passed only after the upload finished hears complete at once, and nothing of the previews', async () => {
  // The component passes its observer only while its panel is open: `panelOpen ? onChange : undefined`.
  // @xstate/react subscribes it to an actor that XState stopped, and XState calls only its complete.
  const machine = createUploadMachine();
  const heard: string[] = [];
  const observer = observerInto(heard);

  function Upload({ panelOpen }: { panelOpen: boolean }) {
    return <Server actorRef={useActorRef(machine, { systemId: UPLOAD_SYSTEM_ID }, panelOpen ? observer : undefined)} />;
  }

  const view = render(page(<Upload panelOpen={false} />));
  await flush();
  await press('Finish upload');

  heard.push('[preview failed]');
  await preview(machine.id, ['failed']);
  heard.push('[panel opens]');
  view.rerender(page(<Upload panelOpen />));
  await flush();
  heard.push('[click paused]');
  await clickLeaf('paused');
  heard.push('[release]');
  await release(machine.id);
  expect(heard).toEqual(['[preview failed]', '[panel opens]', 'complete', '[click paused]', '[release]']);
});

describe('a waitFor on the actor of a hook whose component unmounts while a preview holds back the ending', () => {
  /**
   * A dialog runs the upload, and the page awaits waitFor on its actor. The developer previews `failed`, the server
   * sends `answer` to the real actor, if there is one, and the dialog closes before the preview ends. The log gets
   * `answer` before the server answers, and `close` before the dialog closes.
   */
  async function closeDuringPreview(answer?: UploadEvent['type']) {
    const machine = createUploadMachine();
    const log: string[] = [];
    let actorRef: AnyActorRef | undefined;

    function Dialog() {
      actorRef = useActorRef(machine, { systemId: UPLOAD_SYSTEM_ID });

      return null;
    }

    const view = render(page(<Dialog />));
    await flush();
    waitFor(actorRef!, (snapshot) => snapshot.status === 'done').then(
      (snapshot) => log.push(`resolved ${entry(snapshot)}`),
      (error: Error) => log.push(`rejected ${error.message}`),
    );
    await preview(machine.id, ['failed']);

    if (answer) {
      log.push('answer');
      await act(async () => {
        systemActor(actorRef!, UPLOAD_SYSTEM_ID).send({ type: answer });
      });
    }

    log.push('close');
    view.rerender(page(null));
    await flush();
    await flush();

    return { log, previewing: badge(), machines: await machines() };
  }

  // konat tells waitFor when the overlay drops the preview of the instance that left.
  test.each([
    ['finishes', 'UPLOADED', 'resolved done uploaded'],
    ['fails', 'BREAK', `rejected ${BROKEN}`],
  ] as const)('the upload %s during the preview: the waitFor settles once the dialog closes', async (_, answer, settled) => {
    expect(await closeDuringPreview(answer)).toEqual({ log: ['answer', 'close', settled], previewing: '', machines: [] });
  });

  test('the upload still running: the waitFor stays pending, as the hook stops the actor', async () => {
    expect(await closeDuringPreview()).toEqual({ log: ['close'], previewing: '', machines: [] });
  });
});

// XState reports what an observer throws from a timer, and continues. The actor that konat returns does too.
test('a subscriber of the connected actor whose next throws on the done snapshot that a preview held back still hears complete', async () => {
  const machine = createUploadMachine();
  const actor = createActor(machine).start();
  onTestFinished(() => {
    actor.stop();
  });
  const heard: string[] = [];
  connect(actor).subscribe({
    next: (snapshot) => {
      heard.push(`next ${entry(snapshot)}`);

      if (snapshot.status === 'done') throw new TypeError('next failed');
    },
    complete: () => heard.push('complete'),
  });
  render(page(null));
  await flush();
  await preview(machine.id, ['failed']);

  let held: string[] = [];

  // The overlay drops the preview of the actor that left at its next flush, and that ends the preview.
  const reported = await uncaught(() => {
    actor.send({ type: 'UPLOADED' });
    held = [...heard];
  });

  expect({ held, heard, reported: messages(reported) }).toEqual({
    held: ['next active failed'],
    heard: ['next active failed', 'next done uploaded', 'complete'],
    reported: ['next failed'],
  });
});

describe('an actor that fails while a preview hides the failure', () => {
  /** What the app shows: the status, or the error that its boundary caught. */
  function shownUpload(): string | null {
    return screen.queryByRole('status', { name: 'upload' })?.textContent ?? alerts()[0] ?? null;
  }

  /**
   * Renders `app` in an error boundary, previews `failed` on the upload, and lets the server break the real actor under
   * the preview. Returns the errors that reached the page uncaught, and a rerender that keeps the boundary.
   */
  async function breakDuringPreview(machineId: string, app: React.ReactNode) {
    const view = render(page(<Boundary>{app}</Boundary>));
    await flush();
    await preview(machineId, ['failed']);
    const errors = await uncaught(() => fireEvent.click(screen.getByRole('button', { name: 'Break upload' })));

    return {
      uncaught: messages(errors),
      rerender: async (next: React.ReactNode) => {
        view.rerender(page(<Boundary>{next}</Boundary>));
        await flush();
      },
    };
  }

  test('useMachine follows later previews of the failed actor, and the release throws the failure to the boundary', async () => {
    const machine = createUploadMachine();

    function MachineApp() {
      const [snapshot, , actorRef] = useMachine(machine, { systemId: UPLOAD_SYSTEM_ID });

      return (
        <>
          <output aria-label="upload">{String(snapshot.value)}</output>
          <Server actorRef={actorRef} />
        </>
      );
    }

    const broken = await breakDuringPreview(machine.id, <MachineApp />);
    const steps = [shownUpload()];
    await clickLeaf('paused');
    steps.push(shownUpload());
    await release(machine.id);
    steps.push(shownUpload());
    expect({ uncaught: broken.uncaught, steps }).toEqual({ uncaught: [], steps: ['failed', 'paused', BROKEN] });
  });

  test('a useSelector consumer that mounts while the failed actor is previewed follows previews, then throws on release', async () => {
    const machine = createUploadMachine();

    function Reader({ actorRef }: { actorRef: AnyActorRef }) {
      return <output aria-label="upload">{useSelector(actorRef, (snapshot) => String(snapshot.value))}</output>;
    }

    function SelectorApp({ showStatus }: { showStatus: boolean }) {
      const actorRef = useActorRef(machine, { systemId: UPLOAD_SYSTEM_ID });

      return (
        <>
          {showStatus && <Reader actorRef={actorRef} />}
          <Server actorRef={actorRef} />
        </>
      );
    }

    const broken = await breakDuringPreview(machine.id, <SelectorApp showStatus={false} />);
    // A tab opens, for example, while the developer keeps the preview.
    await broken.rerender(<SelectorApp showStatus />);
    const steps = [shownUpload()];
    await clickLeaf('paused');
    steps.push(shownUpload());
    await release(machine.id);
    steps.push(shownUpload());
    expect({ uncaught: broken.uncaught, steps }).toEqual({
      // When the actor failed, no subscriber handled errors, so XState reported it, as without a preview.
      uncaught: [BROKEN],
      steps: ['failed', 'paused', BROKEN],
    });
  });

  test('an app observer with next and error on the actor that connect() returns gets the error once the overlay drops the failed actor', async () => {
    const machine = createUploadMachine();
    const actor = createActor(machine).start();
    onTestFinished(() => {
      actor.stop();
    });
    const heard: string[] = [];
    connect(actor).subscribe({
      next: (snapshot) => heard.push(`next ${String(snapshot.value)}`),
      error: (error) => heard.push(`error ${errorMessage(error)}`),
    });
    render(page(null));
    await flush();

    await preview(machine.id, ['failed']);
    const previewed = heard.splice(0);
    let held: string[] = [];

    const errors = await uncaught(() => {
      actor.send({ type: 'BREAK' });
      held = [...heard];
    });

    const listed = await machines();
    expect({ previewed, held, uncaught: messages(errors), heard, machines: listed, previewing: badge() }).toEqual({
      previewed: ['next failed'],
      // The preview holds back the error until the overlay drops the preview of the actor that left.
      held: [],
      uncaught: [],
      heard: [`error ${BROKEN}`],
      machines: [],
      previewing: '',
    });
  });
});

test('an action error that useSelector throws to an error boundary is not also reported as unhandled', async () => {
  const machine = createUploadMachine();

  function Upload() {
    const actorRef = useActorRef(machine);
    const value = useSelector(actorRef, (snapshot) => String(snapshot.value));

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
