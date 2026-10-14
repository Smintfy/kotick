import { createActorContext } from 'state-viewer/xstate';
import { cartMachine } from './machine.ts';

export const CartContext = createActorContext(cartMachine);
