import { defineReducerMachine } from 'kotick/reducer';

// kotick/reducer has no 'use client' directive, so server components can import this file and call feedbackMachine.reducer.

export type Rating = 1 | 2 | 3 | 4 | 5;

export type FeedbackState =
  | { status: 'rating' }
  | { status: 'writing'; rating: Rating; comment: string }
  | { status: 'sending'; rating: Rating; comment: string }
  | { status: 'sent'; rating: Rating };

type FeedbackEvent =
  | { type: 'RATE'; rating: Rating }
  | { type: 'EDIT'; comment: string }
  | { type: 'SEND' }
  | { type: 'SENT' }
  | { type: 'RESET' };

export const ratings: readonly Rating[] = [1, 2, 3, 4, 5];

export function ratingOf(value: string | string[] | undefined): Rating | undefined {
  return ratings.find((rating) => String(rating) === value);
}

/** The example has no server, so the request only waits. */
const submit = () => new Promise((resolve) => setTimeout(resolve, 800));

export const feedbackMachine = defineReducerMachine<FeedbackState, FeedbackEvent>()({
  id: 'feedback',
  discriminant: 'status',
  states: {
    rating: {
      on: { RATE: (_state, event) => ({ status: 'writing', rating: event.rating, comment: '' }) },
    },
    writing: {
      on: {
        RATE: (state, event) => ({ ...state, rating: event.rating }),
        EDIT: (state, event) => ({ ...state, comment: event.comment }),
        SEND: (state) => ({ ...state, status: 'sending' }),
      },
    },
    sending: {
      on: { SENT: (state) => ({ status: 'sent', rating: state.rating }) },
      effect: (_state, send) => {
        void submit().then(() => send({ type: 'SENT' }));
      },
    },
    sent: {
      on: { RESET: () => ({ status: 'rating' }) },
    },
  },
});
