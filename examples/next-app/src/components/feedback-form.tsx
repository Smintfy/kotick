'use client';

import { useMachineReducer } from 'kotick/reducer';
import { type FeedbackState, feedbackMachine, ratings } from '@/machines/feedback';

export function FeedbackForm({ initial }: { initial: FeedbackState }) {
  const [state, dispatch] = useMachineReducer(feedbackMachine, initial);

  if (state.status === 'sent') {
    return (
      <div className="card stack" role="status">
        <p>Thank you. We got your rating of {state.rating} out of 5.</p>
        <div className="actions">
          <button type="button" onClick={() => dispatch({ type: 'RESET' })}>
            Rate again
          </button>
        </div>
      </div>
    );
  }

  const busy = state.status === 'sending';

  return (
    <form
      className="card stack"
      onSubmit={(event) => {
        event.preventDefault();
        dispatch({ type: 'SEND' });
      }}
    >
      <fieldset disabled={busy}>
        <legend>How was your order?</legend>
        {ratings.map((rating) => (
          <label key={rating} className="option">
            <input
              type="radio"
              name="rating"
              checked={state.status !== 'rating' && state.rating === rating}
              onChange={() => dispatch({ type: 'RATE', rating })}
            />
            {rating} out of 5
          </label>
        ))}
      </fieldset>
      {state.status !== 'rating' && (
        <label className="field">
          Comment
          <textarea
            value={state.comment}
            disabled={busy}
            onChange={(event) => dispatch({ type: 'EDIT', comment: event.target.value })}
          />
        </label>
      )}
      <div className="actions">
        <button type="submit" disabled={state.status !== 'writing'}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}
