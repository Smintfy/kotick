import v8 from 'node:v8';
import vm from 'node:vm';

v8.setFlagsFromString('--expose-gc');

// V8 gives gc() only to a context that it makes after the flag is set. The context of the page is older.
const collector = vm.createContext();

function collectGarbage(): void {
  vm.runInContext('gc()', collector);
}

/**
 * Hold each target only in a WeakRef, and never call deref() before this.
 * A WeakRef keeps the target it gave back alive until the task ends.
 */
export async function collected(refs: WeakRef<object>[]): Promise<boolean[]> {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    collectGarbage();
  }

  return refs.map((ref) => ref.deref() === undefined);
}
