import { Kotick } from 'kotick';
import { useMachineReducer } from 'kotick/reducer';
import { useMachine } from 'kotick/xstate';
import { downloadMachine } from '@/download.ts';
import { playerMachine } from '@/player.ts';

const controls = [
  { label: 'Play', event: { type: 'PLAY' } },
  { label: 'Pause', event: { type: 'PAUSE' } },
  { label: 'Fast', event: { type: 'FAST' } },
  { label: 'Normal speed', event: { type: 'NORMAL' } },
  { label: 'Stop', event: { type: 'STOP' } },
] as const;

const downloadControls = [
  { label: 'Download', event: { type: 'START' } },
  { label: 'Cancel', event: { type: 'CANCEL' } },
  { label: 'Reset', event: { type: 'RESET' } },
] as const;

function Download() {
  const [state, dispatch] = useMachineReducer(downloadMachine, { status: 'idle' });

  return (
    <section aria-label="Download">
      <p>
        Download: <code>{state.status === 'downloading' ? `${state.progress}%` : state.status}</code>
      </p>
      <div>
        {downloadControls.map(({ label, event }) => (
          // The reducer returns the same state for an event that the state ignores.
          <button key={label} type="button" disabled={downloadMachine.reducer(state, event) === state} onClick={() => dispatch(event)}>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

export function App() {
  const [snapshot, send] = useMachine(playerMachine);

  return (
    <>
      <section aria-label="Player">
        <p>
          The global styles on this page try to change the overlay. Open the panel with the bubble or Alt+S (⌥S on macOS), and
          compare it with the panel in the vite-react example. The two panels must look the same.
        </p>
        <p>
          The player is an XState machine, and the download is a reducer machine. The download has no fixtures, so the
          panel greys out each of its states that the page did not go to.
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

      <Download />

      <Kotick />
    </>
  );
}
