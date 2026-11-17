import { fireEvent, render } from '@testing-library/react';
import type { FixtureSet } from 'konat';
import { KonatFigure, type FigurePage } from 'konat/figure';
import { defineFixtures, useMachine } from 'konat/xstate';
import { describe, expect, onTestFinished, test } from 'vitest';
import { createMachine, type AnyStateMachine } from 'xstate';
import { flush, freshId } from './support/panel';

function createCheckoutMachine(id: string) {
  return createMachine({
    id,
    type: 'parallel',
    context: { error: '' },
    states: {
      card: { initial: 'idle', states: { idle: {}, error: {} } },
      shipping: { initial: 'standard', states: { standard: {}, express: {} } },
    },
  });
}

function createToggleMachine(id: string) {
  return createMachine({ id, initial: 'off', states: { off: {}, on: {} } });
}

/** Renders the figure into a frame of its own, and returns the shadow root of its overlay. */
async function renderFigure(page: FigurePage, machines: AnyStateMachine[], fixtures: FixtureSet[] = []) {
  const frame = document.createElement('div');
  document.body.append(frame);
  onTestFinished(() => frame.remove());
  render(<KonatFigure machines={machines} fixtures={fixtures} page={page} position="top-left" portalTarget={frame} />);
  await flush();
  const root = frame.querySelector('[data-konat-root]')?.shadowRoot;

  if (!root) throw new Error('The figure rendered no overlay.');

  return root;
}

/** What the open panel shows, read from the header, the machine rows, the leaves and the radio groups. */
function shown(root: ShadowRoot) {
  const panel = root.querySelector<HTMLElement>('section[aria-label="Konat"]');

  if (!panel) throw new Error('The panel is closed.');
  const text = (element: Element | null) => element?.textContent ?? '';

  return {
    page: panel.dataset.page,
    title: text(panel.querySelector('h2')),
    chips: [...panel.querySelectorAll('header [data-part="chip"]')].map((chip) => chip.getAttribute('title') ?? text(chip)),
    rows: [...panel.querySelectorAll('[data-row="machine"]')].map(
      (row) => `${text(row.querySelector('[data-part="row-name"]'))} · ${text(row.querySelector('[data-part="row-end"]'))}`,
    ),
    leaves: Object.fromEntries(
      [...panel.querySelectorAll<HTMLElement>('[data-leaf]')].map((leaf) => [
        leaf.dataset.leaf,
        [
          ...[...leaf.querySelectorAll<HTMLElement>('[data-kind]')].map((mark) => mark.dataset.kind),
          ...(leaf.getAttribute('aria-selected') === 'true' ? ['previewed'] : []),
        ],
      ]),
    ),
    radios: Object.fromEntries(
      [...panel.querySelectorAll('[role="radiogroup"]')].map((group) => [
        group.getAttribute('aria-label') ?? text(root.getElementById(group.getAttribute('aria-labelledby') ?? '')),
        group.querySelector<HTMLInputElement>('input:checked')?.value,
      ]),
    ),
  };
}

// Each figure has its own registry, so the machines of the table can keep their ids.
test.each([
  {
    page: { kind: 'machines' },
    expected: {
      page: 'machines',
      title: 'Machines',
      chips: ['/', '2'],
      rows: ['checkout-figure · 4 states', 'toggle-figure · 2 states'],
      leaves: {},
      radios: {},
    },
  },
  {
    page: { kind: 'machine', machineId: 'checkout-figure', preview: { leaves: ['card.error'], source: 'fixture' } },
    expected: {
      page: 'machine',
      title: 'checkout-figure',
      chips: ['1 previewed state'],
      rows: [],
      leaves: {
        'card.idle': ['recorded'],
        'card.error': ['fixture', 'previewed'],
        'shipping.standard': ['recorded'],
        'shipping.express': ['none'],
      },
      radios: { 'Context source': 'fixture' },
    },
  },
  {
    page: { kind: 'settings' },
    expected: {
      page: 'settings',
      title: 'Settings',
      chips: [],
      rows: [],
      leaves: {},
      radios: { Corner: 'top-left' },
    },
  },
] satisfies { page: FigurePage; expected: ReturnType<typeof shown> }[])('opens the panel on the $page.kind page', async ({ page, expected }) => {
  const checkout = createCheckoutMachine('checkout-figure');
  const fixtures = defineFixtures(checkout, { 'card.error': { context: { error: 'Card declined' } } });
  const root = await renderFigure(page, [checkout, createToggleMachine('toggle-figure')], [fixtures]);

  expect(shown(root)).toEqual(expected);
});

describe('next to the machines of the page', () => {
  test('shows only its own machines, and reads and writes no storage', async () => {
    const pageMachine = createToggleMachine(freshId('page-toggle'));
    const figureMachine = createToggleMachine(freshId('figure-toggle'));
    const stored = JSON.stringify({ v: 1, open: false, machine: pageMachine.id });
    localStorage.setItem('konat:ui', stored);

    function App() {
      const [snapshot] = useMachine(pageMachine);

      return <p>{String(snapshot.value)}</p>;
    }

    render(<App />);
    const root = await renderFigure({ kind: 'machines' }, [figureMachine]);
    const rows = shown(root).rows;
    const row = root.querySelector(`[data-machine="${figureMachine.id}"]`);

    if (!row) throw new Error('The figure has no row for its machine.');
    fireEvent.click(row);
    await flush();
    window.dispatchEvent(new Event('pagehide'));

    expect({
      rows,
      title: shown(root).title,
      settings: localStorage.getItem('konat:ui'),
      recordings: Object.keys(sessionStorage).filter((key) => key.startsWith('konat:recorded:')),
    }).toEqual({
      rows: [`${figureMachine.id} · 2 states`],
      title: figureMachine.id,
      settings: stored,
      recordings: [`konat:recorded:${pageMachine.id}`],
    });
  });
});
