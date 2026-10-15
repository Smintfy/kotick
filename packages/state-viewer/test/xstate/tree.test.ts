import { describe, expect, test } from 'vitest';
import { createActor, createMachine, fromPromise, setup, type StateValue } from 'xstate';
import { normalizeLeaves, resolveSnapshot } from '../../src/xstate/preview-snapshot';
import { isMachine, leavesOfSnapshot, leavesOfValue } from '../../src/xstate/tree';

/** A compound root with descriptions, tags, a final state and history nodes at two depths. */
function createCheckout() {
  return setup({}).createMachine({
    id: 'checkout',
    initial: 'cart',
    states: {
      cart: {
        description: 'Items waiting to be paid for',
        tags: ['editable'],
        on: { CHECKOUT: 'payment' },
      },
      payment: {
        initial: 'idle',
        tags: 'busy',
        states: {
          idle: { description: '' },
          error: { description: 'The card was declined', tags: ['error', 'retryable'] },
          previous: { type: 'history' },
        },
      },
      shipping: {
        type: 'parallel',
        description: 'Speed and wrapping are chosen independently',
        states: {
          speed: {
            initial: 'standard',
            states: {
              standard: {},
              express: {},
              remembered: { type: 'history', history: 'deep' },
            },
          },
          gift: { tags: [] },
        },
      },
      done: { type: 'final' },
      resume: { type: 'history' },
    },
  });
}

/**
 * A parallel root. `document` is a compound region holding a nested parallel state, `saving`, whose `progress`
 * region starts somewhere other than its first child and whose `spinner` region is atomic.
 */
function createEditor() {
  return createMachine({
    id: 'editor',
    type: 'parallel',
    states: {
      document: {
        initial: 'clean',
        states: {
          clean: {},
          dirty: {},
          saving: {
            type: 'parallel',
            states: {
              upload: { initial: 'pending', states: { failed: {}, pending: {} } },
              progress: { initial: 'zero', states: { full: {}, zero: {} } },
              spinner: {},
            },
          },
        },
      },
      sidebar: { initial: 'closed', states: { closed: {}, open: {} } },
      theme: { initial: 'light', states: { light: {}, dark: {} } },
    },
  });
}

/** A parallel state whose regions are atomic, so they appear as `{}` in the state value. */
function createToolbar() {
  return createMachine({
    id: 'toolbar',
    initial: 'hidden',
    states: {
      hidden: {},
      visible: { type: 'parallel', states: { bold: {}, italic: {} } },
    },
  });
}

function createPayment() {
  return setup({
    types: {
      context: {} as { attempts: number },
      events: {} as { type: 'PAY' } | { type: 'RETRY' } | { type: 'CANCEL' },
    },
    guards: { canRetry: ({ context }) => context.attempts < 3 },
  }).createMachine({
    id: 'payment',
    initial: 'idle',
    context: { attempts: 0 },
    states: {
      idle: { on: { PAY: 'processing' } },
      processing: {
        tags: ['busy'],
        initial: 'authorizing',
        on: { CANCEL: 'idle' },
        states: { authorizing: { tags: ['spinner'] }, capturing: {} },
      },
      error: { tags: ['error'], on: { RETRY: { guard: 'canRetry', target: 'processing' } } },
      review: { initial: 'open', states: { open: {}, closed: { type: 'final' } } },
      paid: { type: 'final' },
    },
  });
}

/** Requested leaves first, in order; the filled-in leaves after them in no particular order. */
function expectNormalized(actual: string[], requested: string[], filled: string[]): void {
  expect(actual.slice(0, requested.length)).toEqual(requested);
  expect([...actual.slice(requested.length)].sort()).toEqual([...filled].sort());
}

describe('isMachine', () => {
  test('accepts state machines and rejects other logic and values', () => {
    const machine = createCheckout();

    expect(isMachine(machine)).toBe(true);
    expect(isMachine(createActor(machine))).toBe(false);
    expect(isMachine(fromPromise(async () => 1))).toBe(false);
    expect(isMachine({ resolveState: () => ({}) })).toBe(false);
    expect(isMachine(null)).toBe(false);
    expect(isMachine(undefined)).toBe(false);
    expect(isMachine('machine')).toBe(false);
  });
});

