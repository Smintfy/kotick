import { createActor } from 'xstate';
import { connect } from 'state-viewer/xstate';
import { sessionMachine } from './machine.ts';

// Created at module level, outside React, so it registers through connect() rather than a hook.
export const sessionActor = connect(createActor(sessionMachine).start(), { id: 'session' });
