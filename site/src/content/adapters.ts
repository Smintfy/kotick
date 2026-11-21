export const adapters = [
  { id: 'reducer', label: 'useReducer', entry: 'konat/reducer' },
  { id: 'xstate', label: 'XState', entry: 'konat/xstate' },
] as const;

export type Adapter = (typeof adapters)[number]['id'];