describe('leavesOfValue', () => {
  test('reads a string value at the root', () => {
    expect(leavesOfValue(createCheckout(), 'cart')).toEqual(['cart']);
    expect(leavesOfValue(createCheckout(), 'done')).toEqual(['done']);
  });

  test('reads nested compound values', () => {
    const machine = createMachine({
      initial: 'a',
      states: { a: { initial: 'b', states: { b: { initial: 'c', states: { c: {} } } } } },
    });

    expect(leavesOfValue(createCheckout(), { payment: 'error' })).toEqual(['payment.error']);
    expect(leavesOfValue(machine, { a: { b: 'c' } })).toEqual(['a.b.c']);
  });

  test('reads every region of a parallel value', () => {
    expect(leavesOfValue(createCheckout(), { shipping: { speed: 'express', gift: {} } })).toEqual([
      'shipping.speed.express',
      'shipping.gift',
    ]);
    expect(leavesOfValue(createEditor(), { document: 'dirty', sidebar: 'open', theme: 'light' })).toEqual([
      'document.dirty',
      'sidebar.open',
      'theme.light',
    ]);
  });

  test('reads a parallel state whose regions are atomic, written as {}', () => {
    const flags = createMachine({ id: 'flags', type: 'parallel', states: { muted: {}, pinned: {} } });

    expect(leavesOfValue(createToolbar(), { visible: { bold: {}, italic: {} } })).toEqual([
      'visible.bold',
      'visible.italic',
    ]);
    expect(createActor(flags).getSnapshot().value).toEqual({ muted: {}, pinned: {} });
    expect(leavesOfValue(flags, { muted: {}, pinned: {} })).toEqual(['muted', 'pinned']);
  });

  test('reads an atomic state written as {} under a compound parent', () => {
    expect(leavesOfValue(createCheckout(), { payment: { error: {} } })).toEqual(['payment.error']);
    // A compound state written as {} names no leaf.
    expect(leavesOfValue(createCheckout(), { payment: {} })).toEqual([]);
  });

  test('reads a parallel state nested in a compound region of a parallel root', () => {
    const value: StateValue = {
      document: { saving: { upload: 'failed', progress: 'zero', spinner: {} } },
      sidebar: 'closed',
      theme: 'dark',
    };

    expect(leavesOfValue(createEditor(), value)).toEqual([
      'document.saving.upload.failed',
      'document.saving.progress.zero',
      'document.saving.spinner',
      'sidebar.closed',
      'theme.dark',
    ]);
  });

  test('follows the order of the keys in the value', () => {
    expect(leavesOfValue(createEditor(), { theme: 'dark', document: 'clean', sidebar: 'open' })).toEqual([
      'theme.dark',
      'document.clean',
      'sidebar.open',
    ]);
  });

  test('reads values from real snapshots', () => {
    const toolbar = createToolbar();
    const editor = createEditor();

    expect(leavesOfValue(toolbar, toolbar.resolveState({ value: 'visible', context: {} }).value)).toEqual([
      'visible.bold',
      'visible.italic',
    ]);
    expect(leavesOfValue(editor, createActor(editor).getSnapshot().value)).toEqual([
      'document.clean',
      'sidebar.closed',
      'theme.light',
    ]);
  });

  test('ignores keys that are not states of the machine', () => {
    const machine = createCheckout();

    expect(leavesOfValue(machine, 'nowhere')).toEqual([]);
    expect(leavesOfValue(machine, { nowhere: 'error', payment: 'error' })).toEqual(['payment.error']);
    expect(leavesOfValue(machine, { payment: 'nowhere' })).toEqual([]);
    expect(leavesOfValue(machine, { shipping: { speed: 'teleport', gift: {} } })).toEqual(['shipping.gift']);
    // History nodes are states of the machine but never part of a configuration.
    expect(leavesOfValue(machine, { payment: { previous: {} } })).toEqual([]);
    expect(leavesOfValue(machine, 'resume')).toEqual([]);
  });

  test('does not resolve prototype keys such as constructor', () => {
    const machine = createCheckout();

    expect(leavesOfValue(machine, 'constructor')).toEqual([]);
    expect(leavesOfValue(machine, 'toString')).toEqual([]);
    expect(leavesOfValue(machine, 'hasOwnProperty')).toEqual([]);
    expect(leavesOfValue(machine, { constructor: {} })).toEqual([]);
    expect(leavesOfValue(machine, { payment: 'constructor' })).toEqual([]);
    expect(leavesOfValue(machine, JSON.parse('{"__proto__": {}, "cart": {}}') as StateValue)).toEqual(['cart']);
  });

  test('returns nothing for a missing value or the value of a machine without states', () => {
    expect(leavesOfValue(createCheckout(), undefined)).toEqual([]);
    expect(leavesOfValue(createCheckout(), null as unknown as StateValue)).toEqual([]);

    const empty = createMachine({ id: 'empty' });
    expect(leavesOfValue(empty, createActor(empty).getSnapshot().value)).toEqual([]);
  });
});

