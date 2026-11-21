type Point = readonly [x: number, y: number];

const head = 7;

function Arrow({ from, to }: { from: Point; to: Point }) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  const baseX = x2 - ux * head;
  const baseY = y2 - uy * head;
  const half = head / 2;

  return (
    <g>
      <line x1={x1} y1={y1} x2={baseX} y2={baseY} stroke="var(--muted-foreground)" strokeWidth={1.25} />
      <polygon
        points={`${x2},${y2} ${baseX - uy * half},${baseY + ux * half} ${baseX + uy * half},${baseY - ux * half}`}
        fill="var(--muted-foreground)"
      />
    </g>
  );
}

type Box = { label: string; x: number; y: number; width: number };

const boxHeight = 40;

function Node({ label, x, y, width }: Box) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={boxHeight} rx={8} fill="var(--background)" stroke="var(--input)" />
      <text
        x={x + width / 2}
        y={y + boxHeight / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--foreground)"
        className="font-mono text-[0.8rem]"
      >
        {label}
      </text>
    </g>
  );
}

function EdgeLabel({ x, y, anchor = 'middle', children }: { x: number; y: number; anchor?: 'start' | 'middle' | 'end'; children: string }) {
  return (
    <text x={x} y={y} textAnchor={anchor} dominantBaseline="central" fill="var(--muted-foreground)" className="font-mono text-[12px]">
      {children}
    </text>
  );
}

const top = 32;
const bottom = 172;
const component: Box = { label: 'component', x: 16, y: top, width: 120 };
const proxy: Box = { label: 'proxy', x: 272, y: top, width: 112 };
const actor: Box = { label: 'real actor', x: 504, y: top, width: 120 };
const registry: Box = { label: 'registry', x: 272, y: bottom, width: 112 };
const overlay: Box = { label: 'overlay', x: 504, y: bottom, width: 120 };

const topMid = top + boxHeight / 2;
const bottomMid = bottom + boxHeight / 2;
const proxyCenter = proxy.x + proxy.width / 2;
const downX = proxyCenter - 14;
const upX = proxyCenter + 14;
const middleY = (top + boxHeight + bottom) / 2;

export function ArchitectureDiagram({ caption }: { caption: string }) {
  return (
    <figure className="my-6">
      <div className="overflow-x-auto rounded-2xl bg-card px-4 py-10 shadow-edge">
        <svg viewBox="0 20 640 200" className="mx-auto block w-full min-w-[440px] max-w-[560px]" aria-hidden>
          <Node {...component} />
          <Node {...proxy} />
          <Node {...actor} />
          <Node {...registry} />
          <Node {...overlay} />

          <Arrow from={[component.x + component.width, topMid]} to={[proxy.x, topMid]} />
          <EdgeLabel x={(component.x + component.width + proxy.x) / 2} y={topMid - 14}>
            useMachine()
          </EdgeLabel>

          <Arrow from={[proxy.x + proxy.width, topMid]} to={[actor.x, topMid]} />
          <EdgeLabel x={(proxy.x + proxy.width + actor.x) / 2} y={topMid - 14}>
            calls
          </EdgeLabel>

          <Arrow from={[downX, top + boxHeight]} to={[downX, bottom]} />
          <EdgeLabel x={downX - 10} y={middleY} anchor="end">
            register
          </EdgeLabel>

          <Arrow from={[upX, bottom]} to={[upX, top + boxHeight]} />
          <EdgeLabel x={upX + 10} y={middleY} anchor="start">
            preview: leaves + context
          </EdgeLabel>

          <Arrow from={[overlay.x, bottomMid]} to={[registry.x + registry.width, bottomMid]} />
          <EdgeLabel x={(registry.x + registry.width + overlay.x) / 2} y={bottomMid - 14}>
            select
          </EdgeLabel>
        </svg>
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}
