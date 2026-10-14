export type Example = {
  path: string;
  title: string;
  /** The state-viewer/xstate API that the page uses to read its machine. */
  api: string;
  summary: string;
};

// The home page and the nav show the examples in this sequence.
export const examples = {
  checkout: {
    path: '/checkout',
    title: 'Checkout',
    api: 'useMachine',
    summary: 'One machine with parallel shipping and payment regions, a history state and an invoked payment.',
  },
  cart: {
    path: '/cart',
    title: 'Cart',
    api: 'createActorContext',
    summary: 'A provider shared by sibling components that each read a slice with useSelector.',
  },
  uploads: {
    path: '/uploads',
    title: 'Uploads',
    api: 'useActor',
    summary: 'One machine per row, so the panel lists an instance for each file.',
  },
} satisfies Record<string, Example>;