describe('leavesOfSnapshot', () => {
  test('reads the configuration of a running actor as it changes', () => {
    const machine = createCheckout();
    const actor = createActor(machine).start();

    expect(leavesOfSnapshot(machine, actor.getSnapshot())).toEqual(['cart']);
    actor.send({ type: 'CHECKOUT' });
    expect(leavesOfSnapshot(machine, actor.getSnapshot())).toEqual(['payment.idle']);
    actor.stop();
  });

  test('returns nothing for an error snapshot without a value', () => {
    const machine = createCheckout();
    // The actor can't restore a state the machine doesn't have, so it stores an error snapshot with no value.
    const persisted = { status: 'active', value: 'nowhere', context: {}, children: {} };
    const snapshot = createActor(machine, { snapshot: persisted as never }).getSnapshot();

    expect(snapshot.status).toBe('error');
    expect('value' in snapshot).toBe(false);
    expect(leavesOfSnapshot(machine, snapshot)).toEqual([]);
  });

  test('reads the value an error snapshot keeps', () => {
    const machine = setup({ types: { context: {} as { ready: boolean } } }).createMachine({
      id: 'broken',
      context: () => {
        throw new Error('no context');
      },
      initial: 'idle',
      states: { idle: {} },
    });
    const snapshot = createActor(machine).getSnapshot();

    expect(snapshot.status).toBe('error');
    // XState 5.28, the minimum supported version, gives this snapshot no value. Later versions keep the initial one.
    if (snapshot.value === undefined) {
      expect(leavesOfSnapshot(machine, snapshot)).toEqual([]);
      return;
    }
    expect(snapshot.value).toBe('idle');
    expect(leavesOfSnapshot(machine, snapshot)).toEqual(['idle']);
  });

  test('returns nothing for values that are not snapshots', () => {
    const machine = createCheckout();

    expect(leavesOfSnapshot(machine, undefined)).toEqual([]);
    expect(leavesOfSnapshot(machine, null)).toEqual([]);
    expect(leavesOfSnapshot(machine, 'cart')).toEqual([]);
    expect(leavesOfSnapshot(machine, { status: 'error', error: new Error('x') })).toEqual([]);
  });
});

