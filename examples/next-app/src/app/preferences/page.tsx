import { Preferences } from '@/components/preferences';

export default function PreferencesPage() {
  return (
    <>
      <header className="page-header">
        <h1>Preferences</h1>
        <p className="muted">
          A parallel machine in a <code>createActorContext</code> provider. The components read it with{' '}
          <code>useSelector</code>.
        </p>
      </header>
      <Preferences />
    </>
  );
}
