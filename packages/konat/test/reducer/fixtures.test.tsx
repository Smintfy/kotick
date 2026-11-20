import { defineFixtures } from 'konat/reducer';
import { describe, expect, test } from 'vitest';
import { lazyFixtures, mount, press } from '../support/app';
import { watchConsole } from '../support/console';
import { createBank, createOrderMachine, Order, shownOrder } from '../support/order';
import {
  badge,
  clickLeaf,
  copy,
  disabledLeaves,
  marks,
  panel,
  preview,
  show,
  stateWarnings,
} from '../support/panel';

/** What the States section shows: the marks of each state, the disabled rows and the warnings. */
function states() {
  return { marks: marks(), disabled: disabledLeaves(), warnings: stateWarnings() };
}

function previewed() {
  const { previewed, source } = panel();

  return { previewed, source, badge: badge() };
}

test('when the loader resolves, every state gets an F mark, the rows enable and the warning goes', async () => {
  const machine = createOrderMachine(createBank());
  const lazy = lazyFixtures();
  await mount(<Order machine={machine} />, { fixtures: lazy.loader });
  await show(machine.id);
  const loading = states();
  await lazy.resolve([
    defineFixtures(machine, {
      idle: { status: 'idle' },
      loading: { status: 'loading', orderId: 'o7' },
      success: { status: 'success', receipt: 'receipt of o7' },
      error: { status: 'error', orderId: 'o7', message: 'declined' },
    }),
  ]);

  expect({ loading, loaded: states() }).toEqual({
    loading: {
      marks: { idle: ['recorded'], loading: ['none'], success: ['none'], error: ['none'] },
      disabled: ['loading', 'success', 'error'],
      warnings: ['No data to preview loading, success, error. Visit them in the app, or add them to defineFixtures().'],
    },
    loaded: {
      marks: { idle: ['recorded', 'fixture'], loading: ['fixture'], success: ['fixture'], error: ['fixture'] },
      disabled: [],
      warnings: [],
    },
  });
});

test('a set with one state gives that state an F mark, and a preview of that state, which the app never visited, shows its fixture', async () => {
  const machine = createOrderMachine(createBank());
  const fixtures = [defineFixtures(machine, { error: { status: 'error', orderId: 'o7', message: 'declined' } })];
  await mount(<Order machine={machine} />, { fixtures });
  await show(machine.id);
  const listed = states();
  await preview(machine.id, ['error']);

  expect({ listed, shown: shownOrder(), panel: previewed() }).toEqual({
    listed: {
      marks: { idle: ['recorded'], loading: ['none'], success: ['none'], error: ['fixture'] },
      disabled: ['loading', 'success'],
      warnings: ['No data to preview loading, success. Visit them in the app, or add them to defineFixtures().'],
    },
    shown: { status: 'error', orderId: 'o7', message: 'declined' },
    panel: { previewed: ['error'], source: 'fixture', badge: '1' },
  });
});

test('the JSON that Copy context copies is the fixture of its state as it is', async () => {
  const output = watchConsole();
  const machine = createOrderMachine(createBank());
  const lazy = lazyFixtures();
  await mount(<Order machine={machine} />, { fixtures: lazy.loader });
  await press('order: submit');
  await show(machine.id);
  const [copied] = (await copy('Copy context')).copied;
  await lazy.resolve([defineFixtures(machine, { loading: JSON.parse(copied) })]);
  await preview(machine.id, ['loading'], { source: 'fixture' });

  expect({ marks: marks().loading, panel: previewed(), shown: shownOrder(), output }).toEqual({
    marks: ['recorded', 'fixture'],
    panel: { previewed: ['loading'], source: 'fixture', badge: '1' },
    shown: { status: 'loading', orderId: 'o1' },
    output: { warn: [], error: [] },
  });
});

describe('a set from JavaScript, which no type checks', () => {
  test('leaves out a fixture of another state and a name that isn’t a state with a warning, so the state stays disabled', async () => {
    const output = watchConsole();
    const machine = createOrderMachine(createBank());

    // JSON.parse() gives an object with no type, as a JavaScript app passes it.
    const fromJavaScript = JSON.parse(
      '{"success":{"status":"error","orderId":"o9","message":"another state"},"paused":{"status":"paused"}}',
    );

    await mount(<Order machine={machine} />, { fixtures: [defineFixtures(machine, fromJavaScript)] });
    await show(machine.id);
    const listed = states();
    await clickLeaf('success');
    const clicked = previewed();
    await press('order: submit');

    expect({ listed, clicked, submitted: shownOrder(), output }).toEqual({
      listed: {
        marks: { idle: ['recorded'], loading: ['none'], success: ['none'], error: ['none'] },
        disabled: ['loading', 'success', 'error'],
        warnings: ['No data to preview loading, success, error. Visit them in the app, or add them to defineFixtures().'],
      },
      clicked: { previewed: [], source: 'none', badge: '' },
      // No preview is on, so the event reaches the real machine.
      submitted: { status: 'loading', orderId: 'o1' },
      output: {
        warn: [
          `[konat] The fixture of "success" on "${machine.id}" isn't in the "success" state, so the set leaves it out.`,
          `[konat] "${machine.id}" has no state "paused", so the set leaves its fixture out.`,
        ],
        error: [],
      },
    });
  });
});
