// Type tests for konat/xstate. Vitest typechecks this file and never runs it, so hooks are called outside
// components and actors are never started.

import * as xstateReact from '@xstate/react';
import type { FixtureSet } from 'konat';
import * as konat from 'konat/xstate';
import { connect, defineFixtures, type DebugOptions, type FixtureStates, type LeafIdFrom } from 'konat/xstate';
import { describe, expectTypeOf, test } from 'vitest';
import {
  createActor,
  createMachine,
  fromPromise,
  setup,
  type Actor,
  type AnyActorRef,
  type AnyStateMachine,
  type SnapshotFrom,
} from 'xstate';

type CheckoutContext = { items: string[]; total: number; error?: string; receiptId?: string };

type CheckoutEvent = { type: 'PAY' } | { type: 'RETRY' } | { type: 'UPDATE_CARD'; cardNumber: string };

// Compound root: nested compound states, a history state and final states at two depths.
const checkoutMachine = setup({
  // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
  types: { context: {} as CheckoutContext, events: {} as CheckoutEvent },
}).createMachine({
  id: 'checkout',
  initial: 'cart',
  context: { items: [], total: 0 },
  states: {
    cart: { on: { PAY: 'payment' } },
    payment: {
      initial: 'editing',
      states: {
        editing: {
          initial: 'incomplete',
          states: { incomplete: {}, complete: {}, last: { type: 'history' } },
        },
        processing: {},
        error: { on: { RETRY: 'processing' } },
        success: { type: 'final' },
      },
    },
    cancelled: { type: 'final' },
  },
});

type CheckoutLeaf =
  | 'cart'
  | 'payment.editing.incomplete'
  | 'payment.editing.complete'
  | 'payment.processing'
  | 'payment.error'
  | 'payment.success'
  | 'cancelled';

const base: CheckoutContext = { items: ['sku_1'], total: 4800 };

type LayoutContext = { width: number };

// Parallel root whose regions are all compound, with a parallel state nested inside one of them.
// SAFETY: XState reads the types of setup() only at compile time. It never reads this value.
const layoutMachine = setup({ types: { context: {} as LayoutContext } }).createMachine({
  id: 'layout',
  type: 'parallel',
  context: { width: 1024 },
  states: {
    sidebar: { initial: 'open', states: { open: {}, closed: {} } },
    content: {
      initial: 'list',
      states: {
        list: {},
        split: {
          type: 'parallel',
          states: {
            left: { initial: 'list', states: { list: {}, empty: {} } },
            right: { initial: 'detail', states: { detail: {}, edit: {} } },
          },
        },
      },
    },
  },
});

type LayoutLeaf =
  | 'sidebar.open'
  | 'sidebar.closed'
  | 'content.list'
  | 'content.split.left.list'
  | 'content.split.left.empty'
  | 'content.split.right.detail'
  | 'content.split.right.edit';

type EditorContext = { text: string };

// Parallel states with atomic regions, which appear as `{}` in the state value: one at the root, one nested.
// SAFETY: XState reads the types of setup() only at compile time. It never reads this value.
const editorMachine = setup({ types: { context: {} as EditorContext } }).createMachine({
  id: 'editor',
  type: 'parallel',
  context: { text: '' },
  states: {
    format: { initial: 'plain', states: { plain: {}, bold: {} } },
    upload: {
      initial: 'idle',
      states: {
        idle: {},
        sending: {
          type: 'parallel',
          states: {
            progress: {},
            cancel: { initial: 'hidden', states: { hidden: {}, shown: {} } },
          },
        },
        sent: { type: 'final' },
      },
    },
    autosave: {},
  },
});

type EditorLeaf =
  | 'format.plain'
  | 'format.bold'
  | 'upload.idle'
  | 'upload.sending.progress'
  | 'upload.sending.cancel.hidden'
  | 'upload.sending.cancel.shown'
  | 'upload.sent'
  | 'autosave';

type ProfileInput = { userId: string };

// A machine whose actors must be given input.
const profileMachine = setup({
  // SAFETY: XState reads the types of setup() only at compile time. It never reads these values.
  types: { input: {} as ProfileInput, context: {} as ProfileInput },
}).createMachine({
  id: 'profile',
  context: ({ input }) => ({ userId: input.userId }),
  initial: 'loading',
  states: { loading: {}, ready: {} },
});

const loadUser = fromPromise(async ({ input }: { input: { id: string } }) => ({ name: input.id }));

// createMachine without `types` types its value as XState's general StateValue.
const untypedMachine = createMachine({
  id: 'untyped',
  initial: 'a',
  states: { a: {}, b: { initial: 'c', states: { c: {} } } },
});

declare const anyMachine: AnyStateMachine;