describe('normalizeLeaves', () => {
  const current = ['document.dirty', 'sidebar.open', 'theme.dark'];

  test('keeps the requested leaves first, in the order they were asked for', () => {
    const result = normalizeLeaves(createEditor(), ['theme.light', 'sidebar.closed'], current);

    expectNormalized(result, ['theme.light', 'sidebar.closed'], ['document.dirty']);
  });

  test('drops a requested leaf that conflicts with an earlier one in the same region', () => {
    const editor = createEditor();

    expectNormalized(
      normalizeLeaves(editor, ['sidebar.closed', 'sidebar.open', 'theme.light'], current),
      ['sidebar.closed', 'theme.light'],
      ['document.dirty'],
    );
    // A leaf inside `document.saving` conflicts with `document.clean`: `document` is compound.
    expectNormalized(
      normalizeLeaves(editor, ['document.clean', 'document.saving.spinner'], current),
      ['document.clean'],
      ['sidebar.open', 'theme.dark'],
    );
    expectNormalized(normalizeLeaves(editor, ['theme.light', 'theme.light'], current), ['theme.light'], [
      'document.dirty',
      'sidebar.open',
    ]);
  });

  test('fills the regions the request leaves alone with their current leaves', () => {
    expectNormalized(normalizeLeaves(createEditor(), ['theme.light'], current), ['theme.light'], [
      'document.dirty',
      'sidebar.open',
    ]);
  });

  test('keeps current leaves of sibling regions inside a nested parallel state', () => {
    const inSaving = [
      'document.saving.upload.pending',
      'document.saving.progress.full',
      'document.saving.spinner',
      'sidebar.open',
      'theme.dark',
    ];

    expectNormalized(
      normalizeLeaves(createEditor(), ['document.saving.upload.failed'], inSaving),
      ['document.saving.upload.failed'],
      ['document.saving.progress.full', 'document.saving.spinner', 'sidebar.open', 'theme.dark'],
    );
  });

  test('drops current leaves that conflict with the request', () => {
    const inSaving = ['document.saving.upload.pending', 'document.saving.progress.full', 'document.saving.spinner'];

    expectNormalized(
      normalizeLeaves(createEditor(), ['document.clean'], [...inSaving, 'sidebar.open', 'theme.dark']),
      ['document.clean'],
      ['sidebar.open', 'theme.dark'],
    );
    expect(normalizeLeaves(createCheckout(), ['payment.error'], ['cart'])).toEqual(['payment.error']);
  });

  test('enters regions neither the request nor the current state covers at their initial leaves', () => {
    // The actor isn't in `document.saving`, so its other regions start where XState would enter them: `progress`
    // starts at `zero`, which isn't its first child.
    expectNormalized(
      normalizeLeaves(createEditor(), ['document.saving.upload.failed'], current),
      ['document.saving.upload.failed'],
      ['document.saving.progress.zero', 'document.saving.spinner', 'sidebar.open', 'theme.dark'],
    );
  });

  test('enters every untouched region at its initial leaf when there is no current state', () => {
    expectNormalized(normalizeLeaves(createEditor(), ['theme.dark'], []), ['theme.dark'], [
      'document.clean',
      'sidebar.closed',
    ]);
    expectNormalized(
      normalizeLeaves(createCheckout(), ['shipping.speed.express'], ['cart']),
      ['shipping.speed.express'],
      ['shipping.gift'],
    );
  });

  test('fills the atomic regions of a parallel state the actor is not in', () => {
    expectNormalized(normalizeLeaves(createToolbar(), ['visible.italic'], ['hidden']), ['visible.italic'], [
      'visible.bold',
    ]);
  });

  test('ignores unknown leaves, non-leaf nodes and history nodes in the request and in the current state', () => {
    expectNormalized(
      normalizeLeaves(createEditor(), ['nowhere', 'document', 'theme.light'], ['sidebar.open', 'sidebar.lost']),
      ['theme.light'],
      ['document.clean', 'sidebar.open'],
    );
    expect(normalizeLeaves(createCheckout(), ['payment.previous', 'resume', 'payment.error'], [])).toEqual([
      'payment.error',
    ]);
  });

  test('returns nothing when no requested leaf is valid', () => {
    expect(normalizeLeaves(createEditor(), [], current)).toEqual([]);
    expect(normalizeLeaves(createEditor(), ['nowhere', 'document', 'constructor'], current)).toEqual([]);
  });

  test('returns a configuration resolveSnapshot accepts unchanged', () => {
    const editor = createEditor();
    const leaves = normalizeLeaves(editor, ['document.saving.progress.full'], current);
    const snapshot = resolveSnapshot(editor, leaves, {});

    expect([...leavesOfSnapshot(editor, snapshot)].sort()).toEqual([...leaves].sort());
  });
});

