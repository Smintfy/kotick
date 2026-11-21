import { act, render, screen } from '@testing-library/react';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Shiru } from 'shiru';
import { describe, expect, onTestFinished, test } from 'vitest';
import { mount, page, press } from '../support/app';
import { watchConsole } from '../support/console';
import {
  answer,
  createBank,
  createOrderMachine,
  Order,
  shownOrder,
  type OrderEvent,
} from '../support/order';
import { flush, instances, machines, marks, panel, preview, show, shownKey } from '../support/panel';
import { describeWithActivity } from '../support/react';

declare global {
  /** While it is true, React warns about each update outside act(). Testing Library sets it to true. */
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

test('two instances of one machine have their own labels and previews, and an unmount ends the preview of its instance', async () => {
  const bank = createBank();
  const machine = createOrderMachine(bank);

  function Orders({ first = true }: { first?: boolean }) {
    return page(
      <>
        {first && <Order machine={machine} name="first" label="First" />}
        <Order machine={machine} name="second" label="Second" />
      </>,
    );
  }

  const view = render(<Orders />);
  await flush();
  await press('second: submit');
  // The instances share the recordings of the machine, so the first one previews what the second one visited.
  await preview(machine.id, ['loading']);
  const both = { instances: instances(), first: shownOrder('first'), second: shownOrder('second') };
  await press('first: submit');
  await answer(bank, 'resolve');
  const moved = { first: shownOrder('first'), second: shownOrder('second') };
  view.rerender(<Orders first={false} />);
  await flush();
  await show(machine.id);

  expect({ both, moved, unmounted: { instances: instances(), previewed: panel().previewed } }).toEqual({
    both: {
      instances: ['First · 1 ●', 'Second · 2'],
      first: { status: 'loading', orderId: 'o1' },
      second: { status: 'loading', orderId: 'o1' },
    },
    moved: { first: { status: 'loading', orderId: 'o1' }, second: { status: 'success', receipt: 'receipt of o1' } },
    unmounted: { instances: ['Second · 1'], previewed: [] },
  });
});

describe('an edit to the machine, as Fast Refresh makes it', () => {
  test('the preview stays when the edit keeps the previewed state, and ends with no warning when the edit removes it', async () => {
    const output = watchConsole();
    const bank = createBank();
    const machine = createOrderMachine(bank);
    const view = render(page(<Order machine={machine} />));
    await flush();
    await press('order: submit');
    await preview(machine.id, ['idle']);
    view.rerender(page(<Order machine={createOrderMachine(bank, machine.id)} />));
    await flush();
    const kept = { shown: shownOrder(), previewed: panel().previewed, effects: [...bank.log] };
    view.rerender(page(<Order machine={createOrderMachine(bank, machine.id, 'idle')} />));
    await flush();

    expect({
      kept,
      removed: { shown: shownOrder(), previewed: panel().previewed, states: Object.keys(marks()) },
      output,
    }).toEqual({
      // The new machine object restarts the effect of the real state.
      kept: { shown: { status: 'idle' }, previewed: ['idle'], effects: ['start o1', 'cleanup o1', 'start o1'] },
      removed: { shown: { status: 'loading', orderId: 'o1' }, previewed: [], states: ['loading', 'success', 'error'] },
      output: { warn: [], error: [] },
    });
  });

  test('a real state that the edit removed gets one warning, and the machine ignores every event in it', async () => {
    const output = watchConsole();
    const bank = createBank();
    const machine = createOrderMachine(bank);
    const view = render(page(<Order machine={machine} />));
    await flush();
    await press('order: submit');
    await answer(bank, 'reject');
    const before = shownOrder();
    view.rerender(page(<Order machine={createOrderMachine(bank, machine.id, 'error')} />));
    await flush();
    await press('order: retry');
    await show(machine.id);

    expect({ before, after: shownOrder(), states: Object.keys(marks()), output }).toEqual({
      before: { status: 'error', orderId: 'o1', message: 'declined' },
      after: { status: 'error', orderId: 'o1', message: 'declined' },
      states: ['idle', 'loading', 'success'],
      output: { warn: [`[shiru] "${machine.id}" is in "error", which its definition doesn't declare.`], error: [] },
    });
  });
});

describe('debug.disabled', () => {
  test('the instance stays out of the panel, and its events reach the machine', async () => {
    const machine = createOrderMachine(createBank());
    await mount(<Order machine={machine} disabled />);
    const listed = await machines();
    await press('order: submit');

    expect({ listed: listed.includes(machine.id), shown: shownOrder() }).toEqual({
      listed: false,
      shown: { status: 'loading', orderId: 'o1' },
    });
  });

  test('an event from the layout effect of a child, in the commit that turns the instance off during a preview, reaches the machine', async () => {
    const machine = createOrderMachine(createBank());
    let turnedOff = false;

    const rejectOnce = (dispatch: (event: OrderEvent) => void): void => {
      if (!turnedOff) return;
      turnedOff = false;
      dispatch({ type: 'REJECT', message: 'sent in the layout effect' });
    };

    const view = render(page(<Order machine={machine} onCommit={rejectOnce} />));
    await flush();
    await press('order: submit');
    await preview(machine.id, ['idle']);
    const previewed = shownOrder();
    turnedOff = true;
    view.rerender(page(<Order machine={machine} onCommit={rejectOnce} disabled />));
    await flush();

    expect({ previewed, shown: shownOrder() }).toEqual({
      previewed: { status: 'idle' },
      shown: { status: 'error', orderId: 'o1', message: 'sent in the layout effect' },
    });
  });
});

test('content that Suspense hides stays listed and previewed, and shows its preview when it comes back', async () => {
  const machine = createOrderMachine(createBank());

  function Page({ dialog: Dialog }: { dialog?: React.ComponentType }) {
    return page(
      <React.Suspense fallback={<p>Loading the dialog</p>}>
        <Order machine={machine} />
        {Dialog ? <Dialog /> : null}
      </React.Suspense>,
    );
  }

  const view = render(<Page />);
  await flush();
  await press('order: submit');
  await preview(machine.id, ['idle']);
  let load = () => {};

  const code = new Promise<{ default: React.ComponentType }>((resolve) => {
    load = () => resolve({ default: () => <p>Dialog</p> });
  });

  const Dialog = React.lazy(() => code);
  await act(async () => {
    view.rerender(<Page dialog={Dialog} />);
  });
  await flush();

  const hidden = {
    fallback: screen.queryByText('Loading the dialog')?.textContent,
    instances: instances(),
    previewed: panel().previewed,
  };

  await act(async () => {
    load();
    await code;
  });
  await flush();

  expect({ hidden, revealed: { dialog: screen.queryByText('Dialog')?.textContent, shown: shownOrder() } }).toEqual({
    hidden: { fallback: 'Loading the dialog', instances: [`${machine.id} · 1`], previewed: ['idle'] },
    revealed: { dialog: 'Dialog', shown: { status: 'idle' } },
  });
});

describeWithActivity('an Activity that hides the component', () => {
  test('the hide ends the preview, and the first paint that shows the component again has the real state', async () => {
    const machine = createOrderMachine(createBank());
    // The same element on each render, as children from a parent are, so React shows it again without a new render.
    const order = <Order machine={machine} />;
    const container = document.body.appendChild(document.createElement('div'));
    const root = createRoot(container);
    onTestFinished(() => {
      act(() => root.unmount());
      container.remove();
    });
    let onPaint: ((text: string | null) => void) | undefined;

    // React runs this layout effect after those of the components before it.
    function EndOfCommit({ mode }: { mode: string }) {
      React.useLayoutEffect(() => {
        const resolve = onPaint;

        // A microtask runs after the synchronous renders that the commit starts, and before the browser paints.
        if (resolve) queueMicrotask(() => resolve(screen.getByRole('status', { name: 'order' }).textContent));
      }, [mode]);

      return null;
    }

    const app = (mode: 'visible' | 'hidden') => (
      <React.StrictMode>
        <React.Activity mode={mode}>{order}</React.Activity>
        <EndOfCommit mode={mode} />
        <Shiru defaultOpen />
      </React.StrictMode>
    );

    await act(async () => root.render(app('visible')));
    await flush();
    await press('order: submit');
    await preview(machine.id, ['idle']);
    const key = shownKey();
    const previewing = shownOrder();
    await act(async () => root.render(app('hidden')));
    await flush();
    const listedWhileHidden = (await machines()).some((row) => row.startsWith(machine.id));
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    let painted: string | null;

    try {
      // Outside act, as in an app, so React runs the passive effects after the paint.
      painted = await new Promise((resolve) => {
        onPaint = resolve;
        root.render(app('visible'));
      });
    } finally {
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    }

    await flush();
    await show(machine.id);

    expect({
      previewing,
      listedWhileHidden,
      firstPaint: JSON.parse(painted ?? 'null'),
      revealed: { sameKey: shownKey() === key, previewed: panel().previewed },
    }).toEqual({
      previewing: { status: 'idle' },
      listedWhileHidden: false,
      firstPaint: { status: 'loading', orderId: 'o1' },
      revealed: { sameKey: true, previewed: [] },
    });
  });
});
