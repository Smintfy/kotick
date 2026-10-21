const warnedKeys = new Set<string>();
const warnedObjects = new WeakSet<WeakKey>();

/**
 * Logs `message` the first time it gets `key`, so code that StrictMode, Fast Refresh or HMR runs again warns once per
 * page. An object key is held weakly.
 */
export function warnOnce(key: string | WeakKey, message: string): void {
  if (isObjectKey(key)) {
    if (warnedObjects.has(key)) return;
    warnedObjects.add(key);
  } else {
    if (warnedKeys.has(key)) return;
    warnedKeys.add(key);
  }

  console.warn(message);
}

function isObjectKey(key: string | WeakKey): key is WeakKey {
  return typeof key !== 'string';
}
