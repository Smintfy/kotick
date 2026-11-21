export const adapters = [
  { id: 'reducer', label: 'useReducer', entry: 'kotick/reducer' },
  { id: 'xstate', label: 'XState', entry: 'kotick/xstate' },
] as const;

export type Adapter = (typeof adapters)[number]['id'];
