import { toggleReducerMachine } from '../../../src/reducer-machine';

export function GET() {
  return Response.json(toggleReducerMachine.reducer({ status: 'on', count: 1 }, { type: 'TOGGLE' }));
}
