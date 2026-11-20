'use client';

// The build packs this module as its own file, so its directive stays at the top.
// It is the only 'use client' module of konat/reducer.
// In the server graph of a framework with server components, useMachineReducer is then a client reference.
// A call from a server component fails with a message that names the hook.

export { useMachineReducer } from './runtime';
