// Vitest typechecks this file but never runs it.
// So the tests call hooks outside components and never start actors.

import * as xstateReact from '@xstate/react';
import * as kotick from 'kotick/xstate';
import { connect, defineFixtures, type FixtureStates, type LeafIdFrom } from 'kotick/xstate';
import { describe, expectTypeOf, test } from 'vitest';
import {
  createActor,
  createMachine,
  fromPromise,
  setup,
  type Actor,
  type AnyStateMachine,
  type SnapshotFrom,
} from 'xstate';

type CheckoutContext = { items: string[]; total: number; error?: string; receiptId?: string };

type CheckoutEvent = { type: 'PAY' } | { type: 'RETRY' } | { type: 'UPDATE_CARD'; cardNumber: string };

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

type EditorContext = { text: string };

// XState shows an atomic region as `{}` in the state value.
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

describe('hooks', () => {
  test('each hook returns what @xstate/react returns for the same logic', () => {
    expectTypeOf<ReturnType<typeof kotick.useMachine<typeof checkoutMachine>>>().toEqualTypeOf<
      ReturnType<typeof xstateReact.useMachine<typeof checkoutMachine>>
    >();
    expectTypeOf<ReturnType<typeof kotick.useActor<typeof checkoutMachine>>>().toEqualTypeOf<
      ReturnType<typeof xstateReact.useActor<typeof checkoutMachine>>
    >();
    expectTypeOf<ReturnType<typeof kotick.useActorRef<typeof checkoutMachine>>>().toEqualTypeOf<
      ReturnType<typeof xstateReact.useActorRef<typeof checkoutMachine>>
    >();
    expectTypeOf(kotick.useMachine(profileMachine, { input: { userId: 'u1' } })).toEqualTypeOf(
      xstateReact.useMachine(profileMachine, { input: { userId: 'u1' } }),
    );
    expectTypeOf(kotick.useActor(loadUser, { input: { id: 'u1' } })).toEqualTypeOf(
      xstateReact.useActor(loadUser, { input: { id: 'u1' } }),
    );
    expectTypeOf(kotick.useActorRef(loadUser, { input: { id: 'u1' } })).toEqualTypeOf(
      xstateReact.useActorRef(loadUser, { input: { id: 'u1' } }),
    );
    kotick.useActorRef(checkoutMachine, { debug: { label: 'Checkout' } }, (snapshot) => {
      expectTypeOf(snapshot).toEqualTypeOf<SnapshotFrom<typeof checkoutMachine>>();
    });
  });

  test('createActorContext returns what @xstate/react returns, with debug also allowed in the Provider options', () => {
    const ours = kotick.createActorContext(checkoutMachine, { debug: { id: 'checkout' } });
    const theirs = xstateReact.createActorContext(checkoutMachine);

    expectTypeOf(ours.useSelector).toEqualTypeOf(theirs.useSelector);
    expectTypeOf(ours.useActorRef).toEqualTypeOf(theirs.useActorRef);
    // The context can replace XState's context in any place that expects it.
    // So its Provider accepts all the props that XState's Provider accepts.
    expectTypeOf(ours).toExtend<typeof theirs>();
    expectTypeOf(ours.Provider).toBeCallableWith({
      children: null,
      options: { id: 'checkout-actor', debug: { id: 'checkout', label: 'Checkout', disabled: false } },
    });
  });

  test('debug options are type-checked, and stand in for no option the logic requires', () => {
    kotick.useMachine(checkoutMachine, { systemId: 'checkout', debug: { id: 'checkout', label: 'Checkout' } });
    kotick.useActorRef(profileMachine, { input: { userId: 'u1' }, debug: { disabled: true } });
    // @ts-expect-error debug.id is a string
    kotick.useMachine(checkoutMachine, { debug: { id: 1 } });
    // @ts-expect-error debug has no `name` option
    kotick.useActor(checkoutMachine, { debug: { name: 'checkout' } });
    // @ts-expect-error the options and their input are required
    kotick.useMachine(profileMachine);
    // @ts-expect-error debug options don't stand in for input
    kotick.useMachine(profileMachine, { debug: { id: 'profile' } });
    // @ts-expect-error debug options don't stand in for input
    kotick.useActorRef(profileMachine, { debug: { disabled: true } });
    // @ts-expect-error non-machine logic too
    kotick.useActorRef(loadUser, { debug: { id: 'load-user' } });
  });
});

describe('defineFixtures', () => {
  test('keys are the leaf ids of nested compound and final states, each one optional', () => {
    expectTypeOf<LeafIdFrom<typeof checkoutMachine>>().toEqualTypeOf<CheckoutLeaf>();
    expectTypeOf<keyof FixtureStates<typeof checkoutMachine>>().toEqualTypeOf<CheckoutLeaf>();

    defineFixtures(checkoutMachine, { 'payment.error': { context: { ...base, error: 'Card declined' } } });
  });

  test('keys of a parallel machine are the leaves of every region, atomic regions included', () => {
    expectTypeOf<LeafIdFrom<typeof editorMachine>>().toEqualTypeOf<EditorLeaf>();
  });

  test('machines whose state value type can’t be derived accept any string key', () => {
    expectTypeOf<LeafIdFrom<typeof untypedMachine>>().toEqualTypeOf<string>();
    expectTypeOf<LeafIdFrom<AnyStateMachine>>().toEqualTypeOf<string>();
  });

  test('an unknown key or a compound state is a type error', () => {
    defineFixtures(checkoutMachine, {
      // @ts-expect-error misspelled
      'payment.eror': { context: base },
    });
    defineFixtures(checkoutMachine, {
      // @ts-expect-error payment is compound, not a leaf
      payment: { context: base },
    });
  });

  test('context must match the machine context', () => {
    defineFixtures(checkoutMachine, {
      // @ts-expect-error total is a number
      cart: { context: { ...base, total: '48.00' } },
    });
    defineFixtures(checkoutMachine, {
      // @ts-expect-error each entry needs a context
      cart: {},
    });
  });
});

describe('connect', () => {
  test('returns the type it was given, and takes an actor, not a machine', () => {
    const actor = createActor(checkoutMachine);
    expectTypeOf(connect(actor, { id: 'checkout', label: 'Checkout' })).toEqualTypeOf<Actor<typeof checkoutMachine>>();
    // @ts-expect-error connect takes an actor, not a machine
    connect(checkoutMachine);
  });
});
