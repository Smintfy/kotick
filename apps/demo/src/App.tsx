import { StateViewer } from 'state-viewer';
import { useMachine } from 'state-viewer/xstate';
import { toggleMachine } from './toggleMachine.ts';

export function App() {
  const [snapshot, send] = useMachine(toggleMachine);

  return (
    <main>
      <h1>state-viewer demo</h1>
      <p>
        Toggle is <strong data-testid="toggle-state">{String(snapshot.value)}</strong>
      </p>
      <button type="button" onClick={() => send({ type: 'TOGGLE' })}>
        Toggle
      </button>
      <StateViewer />
    </main>
  );
}
