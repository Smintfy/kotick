import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { setup } from 'xstate';
import { useMachine } from '../src/xstate';

const toggleMachine = setup({}).createMachine({
  id: 'toggle',
  initial: 'off',
  states: {
    off: { on: { TOGGLE: 'on' } },
    on: { on: { TOGGLE: 'off' } },
  },
});

function Toggle() {
  const [snapshot, send] = useMachine(toggleMachine);
  return (
    <button type="button" onClick={() => send({ type: 'TOGGLE' })}>
      {String(snapshot.value)}
    </button>
  );
}

test('useMachine drives a component', () => {
  render(<Toggle />);
  const button = screen.getByRole('button');
  expect(button.textContent).toBe('off');

  fireEvent.click(button);
  expect(button.textContent).toBe('on');
});
