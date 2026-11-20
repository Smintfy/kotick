import { fireEvent, screen } from '@testing-library/react';
import type { FixtureSet } from 'konat';
import { describe, expect, test } from 'vitest';
import { mount, press } from '../support/app';
import { watchConsole } from '../support/console';
import {
  answer,
  createBank,
  createOrderMachine,
  Order,
  shownOrder,
  type OrderEvent,
  type OrderState,
} from '../support/order';
import {
  badge,
  blockedEvents,
  clickLeaf,
  flush,
  marks,
  overlay,
  panel,
  preview,
  release,
  show,
  shownKey,
} from '../support/panel';

/** Each machine page lists the blocked events of the whole page, so a test first clears those of earlier tests. */
async function clearBlockedEvents(): Promise<void> {
  const clear = [...overlay().querySelectorAll('button')].find((button) => button.textContent === 'Clear');

  if (clear) fireEvent.click(clear);
  await flush();
}

function note(): string {
  return screen.getByLabelText<HTMLInputElement>('order note').value;
}

function previewed() {
  const { previewed, source } = panel();

  return { previewed, source, badge: badge() };
}

test('the panel lists the states in order with an R mark on each visited state, and a visited state previews without a remount', async () => {
  const bank = createBank();
  const machine = createOrderMachine(bank);
  await mount(<Order machine={machine} />);
  await show(machine.id);
  const mounted = marks();
  await press('order: submit');
  await answer(bank, 'resolve');
  const live = panel().context;
  fireEvent.change(screen.getByLabelText('order note'), { target: { value: 'typed before the preview' } });
  await preview(machine.id, ['loading']);

  expect({
    mounted: Object.entries(mounted),
    visited: marks(),
    live,
    preview: { shown: shownOrder(), panel: previewed(), note: note(), effects: bank.log },
  }).toEqual({
    mounted: [
      ['idle', ['recorded']],
      ['loading', ['none']],
      ['success', ['none']],
      ['error', ['none']],
    ],
    visited: { idle: ['recorded'], loading: ['recorded'], success: ['recorded'], error: ['none'] },
    // The Context view shows the state object of the real state, discriminant included.
    live: ['status: "success"', 'receipt: "receipt of o1"'],
    preview: {
      shown: { status: 'loading', orderId: 'o1' },
      panel: { previewed: ['loading'], source: 'recorded', badge: '1' },
      note: 'typed before the preview',
      // The previewed state runs no effect.
      effects: ['start o1', 'cleanup o1'],
    },
  });
});

test('an event that the UI sends during a preview is blocked and logged with the state that the UI showed', async () => {
  const bank = createBank();
  const machine = createOrderMachine(bank);
  await mount(<Order machine={machine} />);
  await press('order: submit');
  await preview(machine.id, ['idle']);
  await clearBlockedEvents();
  await press('order: submit');
  const blocked = { shown: shownOrder(), rows: blockedEvents(), effects: [...bank.log] };
  await release(machine.id);
  await press('order: retry');

  expect({ blocked, released: { shown: shownOrder(), rows: blockedEvents() } }).toEqual({
    blocked: {
      shown: { status: 'idle' },
      rows: [`SUBMIT · ${machine.id} · 1 · in idle · {"orderId":"o1"}`],
      effects: ['start o1'],
    },
    // The loading state ignores RETRY, and nothing blocks it after the release.
    released: {
      shown: { status: 'loading', orderId: 'o1' },
      rows: [`SUBMIT · ${machine.id} · 1 · in idle · {"orderId":"o1"}`],
    },
  });
});

test('an event that an effect sends during a preview reaches the real machine, and a release shows the state that it moved to', async () => {
  const bank = createBank();
  const machine = createOrderMachine(bank);
  await mount(<Order machine={machine} />);
  await press('order: submit');
  await preview(machine.id, ['idle']);
  await clearBlockedEvents();
  await answer(bank, 'resolve');
  const during = { shown: shownOrder(), rows: blockedEvents(), marks: marks(), effects: [...bank.log] };
  await release(machine.id);

  expect({ during, released: { shown: shownOrder(), panel: previewed() } }).toEqual({
    during: {
      shown: { status: 'idle' },
      rows: [],
      marks: { idle: ['recorded'], loading: ['recorded'], success: ['recorded'], error: ['none'] },
      effects: ['start o1', 'cleanup o1'],
    },
    released: {
      shown: { status: 'success', receipt: 'receipt of o1' },
      panel: { previewed: [], source: 'none', badge: '' },
    },
  });
});