describe('hooks', () => {
  test('useSelector and shallowEqual are the @xstate/react functions', () => {
    expectTypeOf(konat.useSelector).toEqualTypeOf(xstateReact.useSelector);
    expectTypeOf(konat.shallowEqual).toEqualTypeOf(xstateReact.shallowEqual);
  });

  test('useMachine returns what @xstate/react returns for the same machine', () => {
    expectTypeOf<ReturnType<typeof konat.useMachine<typeof checkoutMachine>>>().toEqualTypeOf<
      ReturnType<typeof xstateReact.useMachine<typeof checkoutMachine>>
    >();
    expectTypeOf(konat.useMachine(layoutMachine)).toEqualTypeOf(xstateReact.useMachine(layoutMachine));
    expectTypeOf(konat.useMachine(profileMachine, { input: { userId: 'u1' } })).toEqualTypeOf(
      xstateReact.useMachine(profileMachine, { input: { userId: 'u1' } }),
    );

    const [snapshot, send, actorRef] = konat.useMachine(checkoutMachine, { debug: { id: 'checkout' } });
    expectTypeOf(snapshot.context).toEqualTypeOf<CheckoutContext>();
    expectTypeOf(send).parameter(0).toEqualTypeOf<CheckoutEvent>();
    expectTypeOf(actorRef).toEqualTypeOf<Actor<typeof checkoutMachine>>();
    expectTypeOf(konat.useSelector(actorRef, (state) => state.context.total)).toEqualTypeOf<number>();
  });

  test('useActor returns what @xstate/react returns for the same logic', () => {
    expectTypeOf<ReturnType<typeof konat.useActor<typeof checkoutMachine>>>().toEqualTypeOf<
      ReturnType<typeof xstateReact.useActor<typeof checkoutMachine>>
    >();
    expectTypeOf(konat.useActor(editorMachine)).toEqualTypeOf(xstateReact.useActor(editorMachine));
    expectTypeOf(konat.useActor(loadUser, { input: { id: 'u1' } })).toEqualTypeOf(
      xstateReact.useActor(loadUser, { input: { id: 'u1' } }),
    );
  });

  test('useActorRef returns what @xstate/react returns for the same logic', () => {
    expectTypeOf<ReturnType<typeof konat.useActorRef<typeof checkoutMachine>>>().toEqualTypeOf<
      ReturnType<typeof xstateReact.useActorRef<typeof checkoutMachine>>
    >();
    expectTypeOf(konat.useActorRef(layoutMachine)).toEqualTypeOf(xstateReact.useActorRef(layoutMachine));
    expectTypeOf(konat.useActorRef(loadUser, { input: { id: 'u1' } })).toEqualTypeOf(
      xstateReact.useActorRef(loadUser, { input: { id: 'u1' } }),
    );
    expectTypeOf(konat.useActorRef(checkoutMachine)).toEqualTypeOf<Actor<typeof checkoutMachine>>();
  });

  test('useActorRef types its observer with the logic snapshot, as @xstate/react does', () => {
    konat.useActorRef(checkoutMachine, { debug: { label: 'Checkout' } }, (snapshot) => {
      expectTypeOf(snapshot).toEqualTypeOf<SnapshotFrom<typeof checkoutMachine>>();
    });
    konat.useActorRef(
      checkoutMachine,
      {},
      {
        next: (snapshot) => expectTypeOf(snapshot.context).toEqualTypeOf<CheckoutContext>(),
      },
    );
  });

  test('createActorContext returns what @xstate/react returns, with debug also allowed in the Provider options', () => {
    const ours = konat.createActorContext(checkoutMachine, { debug: { id: 'checkout' } });
    const theirs = xstateReact.createActorContext(checkoutMachine);

    expectTypeOf(ours.useSelector).toEqualTypeOf(theirs.useSelector);
    expectTypeOf(ours.useActorRef).toEqualTypeOf(theirs.useActorRef);
    expectTypeOf(ours.Provider).returns.toEqualTypeOf<ReturnType<typeof theirs.Provider>>();
    // The Provider's `options` prop is the hooks' options, so it takes `debug` too. Everything XState's Provider
    // accepts is still accepted, and the context can stand in wherever XState's type is expected.
    expectTypeOf<Parameters<typeof theirs.Provider>[0]>().toExtend<Parameters<typeof ours.Provider>[0]>();
    expectTypeOf(ours).toExtend<typeof theirs>();
    expectTypeOf(ours.Provider).toBeCallableWith({
      children: null,
      options: { id: 'checkout-actor', debug: { id: 'checkout', label: 'Checkout', disabled: false } },
    });
    expectTypeOf(ours.Provider).toBeCallableWith({ children: null, logic: checkoutMachine });

    expectTypeOf(ours.useSelector((snapshot) => snapshot.context.total)).toEqualTypeOf<number>();
    expectTypeOf(ours.useActorRef()).toEqualTypeOf<Actor<typeof checkoutMachine>>();
  });

  test('every hook accepts debug options next to XState’s own options', () => {
    const debug = { id: 'checkout', label: 'Checkout', disabled: true };
    konat.useMachine(checkoutMachine, { debug });
    konat.useMachine(checkoutMachine, { id: 'root', systemId: 'checkout', debug: { id: 'checkout' } });
    konat.useActor(checkoutMachine, { debug: { label: 'Checkout' } });
    konat.useActorRef(checkoutMachine, { debug: { disabled: true } });
    konat.useActorRef(loadUser, { input: { id: 'u1' }, debug });
    konat.createActorContext(checkoutMachine, { debug });
    konat.createActorContext(checkoutMachine, { systemId: 'checkout' });

    expectTypeOf<DebugOptions>().toEqualTypeOf<{ id?: string; label?: string; disabled?: boolean }>();
  });

  test('debug options and XState’s own options are still type-checked', () => {
    // @ts-expect-error debug.id is a string
    konat.useMachine(checkoutMachine, { debug: { id: 1 } });
    // @ts-expect-error debug has no `name` option
    konat.useActor(checkoutMachine, { debug: { name: 'checkout' } });
    // @ts-expect-error debug.disabled is a boolean
    konat.useActorRef(checkoutMachine, { debug: { disabled: 'yes' } });
    // @ts-expect-error debug.label is a string
    konat.createActorContext(checkoutMachine, { debug: { label: 42 } });
    // @ts-expect-error systemId is XState's and still a string
    konat.useMachine(checkoutMachine, { systemId: 1 });
    // @ts-expect-error useMachine only takes machines
    konat.useMachine(loadUser, { input: { id: 'u1' } });
  });

  test('logic that requires input still requires it', () => {
    // @ts-expect-error the options and their input are required
    konat.useMachine(profileMachine);
    // @ts-expect-error debug options don't stand in for input
    konat.useMachine(profileMachine, { debug: { id: 'profile' } });
    // @ts-expect-error input has the machine's input type
    konat.useMachine(profileMachine, { input: { userId: 1 } });
    konat.useMachine(profileMachine, { input: { userId: 'u1' }, debug: { id: 'profile' } });

    // @ts-expect-error the options and their input are required
    konat.useActor(profileMachine);
    // @ts-expect-error debug options don't stand in for input
    konat.useActor(profileMachine, { debug: { label: 'Profile' } });
    konat.useActor(profileMachine, { input: { userId: 'u1' }, debug: { label: 'Profile' } });

    // @ts-expect-error the options and their input are required
    konat.useActorRef(profileMachine);
    // @ts-expect-error debug options don't stand in for input
    konat.useActorRef(profileMachine, { debug: { disabled: true } });
    konat.useActorRef(profileMachine, { input: { userId: 'u1' }, debug: { disabled: true } });

    // @ts-expect-error non-machine logic too
    konat.useActorRef(loadUser, { debug: { id: 'load-user' } });
    // @ts-expect-error non-machine logic too
    konat.useActor(loadUser);
  });
});

