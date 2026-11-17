'use client';

import { useState } from 'react';
import type { FixtureSet } from 'konat';
import { type FigurePage, KonatFigure } from 'konat/figure';
import { checkoutMachine, fixturesInEveryBuild } from '@/demo/checkout';
import { onboardingFixtures, onboardingMachine } from '@/demo/onboarding';

type PanelFigureProps = { caption: string; height?: number } & (
  | { page: 'machines' | 'settings' }
  | { page: 'machine'; machine: string; preview?: string }
);

const machines = [checkoutMachine, onboardingMachine];

/** No fixture and no recording, so the machine page shows all three marks: R, F and –. */
const unvisited = new Set(['shipping.express', 'shipping.pickup']);

const fixtures: FixtureSet[] = [
  ...fixturesInEveryBuild.map((set) => ({
    ...set,
    states: Object.fromEntries(Object.entries(set.states).filter(([leaf]) => !unvisited.has(leaf))),
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

/**
 * The real panel of the demo machines, open on one page. Nothing in it reacts to the pointer, focus or keys.
 * The panel is hidden from assistive technology, so the caption is the text that describes it.
 */
export function PanelFigure(props: PanelFigureProps) {
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const page = toPage(props);

  return (
    <figure className="mb-6">
      {/*
       * The height is fixed, because the maximum height of the panel comes from the height of the dock.
       * With contain: layout, the dock is the containing block of the fixed-position host, so the overlay stays in it.
       */}
      <div ref={setDock} inert className="relative rounded-2xl shadow-code [contain:layout]" style={{ height: props.height ?? 480 }}>
        {dock && <KonatFigure key={JSON.stringify(page)} machines={machines} fixtures={fixtures} page={page} portalTarget={dock} />}
      </div>
      <figcaption className="mt-3 text-center text-[13px] text-muted-foreground">{props.caption}</figcaption>
    </figure>
  );
}