describe('an override that the app can’t show', () => {
  const WRONG: OrderState = { status: 'error', orderId: 'o9', message: 'a fixture of another state' };

  /** A set as an older copy of konat or a hand-written file gives it. defineFixtures() leaves such a fixture out. */
  function wrongSuccess(machineId: string): FixtureSet[] {
    return [{ machineId, states: { success: { context: WRONG } } }];
  }

  function ended(source: string): string {
    return (
      `[konat] Ended the preview of "success" on "${shownKey()}", because its ${source} context isn't in the ` +
      `"success" state. An older copy of konat on the page, or a fixture set that defineFixtures() didn't make, can cause this.`
    );
  }

  test('a preview of a state with no data shows the real state, ends with one warning, and blocks no event', async () => {
    const output = watchConsole();
    const machine = createOrderMachine(createBank());
    await mount(<Order machine={machine} />);
    await show(machine.id);
    await clearBlockedEvents();
    await clickLeaf('success');
    const clicked = { shown: shownOrder(), panel: previewed(), warnings: [...output.warn] };
    await press('order: submit');

    expect({ clicked, submitted: { shown: shownOrder(), rows: blockedEvents(), output } }).toEqual({
      clicked: {
        shown: { status: 'idle' },
        panel: { previewed: [], source: 'none', badge: '' },
        warnings: [
          `[konat] No recorded or fixture context for "success" on "${shownKey()}", so the preview uses the live context.`,
          ended('live'),
        ],
      },
      submitted: {
        shown: { status: 'loading', orderId: 'o1' },
        rows: [],
        output: {
          warn: [
            `[konat] No recorded or fixture context for "success" on "${shownKey()}", so the preview uses the live context.`,
            ended('live'),
          ],
          error: [],
        },
      },
    });
  });

  test('a fixture of another state, from a set that defineFixtures() didn’t make, shows the real state, ends with one warning, and blocks no event', async () => {
    const output = watchConsole();
    const machine = createOrderMachine(createBank());
    await mount(<Order machine={machine} />, { fixtures: wrongSuccess(machine.id) });
    await show(machine.id);
    await clearBlockedEvents();
    const before = marks();
    await clickLeaf('success');
    const clicked = { shown: shownOrder(), panel: previewed() };
    await press('order: submit');

    expect({ before, clicked, submitted: { shown: shownOrder(), rows: blockedEvents() }, output }).toEqual({
      before: { idle: ['recorded'], loading: ['none'], success: ['fixture'], error: ['none'] },
      clicked: { shown: { status: 'idle' }, panel: { previewed: [], source: 'none', badge: '' } },
      submitted: { shown: { status: 'loading', orderId: 'o1' }, rows: [] },
      output: { warn: [ended('fixture')], error: [] },
    });
  });

  test('an event that the app sends in the commit that gets such a preview reaches the real machine', async () => {
    const machine = createOrderMachine(createBank());
    let previewing = false;

    // The layout effect of the commit runs before the passive effect that ends the preview.
    const submitOnce = (dispatch: (event: OrderEvent) => void): void => {
      if (!previewing) return;
      previewing = false;
      dispatch({ type: 'SUBMIT', orderId: 'o2' });
    };

    await mount(<Order machine={machine} onCommit={submitOnce} />, { fixtures: wrongSuccess(machine.id) });
    await show(machine.id);
    await clearBlockedEvents();
    previewing = true;
    await clickLeaf('success');

    expect({ sent: !previewing, shown: shownOrder(), rows: blockedEvents(), panel: previewed() }).toEqual({
      sent: true,
      shown: { status: 'loading', orderId: 'o2' },
      rows: [],
      panel: { previewed: [], source: 'none', badge: '' },
    });
  });
});