describe('defineFixtures', () => {
  test('returns a FixtureSet', () => {
    expectTypeOf(defineFixtures(checkoutMachine, {})).toEqualTypeOf<FixtureSet>();
  });

  test('keys are the leaf ids of nested compound states and final states', () => {
    expectTypeOf<LeafIdFrom<typeof checkoutMachine>>().toEqualTypeOf<CheckoutLeaf>();
    expectTypeOf<keyof FixtureStates<typeof checkoutMachine>>().toEqualTypeOf<CheckoutLeaf>();

    defineFixtures(checkoutMachine, {
      cart: { context: base },
      'payment.editing.incomplete': { context: base },
      'payment.editing.complete': { context: base },
      'payment.processing': { context: base },
      'payment.error': { context: { ...base, error: 'Card declined' } },
      'payment.success': { context: { ...base, receiptId: 'rcpt_123' } },
      cancelled: { context: base },
    });
  });

  test('every key is optional', () => {
    defineFixtures(checkoutMachine, {});
    defineFixtures(checkoutMachine, { 'payment.error': { context: base } });
  });

  test('a compound state is not a key', () => {
    defineFixtures(checkoutMachine, {
      // @ts-expect-error payment is compound, not a leaf
      payment: { context: base },
    });
    defineFixtures(checkoutMachine, {
      // @ts-expect-error payment.editing is compound, not a leaf
      'payment.editing': { context: base },
    });
  });

  test('a misspelled or otherwise unknown key is a type error', () => {
    defineFixtures(checkoutMachine, {
      // @ts-expect-error misspelled
      'payment.eror': { context: base },
    });
    defineFixtures(checkoutMachine, {
      // @ts-expect-error the leaf's key without its path
      error: { context: base },
    });
    defineFixtures(checkoutMachine, {
      // @ts-expect-error XState's `#id.path` form isn't a leaf id
      '#checkout.payment.error': { context: base },
    });
    defineFixtures(checkoutMachine, {
      // @ts-expect-error history states aren't listed or previewable
      'payment.editing.last': { context: base },
    });
  });

  test('context must match the machine context', () => {
    defineFixtures(checkoutMachine, {
      // @ts-expect-error total is missing
      cart: { context: { items: [] } },
    });
    defineFixtures(checkoutMachine, {
      // @ts-expect-error total is a number
      cart: { context: { ...base, total: '48.00' } },
    });
    defineFixtures(checkoutMachine, {
      // @ts-expect-error the context has no `coupon`
      cart: { context: { ...base, coupon: 'SAVE10' } },
    });
    defineFixtures(checkoutMachine, {
      // @ts-expect-error each entry needs a context
      cart: {},
    });
    defineFixtures(editorMachine, {
      // @ts-expect-error the editor's context isn't the checkout's
      autosave: { context: base },
    });

    expectTypeOf<NonNullable<FixtureStates<typeof checkoutMachine>['cart']>>().toEqualTypeOf<{
      context: CheckoutContext;
    }>();
  });

  test('keys of a parallel machine are the leaves of every region', () => {
    expectTypeOf<LeafIdFrom<typeof layoutMachine>>().toEqualTypeOf<LayoutLeaf>();
    expectTypeOf<keyof FixtureStates<typeof layoutMachine>>().toEqualTypeOf<LayoutLeaf>();

    defineFixtures(layoutMachine, {
      'sidebar.closed': { context: { width: 320 } },
      'content.split.left.empty': { context: { width: 1024 } },
      'content.split.right.edit': { context: { width: 1024 } },
    });
    defineFixtures(layoutMachine, {
      // @ts-expect-error a region is not a leaf
      sidebar: { context: { width: 320 } },
    });
    defineFixtures(layoutMachine, {
      // @ts-expect-error a nested parallel state is not a leaf
      'content.split': { context: { width: 320 } },
    });
  });

  test('atomic regions of a parallel state are leaf ids', () => {
    expectTypeOf<LeafIdFrom<typeof editorMachine>>().toEqualTypeOf<EditorLeaf>();
    expectTypeOf<keyof FixtureStates<typeof editorMachine>>().toEqualTypeOf<EditorLeaf>();

    defineFixtures(editorMachine, {
      autosave: { context: { text: 'draft' } },
      'upload.sending.progress': { context: { text: 'draft' } },
      'upload.sent': { context: { text: 'final' } },
    });
    defineFixtures(editorMachine, {
      // @ts-expect-error misspelled atomic region
      autosaev: { context: { text: '' } },
    });
    defineFixtures(editorMachine, {
      // @ts-expect-error a parallel state with atomic regions is not a leaf
      'upload.sending': { context: { text: '' } },
    });
  });

  test('machines whose state value type can’t be derived accept any string key', () => {
    expectTypeOf<LeafIdFrom<typeof untypedMachine>>().toEqualTypeOf<string>();
    expectTypeOf<LeafIdFrom<AnyStateMachine>>().toEqualTypeOf<string>();

    defineFixtures(untypedMachine, { a: { context: {} }, 'b.c': { context: {} }, anything: { context: {} } });
    defineFixtures(anyMachine, { 'payment.error': { context: { whatever: true } }, other: { context: 1 } });
  });
});

