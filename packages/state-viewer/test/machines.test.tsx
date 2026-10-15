import { fireEvent, render, screen } from '@testing-library/react';
import { StateViewer } from 'state-viewer';
import { connect, defineFixtures, useMachine } from 'state-viewer/xstate';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { createActor, createMachine, setup, type AnyStateMachine } from 'xstate';
import { clickLeaf, flush, freshId, header, overlay, panel, preview, show } from './support/panel';

function createToggleMachine(name: string) {
  return createMachine({
    id: freshId(name),
    initial: 'off',
    states: { off: { on: { TOGGLE: 'on' } }, on: { on: { TOGGLE: 'off' } } },
  });
}

function createFamily() {
  const fetcher = createMachine({ id: freshId('fetcher'), initial: 'loading', states: { loading: {}, failed: {} } });
  const parent = setup({ actors: { fetcher } }).createMachine({
    id: freshId('parent'),
    initial: 'active',
    states: { active: { invoke: { id: 'load', src: 'fetcher' } } },
  });
  return { parent, fetcher };
}

type Edit = 'as written' | 'without paying.card.error' | 'with paying made compound' | 'with a gift region';

/** A machine edited in the source file: HMR evaluates the file again, so each call makes a new machine object. */
function createCheckoutMachine(id: string, edit: Edit = 'as written') {
  const cardStates: Record<string, object> =
    edit === 'without paying.card.error' ? { idle: {} } : { idle: {}, error: {} };
  const card = { initial: 'idle', states: cardStates };
  const shipping = { initial: 'standard', states: { standard: {}, express: {} } };
  const gift = { initial: 'none', states: { none: {}, wrapped: {} } };
  return createMachine({
    id,
    context: { note: 'live' },
    initial: 'paying',
    states: {
      paying:
        edit === 'with paying made compound'
          ? { initial: 'card', states: { card, shipping } }
          : { type: 'parallel', states: edit === 'with a gift region' ? { card, shipping, gift } : { card, shipping } },
    },
  });
}

function Instance({ machine, label }: { machine: AnyStateMachine; label?: string }) {
  const [snapshot] = useMachine(machine, label === undefined ? undefined : { debug: { label } });
  return <output aria-label={label ?? machine.id}>{JSON.stringify(snapshot.value)}</output>;
}

function shown(name: string) {
  return JSON.parse(screen.getByRole('status', { name }).textContent ?? 'null');
}

function pickers() {
  const { machine, instance } = header();
  return { machine, instance };
}

/** What the States section shows about the parent and the children of the shown instance. */
function family() {
  const states = [...overlay().querySelectorAll('section.sv-section')].find(
    (section) => section.querySelector('h3')?.textContent === 'States',
  );
  if (!states) throw new Error('The panel shows no States section.');
  return {
    hints: [...states.querySelectorAll('p.sv-hint')].map((hint) => hint.textContent),
    children: [...states.querySelectorAll('.sv-children button')].map((button) => button.textContent),
    readOnly: [...states.querySelectorAll<HTMLElement>('[data-leaf][aria-disabled="true"]')].map(
      (leaf) => leaf.dataset.leaf,
    ),
  };
}

async function clickButton(text: string) {
  const found = [...overlay().querySelectorAll('button')].find((button) => button.textContent === text);
  if (!found) throw new Error(`The panel has no ${text} button.`);
  fireEvent.click(found);
  await flush();
}

test('lists each machine once, in registration order, and its instances as "machine · n"', async () => {
  // connect() registers an actor that runs outside React at once, before any component mounts.
  const app = createToggleMachine('app');
  const actor = createActor(app).start();
  onTestFinished(() => {
    actor.stop();
  });
  connect(actor);
  const checkout = createToggleMachine('checkout');
  const toggle = createToggleMachine('toggle');
  render(
    <>
      <Instance machine={checkout} />
      <Instance machine={toggle} />
      <Instance machine={toggle} label="Second toggle" />
      <StateViewer defaultOpen />
    </>,
  );
  await flush();

  const first = pickers();
  await show(toggle.id);
  const toggles = pickers();
  await preview(toggle.id, ['on'], { nth: 2 });
  const machines = [app.id, checkout.id];
  expect({
    first,
    toggles,
    previewed: { ...pickers(), shown: [shown(toggle.id), shown('Second toggle')] },
  }).toEqual({
    first: {
      machine: { options: [...machines, `${toggle.id} (2)`], selected: app.id, disabled: false },
      instance: { options: [`${app.id} · 1`], selected: `${app.id} · 1`, disabled: true },
    },
    toggles: {
      machine: { options: [...machines, `${toggle.id} (2)`], selected: `${toggle.id} (2)`, disabled: false },
      instance: {
        options: [`${toggle.id} · 1`, 'Second toggle · 2'],
        selected: `${toggle.id} · 1`,
        disabled: false,
      },
    },
    previewed: {
      machine: { options: [...machines, `${toggle.id} (2) ●`], selected: `${toggle.id} (2) ●`, disabled: false },
      instance: {
        options: [`${toggle.id} · 1`, 'Second toggle · 2 ●'],
        selected: 'Second toggle · 2 ●',
        disabled: false,
      },
      shown: ['off', 'on'],
    },
  });
});

