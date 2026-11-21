'use client';

import { useMachine } from 'shiru/xstate';
import { signupMachine } from '@/machines/signup';

export function SignupForm() {
  const [snapshot, send] = useMachine(signupMachine);
  const { email, error } = snapshot.context;

  if (snapshot.matches('subscribed')) {
    return (
      <div className="card stack" role="status">
        <p>
          You are on the list. We sent a confirmation to <strong>{email}</strong>.
        </p>
        <div className="actions">
          <button type="button" onClick={() => send({ type: 'RESET' })}>
            Sign up another address
          </button>
        </div>
      </div>
    );
  }

  const busy = snapshot.hasTag('busy');

  return (
    <form
      className="card stack"
      onSubmit={(event) => {
        event.preventDefault();
        send({ type: 'SUBMIT' });
      }}
    >
      <label className="field">
        Email
        <input
          type="email"
          value={email}
          disabled={busy}
          onChange={(event) => send({ type: 'EDIT', email: event.target.value })}
        />
      </label>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" disabled={busy || !snapshot.can({ type: 'SUBMIT' })}>
          {busy ? 'Subscribing…' : 'Subscribe'}
        </button>
      </div>
    </form>
  );
}
