import { Demo } from '../src/demo';
import { ReducerDemo } from '../src/reducer-demo';
import { toggleReducerMachine } from '../src/reducer-machine';

// A server component can import a machine file and run its reducer. Only the hook is client code.
export default function Page() {
  const next = toggleReducerMachine.reducer({ status: 'off', count: 0 }, { type: 'TOGGLE' });
  const states = Object.keys(toggleReducerMachine.states).join(',');

  return (
    <>
      <Demo />
      <ReducerDemo />
      <p id="reducer-server">{`${toggleReducerMachine.id} ${states} ${next.status} ${next.count}`}</p>
    </>
  );
}