test('rows come and go as their components mount and unmount, and keep the order they registered in', async () => {
  const machine = createToggleMachine('row');
  const rows = (labels: string[]) => (
    <>
      {labels.map((label) => (
        <Instance key={label} machine={machine} label={label} />
      ))}
      <StateViewer defaultOpen />
    </>
  );
  const view = render(rows(['B', 'C']));
  await flush();
  const seen = () => ({ previewing: header().previewing, instances: header().instance?.options ?? null });

  const steps = [seen()];
  view.rerender(rows(['A', 'B', 'C']));
  await flush();
  steps.push(seen());
  await preview(machine.id, ['on']);
  steps.push(seen());
  view.rerender(rows(['A', 'C']));
  await flush();
  steps.push(seen());
  view.rerender(rows([]));
  await flush();
  steps.push(seen());
  expect(steps).toEqual([
    { previewing: '', instances: ['B · 1', 'C · 2'] },
    { previewing: '', instances: ['B · 1', 'C · 2', 'A · 3'] },
    { previewing: '1 previewing', instances: ['B · 1 ●', 'C · 2', 'A · 3'] },
    { previewing: '', instances: ['C · 1', 'A · 2'] },
    { previewing: '', instances: null },
  ]);
});

describe('child machines', () => {
  test('are listed read-only under their parent', async () => {
    const { parent, fetcher } = createFamily();
    render(
      <>
        <Instance machine={parent} />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

    const atParent = { ...pickers(), family: family() };
    await clickButton('load · 1');
    const atChild = { ...pickers(), family: family() };
    await clickLeaf('failed');
    expect({ atParent, atChild, clicked: { previewed: panel().previewed, previewing: header().previewing } }).toEqual({
      atParent: {
        machine: { options: [parent.id, `${fetcher.id} (child)`], selected: parent.id, disabled: false },
        instance: { options: [`${parent.id} · 1`], selected: `${parent.id} · 1`, disabled: true },
        family: { hints: [], children: ['load · 1'], readOnly: [] },
      },
      atChild: {
        machine: { options: [parent.id, `${fetcher.id} (child)`], selected: `${fetcher.id} (child)`, disabled: false },
        instance: { options: ['load · 1'], selected: 'load · 1', disabled: true },
        family: {
          hints: [`Child of ${parent.id} · 1. Child machines are listed read-only.`],
          children: [],
          readOnly: ['loading', 'failed'],
        },
      },
      clicked: { previewed: [], previewing: '' },
    });
  });

  test('a machine that also runs on its own is an ordinary machine, and only its own instances preview', async () => {
    const { parent, fetcher } = createFamily();
    render(
      <>
        <Instance machine={parent} />
        <Instance machine={fetcher} />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

    for (const nth of [1, 2]) {
      await show(fetcher.id, nth);
      await clickLeaf('failed');
    }
    // XState creates the invoked child with the parent's first snapshot, so it registers with the parent, first.
    const { machine, instance } = header();
    expect({ machines: machine?.options, instances: instance?.options, shown: shown(fetcher.id) }).toEqual({
      machines: [parent.id, `${fetcher.id} (2) ●`],
      instances: ['load · 1', `${fetcher.id} · 2 ●`],
      shown: 'failed',
    });
  });
});

describe('editing a machine, as Fast Refresh does', () => {
  // The edited machine keeps its id. @xstate/react starts a new actor for its new config, which registers in the
  // place of the old one.
  function App({ machine, toggle }: { machine: AnyStateMachine; toggle: AnyStateMachine }) {
    return (
      <>
        <Instance machine={machine} label="First" />
        <Instance machine={machine} label="Second" />
        <Instance machine={toggle} />
        <StateViewer defaultOpen />
      </>
    );
  }

  test('keeps the preview, and each row in its place', async () => {
    const id = freshId('checkout');
    const toggle = createToggleMachine('toggle');
    const view = render(<App machine={createCheckoutMachine(id)} toggle={toggle} />);
    await flush();
    await preview(id, ['paying.card.error']);

    view.rerender(<App machine={createCheckoutMachine(id)} toggle={toggle} />);
    await flush();
    const { previewing, machine, instance } = header();
    expect({
      previewing,
      machines: machine?.options,
      instances: instance?.options,
      previewed: panel().previewed,
      shown: [shown('First'), shown('Second')],
    }).toEqual({
      previewing: '1 previewing',
      machines: [`${id} (2) ●`, toggle.id],
      instances: ['First · 1 ●', 'Second · 2'],
      previewed: ['paying.card.error'],
      shown: [
        { paying: { card: 'error', shipping: 'standard' } },
        { paying: { card: 'idle', shipping: 'standard' } },
      ],
    });
  });

  test.each([
    ['removes the previewed leaf', 'without paying.card.error', ['paying.card.error']],
    [
      'puts the previewed leaves in states that exclude each other',
      'with paying made compound',
      ['paying.card.error', 'paying.shipping.express'],
    ],
  ] as const)('an edit that %s ends the preview', async (_, edit, leaves) => {
    const id = freshId('checkout');
    const app = (machine: AnyStateMachine) => (
      <>
        <Instance machine={machine} />
        <StateViewer defaultOpen />
      </>
    );
    const view = render(app(createCheckoutMachine(id)));
    await flush();
    await preview(id, [...leaves]);
    const before = header().previewing;

    view.rerender(app(createCheckoutMachine(id, edit)));
    await flush();
    // @xstate/react starts the new actor from the persisted snapshot of the old one, so the live state carries over.
    expect({ before, after: header().previewing, previewed: panel().previewed, shown: shown(id) }).toEqual({
      before: '1 previewing',
      after: '',
      previewed: [],
      shown: { paying: { card: 'idle', shipping: 'standard' } },
    });
  });

  test('an edit that adds a region keeps the preview, which shows the initial leaf of the new region', async () => {
    const id = freshId('checkout');
    const app = (machine: AnyStateMachine) => (
      <>
        <Instance machine={machine} />
        <StateViewer defaultOpen />
      </>
    );
    const view = render(app(createCheckoutMachine(id)));
    await flush();
    await preview(id, ['paying.card.error']);

    view.rerender(app(createCheckoutMachine(id, 'with a gift region')));
    await flush();
    expect({ previewed: panel().previewed, filled: panel().filled, shown: shown(id) }).toEqual({
      previewed: ['paying.card.error'],
      filled: ['paying.shipping.standard', 'paying.gift.none'],
      shown: { paying: { card: 'error', shipping: 'standard', gift: 'none' } },
    });
  });

  test('a picked source stays picked through the edit, when the fixtures file registers its fixtures again', async () => {
    const id = freshId('checkout');
    // The fixtures file imports the machine, so HMR evaluates it again with the edited machine.
    const app = (machine: AnyStateMachine) => (
      <>
        <Instance machine={machine} />
        <StateViewer
          defaultOpen
          fixtures={[defineFixtures(machine, { 'paying.card.error': { context: { note: 'card error' } } })]}
        />
      </>
    );
    const view = render(app(createCheckoutMachine(id)));
    await flush();
    await preview(id, ['paying.card.error'], { source: 'live' });

    view.rerender(app(createCheckoutMachine(id, 'with a gift region')));
    await flush();
    expect({ source: panel().source, context: panel().context, filled: panel().filled }).toEqual({
      source: 'live',
      context: ['note: "live"'],
      filled: ['paying.shipping.standard', 'paying.gift.none'],
    });
  });
});

describe('machine ids', () => {
  test('an id that every object has as a property, such as constructor, lists and previews like any other', async () => {
    const machine = createMachine({ id: 'constructor', initial: 'off', states: { off: {}, on: {} } });
    render(
      <>
        <Instance machine={machine} />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

    await preview('constructor', ['on']);
    expect({ machines: header().machine?.options, previewed: panel().previewed, shown: shown('constructor') }).toEqual({
      machines: ['constructor ●'],
      previewed: ['on'],
      shown: 'on',
    });
  });
});

describe('a second copy of the package', () => {
  test('registers its machines with the page, so the overlay of the first copy lists and previews them', async () => {
    const machine = createToggleMachine('toggle');
    // Two bundles of an app can each include the package. The modules evaluate again, and nothing is replaced.
    vi.resetModules();
    const second = await import('state-viewer/xstate');
    function SecondCopy() {
      const [snapshot] = second.useMachine(machine, { debug: { label: 'Second copy' } });
      return <output aria-label="Second copy">{JSON.stringify(snapshot.value)}</output>;
    }
    render(
      <>
        <Instance machine={machine} label="First copy" />
        <SecondCopy />
        <StateViewer defaultOpen />
      </>,
    );
    await flush();

    await preview(machine.id, ['on'], { nth: 2 });
    expect({ instances: header().instance?.options, shown: [shown('First copy'), shown('Second copy')] }).toEqual({
      instances: ['First copy · 1', 'Second copy · 2 ●'],
      shown: ['off', 'on'],
    });
  });
});
