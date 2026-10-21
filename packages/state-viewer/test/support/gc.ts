// Tells whether the page lets go of an object, such as a finished actor that an app subscribed to and forgot.

import v8 from 'node:v8';
import vm from 'node:vm';

v8.setFlagsFromString('--expose-gc');

const collectGarbage = vm.runInNewContext('gc') as () => void;

/**
 * Runs three rounds of one real tick and a full collection, then tells which targets are gone.
 * Hold each target only in a WeakRef, and never call deref() before this: a WeakRef keeps the target it gave back
 * alive until the task ends.
 */
export async function collected(refs: WeakRef<object>[]): Promise<boolean[]> {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    collectGarbage();
  }

  return refs.map((ref) => ref.deref() === undefined);
}
