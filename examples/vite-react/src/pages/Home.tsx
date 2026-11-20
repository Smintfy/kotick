import { Link } from 'react-router';
import { examples } from '@/examples.ts';

export function Home() {
  return (
    <>
      <header className="page-header">
        <h1>Examples</h1>
        <p className="muted">
          Each page reads its machine a different way. Open the panel with the bubble or <kbd>Alt</kbd>+<kbd>S</kbd> (<kbd>⌥S</kbd> on macOS){' '}
          to preview any state. The counters show mounts and committed renders; a preview should never add a mount.
        </p>
        <p className="muted">
          The session in the header is a module-level actor wired with <code>connect()</code>, so it's on every page.
        </p>
      </header>

      <ul className="examples">
        {Object.values(examples).map((example) => (
          <li key={example.path}>
            <Link to={example.path} className="card">
              <strong>{example.title}</strong>
              <code className="pattern">{example.api}</code>
              <span className="muted">{example.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
