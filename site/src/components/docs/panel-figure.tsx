'use client';

import type { FixtureSet } from 'konat';
import { type FigurePage, KonatFigure } from 'konat/figure';
import { OverlayDock } from '@/components/overlay-dock';
import { checkoutMachine } from '@/demo/checkout/xstate-machine';
import { fixturesInEveryBuild } from '@/demo/checkout/xstate-fixtures';
import { onboardingMachine } from '@/demo/onboarding/xstate-machine';
import { onboardingFixtures } from '@/demo/onboarding/xstate-fixtures';

type PanelFigureProps = { caption: string; height?: number } & (
  | { page: 'machines' | 'settings' }
  | { page: 'machine'; machine: string; preview?: string }
);

const machines = [checkoutMachine, onboardingMachine];

const leavesWithoutFixtures = new Set(['shipping.express', 'shipping.pickup']);

const fixtures: FixtureSet[] = [
  ...fixturesInEveryBuild.map((set) => ({
    ...set,
    states: Object.fromEntries(Object.entries(set.states).filter(([leaf]) => !leavesWithoutFixtures.has(leaf))),
  })),
  ...onboardingFixtures,
];

function toPage(props: PanelFigureProps): FigurePage {
  switch (props.page) {
    case 'machines':
    case 'settings':
      return { kind: props.page };
    case 'machine':
      return {
        kind: 'machine',
        machineId: props.machine,
        preview: props.preview === undefined ? undefined : { leaves: [props.preview] },
      };
  }
}

const dockTop = 8;

const panelWidth = 280;

const panelInset = 16;

const dockWidth = panelWidth + 2 * panelInset;

export function PanelFigure(props: PanelFigureProps) {
  const page = toPage(props);
  const height = props.height ?? 400;

  return (
    <figure className="my-6">
      <div className="relative overflow-hidden rounded-2xl bg-card shadow-edge" style={{ height }}>
        <OverlayDock
          inert
          className="absolute left-1/2 h-[800px] -translate-x-1/2"
          style={{ top: dockTop, width: dockWidth }}
          overlay={(dock) => (
            <KonatFigure
              key={JSON.stringify(page)}
              machines={machines}
              fixtures={fixtures}
              page={page}
              position="top-left"
              portalTarget={dock}
            />
          )}
        />
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted-foreground">{props.caption}</figcaption>
    </figure>
  );
}
