export const adapters = [
  { id: 'reducer', label: 'useReducer', entry: 'shiru/reducer' },
  { id: 'xstate', label: 'XState', entry: 'shiru/xstate' },
] as const;

export type Adapter = (typeof adapters)[number]['id'];
