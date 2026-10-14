'use client';

import { PreferencesContext } from '@/machines/preferences';

const DIGESTS = [
  { value: 'daily', label: 'Daily', event: { type: 'DAILY' } },
  { value: 'weekly', label: 'Weekly', event: { type: 'WEEKLY' } },
  { value: 'off', label: 'Off', event: { type: 'OFF' } },
] as const;

function ThemeSwitch() {
  const dark = PreferencesContext.useSelector((snapshot) => snapshot.matches({ theme: 'dark' }));
  const actorRef = PreferencesContext.useActorRef();
  return (
    <div className="row">
      <span>Theme: {dark ? 'Dark' : 'Light'}</span>
      <button type="button" onClick={() => actorRef.send({ type: 'TOGGLE_THEME' })}>
        Switch theme
      </button>
    </div>
  );
}

function DigestPicker() {
  const digest = PreferencesContext.useSelector((snapshot) => snapshot.value.digest);
  const actorRef = PreferencesContext.useActorRef();
  return (
    <fieldset>
      <legend>Email digest</legend>
      {DIGESTS.map(({ value, label, event }) => (
        <label key={value} className="option">
          <input type="radio" name="digest" checked={digest === value} onChange={() => actorRef.send(event)} />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

export function Preferences() {
  return (
    <PreferencesContext.Provider>
      <div className="card stack">
        <ThemeSwitch />
        <DigestPicker />
      </div>
    </PreferencesContext.Provider>
  );
}