describe('connect', () => {
  test('returns the type it was given', () => {
    const actor = createActor(checkoutMachine);
    expectTypeOf(connect(actor)).toEqualTypeOf(actor);
    expectTypeOf(connect(actor)).toEqualTypeOf<Actor<typeof checkoutMachine>>();
    expectTypeOf(connect(actor, { id: 'checkout', label: 'Checkout', disabled: false })).toEqualTypeOf(actor);

    const started = connect(createActor(layoutMachine).start(), { id: 'layout' });
    expectTypeOf(started).toEqualTypeOf<Actor<typeof layoutMachine>>();

    const promiseActor = createActor(loadUser, { input: { id: 'u1' } });
    expectTypeOf(connect(promiseActor)).toEqualTypeOf(promiseActor);

    const ref: AnyActorRef = actor;
    expectTypeOf(connect(ref)).toEqualTypeOf<AnyActorRef>();
  });

  test('takes actors and debug options only', () => {
    const actor = createActor(checkoutMachine);
    // @ts-expect-error connect takes an actor, not a machine
    connect(checkoutMachine);
    // @ts-expect-error id is a string
    connect(actor, { id: 1 });
    // @ts-expect-error the options are DebugOptions, not hook options
    connect(actor, { debug: { id: 'checkout' } });
  });
});
