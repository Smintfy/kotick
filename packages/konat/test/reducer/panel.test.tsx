import { fireEvent, render, screen } from '@testing-library/react';
import { useMachine } from 'konat/xstate';
import { describe, expect, test } from 'vitest';
import { createMachine } from 'xstate';
import { mount, page, press } from '../support/app';
import { watchConsole } from '../support/console';
import { answer, createBank, createOrderMachine, Order, shownOrder } from '../support/order';
import {
  badge,
  clickLeaf,
  copy,
  flush,
  freshId,
  overlay,
  panel,
  pickSource,
  preview,
  show,
  stateWarnings,
} from '../support/panel';

const NO_DATA_TITLE =
  "No recorded or fixture context, so this state can't be previewed yet. Visit it in the app, or add it to defineFixtures().";

const RECORDED = { disabled: false, title: '', status: 'recorded context' };
const NO_DATA = { disabled: true, title: NO_DATA_TITLE, status: "no recorded or fixture context, can't be previewed" };

/** Each row of the shown tree: whether it is disabled, the title of its none mark, and its status words. */
function rows() {
  return Object.fromEntries(
    [...overlay().querySelectorAll<HTMLElement>('[data-leaf]')].map((row) => [
      row.dataset.leaf,
      {
        disabled: row.getAttribute('aria-disabled') === 'true',
        title: row.querySelector('[data-kind="none"]')?.getAttribute('title') ?? '',
        status: row.querySelector('[data-part="leaf-status"]')?.textContent?.replace(/^, /, ''),
      },
    ]),
  );
}

/** Each option of the context source: `enabled`, or `disabled` and the title that says why. */
function sources(): Record<string, string> {
  return Object.fromEntries(
    [...overlay().querySelectorAll<HTMLInputElement>('[aria-label="Context source"] input')].map((input) => [
      input.value,
      input.disabled ? `disabled: ${input.closest('label')?.title}` : 'enabled',
    ]),
  );
}

function previewed() {
  const { previewed, source } = panel();

  return { previewed, source, badge: badge() };
}

async function pressEnter(leaf: string): Promise<void> {
  const row = overlay().querySelector(`[data-leaf="${leaf}"]`);

  if (!row) throw new Error(`The tree has no leaf ${leaf}.`);
  fireEvent.keyDown(row, { key: 'Enter' });
  await flush();
}

test('a state with no data is disabled, its mark says why, and the warning under States names it until the app visits it', async () => {
  const bank = createBank();
  const machine = createOrderMachine(bank);
  await mount(<Order machine={machine} />);
  await show(machine.id);
  const mounted = { rows: rows(), warnings: stateWarnings() };
  await press('order: submit');
  await answer(bank, 'reject');
  const failed = { rows: rows(), warnings: stateWarnings() };
  await press('order: retry');
  await answer(bank, 'resolve', 2);

  expect({ mounted, failed, visited: { rows: rows(), warnings: stateWarnings() } }).toEqual({
    mounted: {
      rows: { idle: RECORDED, loading: NO_DATA, success: NO_DATA, error: NO_DATA },
      warnings: ['No data to preview loading, success, error. Visit them in the app, or add them to defineFixtures().'],
    },
    failed: {
      rows: { idle: RECORDED, loading: RECORDED, success: NO_DATA, error: RECORDED },
      warnings: ['No data to preview success. Visit them in the app, or add them to defineFixtures().'],
    },
    visited: {
      rows: { idle: RECORDED, loading: RECORDED, success: RECORDED, error: RECORDED },
      warnings: [],
    },
  });
});

test('a click or Enter on a disabled row does nothing, and a click on an enabled row previews it or releases it', async () => {
  const output = watchConsole();
  const machine = createOrderMachine(createBank());
  let commits = 0;
  await mount(
    <Order
      machine={machine}
      onCommit={() => {
        commits += 1;
      }}
    />,
  );
  await show(machine.id);
  await clickLeaf('success');
  const clicked = previewed();
  await pressEnter('success');
  const entered = previewed();
  await press('order: submit');
  const submitted = shownOrder();
  await clickLeaf('idle');
  const idle = { panel: previewed(), shown: shownOrder() };
  const before = commits;
  await clickLeaf('success');
  const kept = { panel: previewed(), commits: commits - before };
  await clickLeaf('idle');

  expect({ clicked, entered, submitted, idle, kept, released: previewed(), output }).toEqual({
    clicked: { previewed: [], source: 'none', badge: '' },
    entered: { previewed: [], source: 'none', badge: '' },
    // No preview is on, so the event reaches the real machine.
    submitted: { status: 'loading', orderId: 'o1' },
    idle: { panel: { previewed: ['idle'], source: 'recorded', badge: '1' }, shown: { status: 'idle' } },
    // The preview of idle stays, and the app renders nothing.
    kept: { panel: { previewed: ['idle'], source: 'recorded', badge: '1' }, commits: 0 },
    released: { previewed: [], source: 'none', badge: '' },
    output: { warn: [], error: [] },
  });
});

