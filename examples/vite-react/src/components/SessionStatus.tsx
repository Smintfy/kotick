import { useSelector } from 'shiru/xstate';
import { useRenderStats } from '@/lib/renderStats.ts';
import { sessionActor } from '@/machines/session.ts';

const signIn = () => sessionActor.send({ type: 'SIGN_IN' });
const signOut = () => sessionActor.send({ type: 'SIGN_OUT' });

export function SessionStatus() {
  const status = useSelector(sessionActor, (snapshot) => snapshot.value);
  const user = useSelector(sessionActor, (snapshot) => snapshot.context.user);
  const stats = useRenderStats('session');

  return (
    <div className="session" aria-label="Session">
      <p className="pattern">
        <code>connect()</code> · read with <code>useSelector</code>
      </p>
      <div className="row">
        {status === 'signedIn' && (
          <>
            <span>
              Signed in as <strong>{user?.name}</strong>
            </span>
            <button type="button" onClick={signOut}>
              Sign out
            </button>
          </>
        )}
        {status === 'signingIn' && <span role="status">Signing in…</span>}
        {status === 'signedOut' && (
          <button type="button" onClick={signIn}>
            Sign in
          </button>
        )}
        {status === 'expired' && (
          <>
            <span role="alert">Session expired</span>
            <button type="button" onClick={signIn}>
              Sign in again
            </button>
          </>
        )}
      </div>
      <small ref={stats} className="stats" />
    </div>
  );
}
