'use client';

import type { FixtureSet } from 'kotick';
import { type FigurePage, figureReducer, KotickFigure, type KotickFigureProps } from 'kotick/figure';
import { AdapterSwitch, useAdapter, useInlineSwitch } from '@/components/docs/adapter-tabs';
import { OverlayDock } from '@/components/overlay-dock';
import type { Adapter } from '@/content/adapters';
import { checkoutReducerFixtures } from '@/demo/checkout/reducer/fixtures';
import { checkoutReducerMachine, initialCheckout } from '@/demo/checkout/reducer/machine';
import { fixturesInEveryBuild } from '@/demo/checkout/xstate/fixtures';
import { checkoutMachine } from '@/demo/checkout/xstate/machine';
import { onboardingReducerFixtures } from '@/demo/onboarding/reducer/fixtures';
import { initialOnboarding, onboardingReducerMachine } from '@/demo/onboarding/reducer/machine';
import { onboardingFixtures } from '@/demo/onboarding/xstate/fixtures';
import { onboardingMachine } from '@/demo/onboarding/xstate/machine';

/** The machine id of each demo, for each adapter. */
const demos = {
  checkout: { reducer: checkoutReducerMachine.id, xstate: checkoutMachine.id },
  onboarding: { reducer: onboardingReducerMachine.id, xstate: onboardingMachine.id },
} satisfies Record<string, Record<Adapter, string>>;

type PanelFigureProps = { height?: number } & (
  | { page: 'machines' | 'settings'; caption: string }
  | ({ page: 'machine'; demo: keyof typeof demos } & Record<`${Adapter}Preview` | `${Adapter}Caption`, string>)
);

type Scene = Pick<KotickFigureProps, 'machines' | 'reducers' | 'fixtures'>;

/** The set without the fixtures of these leaves, so that the figure shows states with no data. */
function withoutFixtures(set: FixtureSet, leaves: readonly string[]): FixtureSet {
  return { ...set, states: Object.fromEntries(Object.entries(set.states).filter(([leaf]) => !leaves.includes(leaf))) };
}

const scenes: Record<Adapter, Scene> = {
  reducer: {
    reducers: [figureReducer(checkoutReducerMachine, initialCheckout), figureReducer(onboardingReducerMachine, initialOnboarding)],
    fixtures: [withoutFixtures(checkoutReducerFixtures, ['success']), onboardingReducerFixtures],
  },
  xstate: {
    machines: [checkoutMachine, onboardingMachine],
    fixtures: [
      ...fixturesInEveryBuild.map((set) => withoutFixtures(set, ['shipping.express', 'shipping.pickup'])),
      ...onboardingFixtures,
    ],
  },
};

/** The page and the caption of the figure, and the machines of the adapter when the page shows machines. */
interface Figure {
  page: FigurePage;
  caption: string;
  scene?: Scene;
}

function toFigure(props: PanelFigureProps, adapter: Adapter): Figure {
  switch (props.page) {
    case 'settings':
      return { page: { kind: 'settings' }, caption: props.caption };
    case 'machines':
      return { page: { kind: 'machines' }, caption: props.caption, scene: scenes[adapter] };
    case 'machine':
      return {
        page: {
          kind: 'machine',
          machineId: demos[props.demo][adapter],
          preview: { leaves: [props[`${adapter}Preview` as const]] },
        },
        caption: props[`${adapter}Caption` as const],
        scene: scenes[adapter],
      };
  }
}

const dockTop = 8;

const panelWidth = 280;

const panelInset = 16;

const dockWidth = panelWidth + 2 * panelInset;

export function PanelFigure(props: PanelFigureProps) {
  const [adapter] = useAdapter();
  const inline = useInlineSwitch();
  const { page, caption, scene } = toFigure(props, adapter);
  const height = props.height ?? 400;

  return (
    <figure className="my-6">
      {scene && inline && (
        <div className="mb-2 flex justify-end">
          <AdapterSwitch />
        </div>
      )}
      <div className="relative overflow-hidden rounded-2xl bg-card shadow-edge" style={{ height }}>
        <OverlayDock
          inert
          className="absolute left-1/2 h-[800px] -translate-x-1/2"
          style={{ top: dockTop, width: dockWidth }}
          overlay={(dock) => (
            <KotickFigure
              key={`${scene ? adapter : ''} ${JSON.stringify(page)}`}
              {...scene}
              page={page}
              position="top-left"
              portalTarget={dock}
            />
          )}
        />
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}