test('Live is disabled for another state, also when it has a recording, and enabled for the state that the machine is in', async () => {
  const output = watchConsole();
  const bank = createBank();
  const machine = createOrderMachine(bank);
  await mount(<Order machine={machine} />);
  await press('order: submit');
  await answer(bank, 'resolve');
  await preview(machine.id, ['loading']);
  const other = sources();
  await preview(machine.id, ['success']);
  const live = sources();
  await pickSource('live');

  expect({ other, live, picked: { panel: previewed(), shown: shownOrder() }, output }).toEqual({
    other: {
      recorded: 'enabled',
      fixture: 'disabled: No fixture for this state',
      live: 'disabled: The live context belongs to another state',
    },
    live: { recorded: 'enabled', fixture: 'disabled: No fixture for this state', live: 'enabled' },
    picked: {
      panel: { previewed: ['success'], source: 'live', badge: '1' },
      shown: { status: 'success', receipt: 'receipt of o1' },
    },
    output: { warn: [], error: [] },
  });
});

test('the warning under States says when the machine is in a state that its definition doesn’t declare', async () => {
  const bank = createBank();
  const machine = createOrderMachine(bank);
  const view = render(page(<Order machine={machine} />));
  await flush();
  await press('order: submit');
  await answer(bank, 'reject');
  view.rerender(page(<Order machine={createOrderMachine(bank, machine.id, 'error')} />));
  await flush();
  await show(machine.id);

  expect(stateWarnings()).toEqual([
    "The machine is in a state that its definition doesn't declare. The console names the state.",
    'No data to preview success. Visit them in the app, or add them to defineFixtures().',
  ]);
});

function createToggleMachine() {
  return createMachine({
    id: freshId('toggle'),
    initial: 'off',
    context: { count: 0 },
    states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } },
  });
}

function Toggle({ machine }: { machine: ReturnType<typeof createToggleMachine> }) {
  const [snapshot, send] = useMachine(machine);

  return (
    <button type="button" onClick={() => send({ type: 'TOGGLE' })}>
      toggle: {String(snapshot.value)}
    </button>
  );
}

describe('an XState machine', () => {
  test('shows none of it: every row is enabled, the none mark keeps its title, Live fits every state, and no warning shows', async () => {
    const machine = createToggleMachine();
    await mount(<Toggle machine={machine} />);
    await show(machine.id);
    const mounted = { rows: rows(), warnings: stateWarnings() };
    await press('toggle: off');
    await press('toggle: on');
    await preview(machine.id, ['on']);

    expect({ mounted, sources: sources(), shown: screen.getByRole('button', { name: /^toggle/ }).textContent }).toEqual({
      mounted: {
        rows: {
          off: RECORDED,
          // The live context fits every state of an XState machine, so this title is true.
          on: {
            disabled: false,
            title: 'No recorded or fixture context; a preview uses the live context',
            status: 'no recorded or fixture context',
          },
        },
        warnings: [],
      },
      sources: { recorded: 'enabled', fixture: 'disabled: No fixture for this state', live: 'enabled' },
      shown: 'toggle: on',
    });
  });
});

describe('Copy context', () => {
  function footer(): string[] {
    return [...overlay().querySelectorAll('footer button')].map(
      (button) => `${button.getAttribute('aria-label')}: ${button.textContent}`,
    );
  }

  test('copies the state object of the shown state, live or previewed, as indented JSON', async () => {
    const machine = createOrderMachine(createBank());
    await mount(<Order machine={machine} />);
    await press('order: submit');
    await show(machine.id);
    const live = await copy('Copy context');
    await preview(machine.id, ['idle']);
    const previewing = await copy('Copy context');

    // jsdom has no clipboard, so the status always says the copy failed.
    expect({ live, previewing, labels: footer() }).toEqual({
      live: { copied: [JSON.stringify({ status: 'loading', orderId: 'o1' }, null, 2)], status: 'Copy failed' },
      previewing: { copied: [JSON.stringify({ status: 'idle' }, null, 2)], status: 'Copy failed' },
      labels: ['Copy context: Copy failed', 'Copy JSON: Copy JSON'],
    });
  });

  test('copies the context of an XState machine, which is the value of `context` in its fixture', async () => {
    const machine = createToggleMachine();
    await mount(<Toggle machine={machine} />);
    await show(machine.id);

    expect((await copy('Copy context')).copied).toEqual([JSON.stringify({ count: 0 }, null, 2)]);
  });
});
