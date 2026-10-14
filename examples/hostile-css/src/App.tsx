import { StateViewer } from 'state-viewer';
import { useMachine } from 'state-viewer/xstate';
import { playerMachine } from '@/player.ts';

const controls = [
  { label: 'Play', event: { type: 'PLAY' } },
  { label: 'Pause', event: { type: 'PAUSE' } },
  { label: 'Fast', event: { type: 'FAST' } },
  { label: 'Normal speed', event: { type: 'NORMAL' } },
  { label: 'Stop', event: { type: 'STOP' } },
] as const;

export function App() {
  const [snapshot, send] = useMachine(playerMachine);

  return (
    <>
      <section aria-label="Player">
        <p>
          The global styles on this page try to change the overlay. Open the panel with the bubble or Alt+S, and
          compare it with the panel in the vite-react example. The two panels must look the same.
        </p>
        <p>
          Track: <code>{snapshot.context.track}</code> · State: <code>{JSON.stringify(snapshot.value)}</code>
        </p>
        <div>
          {controls.map(({ label, event }) => (
            <button key={label} type="button" disabled={!snapshot.can(event)} onClick={() => send(event)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <StateViewer />
    </>
  );
}
