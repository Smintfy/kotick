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

/** The top of the dock in the frame. The bubble is in the top-left corner of the dock, and the panel is below it. */
const dockTop = 8;

/** The panel is 280px wide, and the overlay puts it 16px from each side of the dock. */
const dockWidth = 312;

/** The panel fades out over this distance above the bottom of the frame, so a cut panel does not end at a hard edge. */
const fade = 40;

/**
 * A close-up of the real panel of the demo machines, open on one page. Nothing in it reacts to the pointer, focus or keys.
 * The panel is hidden from assistive technology, so the caption is the text that describes it.
 */
export function PanelFigure(props: PanelFigureProps) {
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const page = toPage(props);
  const height = props.height ?? 400;
  const visible = height - dockTop;

  return (
    <figure className="mb-6">
      <div className="relative overflow-hidden rounded-2xl bg-background shadow-code" style={{ height }}>
        {/*
         * The dock is taller than the frame, so the maximum height of the panel does not come from the frame.
         * A tall panel goes past the bottom of the frame, and the frame cuts it.
         * With contain: layout, the dock is the containing block of the fixed-position host, so the overlay stays in it.
         */}
        <div
          ref={setDock}
          inert
          className="absolute left-1/2 h-[800px] -translate-x-1/2 [contain:layout]"
          style={{
            top: dockTop,
            width: dockWidth,
            maskImage: `linear-gradient(to bottom, black ${visible - fade}px, transparent ${visible}px)`,
          }}
        >
          {dock && (
            <KonatFigure
              key={JSON.stringify(page)}
              machines={machines}
              fixtures={fixtures}
              page={page}
              position="top-left"
              portalTarget={dock}
            />
          )}
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted-foreground">{props.caption}</figcaption>
    </figure>
  );
}
