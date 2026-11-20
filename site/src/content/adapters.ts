export const adapters = [
  { id: 'xstate', label: 'XState', entry: 'konat/xstate' },
  { id: 'reducer', label: 'Reducer', entry: 'konat/reducer' },
] as const;

export type Adapter = (typeof adapters)[number]['id'];