describe('resolveSnapshot', () => {
  test('makes a snapshot whose matches and hasTag see the given leaves and their ancestors', () => {
    const snapshot = resolveSnapshot(createPayment(), ['processing.authorizing'], { attempts: 0 });

    expect(snapshot.value).toEqual({ processing: 'authorizing' });
    expect(snapshot.matches('processing')).toBe(true);
    expect(snapshot.matches({ processing: 'authorizing' })).toBe(true);
    expect(snapshot.matches({ processing: 'capturing' })).toBe(false);
    expect(snapshot.matches('idle')).toBe(false);
    expect(snapshot.hasTag('busy')).toBe(true);
    expect(snapshot.hasTag('spinner')).toBe(true);
    expect(snapshot.hasTag('error')).toBe(false);
  });

  test('evaluates can() and its guards against the given context', () => {
    const machine = createPayment();
    const retryable = resolveSnapshot(machine, ['error'], { attempts: 1 });
    const exhausted = resolveSnapshot(machine, ['error'], { attempts: 3 });

    expect(retryable.can({ type: 'RETRY' })).toBe(true);
    expect(retryable.can({ type: 'PAY' })).toBe(false);
    expect(exhausted.can({ type: 'RETRY' })).toBe(false);
    expect(resolveSnapshot(machine, ['processing.capturing'], { attempts: 0 }).can({ type: 'CANCEL' })).toBe(true);
  });

  test('uses the context it is given, as the same object', () => {
    const context = { attempts: 2 };

    expect(resolveSnapshot(createPayment(), ['error'], context).context).toBe(context);
  });

  test('reports status done for a top-level final state only', () => {
    const machine = createPayment();

    expect(resolveSnapshot(machine, ['paid'], { attempts: 0 }).status).toBe('done');
    expect(resolveSnapshot(machine, ['review.closed'], { attempts: 0 }).status).toBe('active');
    expect(resolveSnapshot(machine, ['idle'], { attempts: 0 }).status).toBe('active');
  });

  test('reports status done when every region of a parallel root is final', () => {
    const machine = createMachine({
      id: 'upload',
      type: 'parallel',
      states: {
        file: { initial: 'sending', states: { sending: {}, sent: { type: 'final' } } },
        thumbnail: { initial: 'sending', states: { sending: {}, sent: { type: 'final' } } },
      },
    });

    expect(resolveSnapshot(machine, ['file.sent', 'thumbnail.sent'], {}).status).toBe('done');
    expect(resolveSnapshot(machine, ['file.sent', 'thumbnail.sending'], {}).status).toBe('active');
  });

  test('writes value keys in document order whatever order the leaves come in', () => {
    const editor = createEditor();
    const leaves = [
      'theme.dark',
      'document.saving.spinner',
      'sidebar.open',
      'document.saving.progress.full',
      'document.saving.upload.failed',
    ];
    const snapshot = resolveSnapshot(editor, leaves, {});

    expect(snapshot.value).toEqual({
      document: { saving: { upload: 'failed', progress: 'full', spinner: {} } },
      sidebar: 'open',
      theme: 'dark',
    });
    const value = snapshot.value as Record<string, Record<string, Record<string, unknown>>>;
    expect(Object.keys(value)).toEqual(['document', 'sidebar', 'theme']);
    expect(Object.keys(value.document.saving)).toEqual(['upload', 'progress', 'spinner']);
  });

  test('produces the same value as a snapshot XState made itself', () => {
    const editor = createEditor();
    const initial = createActor(editor).getSnapshot();
    const reversed = [...leavesOfSnapshot(editor, initial)].reverse();

    expect(JSON.stringify(resolveSnapshot(editor, reversed, {}).value)).toBe(JSON.stringify(initial.value));
  });

  test('completes a partial configuration with the initial leaves of the regions it leaves out', () => {
    const editor = createEditor();
    const snapshot = resolveSnapshot(editor, ['document.saving.progress.full'], {});

    expect([...leavesOfSnapshot(editor, snapshot)].sort()).toEqual([
      'document.saving.progress.full',
      'document.saving.spinner',
      'document.saving.upload.pending',
      'sidebar.closed',
      'theme.light',
    ]);
  });

  test('round-trips through leavesOfSnapshot', () => {
    const checkout = createCheckout();
    const toolbar = createToolbar();

    const shipping = resolveSnapshot(checkout, ['shipping.gift', 'shipping.speed.express'], {});
    expect(leavesOfSnapshot(checkout, shipping)).toEqual(['shipping.speed.express', 'shipping.gift']);
    expect(leavesOfSnapshot(toolbar, resolveSnapshot(toolbar, ['visible.italic', 'visible.bold'], {}))).toEqual([
      'visible.bold',
      'visible.italic',
    ]);
    expect(leavesOfSnapshot(checkout, resolveSnapshot(checkout, ['done'], {}))).toEqual(['done']);
  });

  test('throws for leaves that are not leaf states of the machine', () => {
    const machine = createPayment();

    expect(() => resolveSnapshot(machine, ['nowhere'], { attempts: 0 })).toThrow(
      '"nowhere" is not a leaf state of this machine.',
    );
    expect(() => resolveSnapshot(machine, ['processing'], { attempts: 0 })).toThrow(/"processing"/);
    expect(() => resolveSnapshot(machine, ['idle', 'constructor'], { attempts: 0 })).toThrow(/"constructor"/);
    expect(() => resolveSnapshot(createCheckout(), ['payment.previous'], {})).toThrow(/"payment\.previous"/);
  });
});
