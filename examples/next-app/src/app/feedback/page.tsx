import { FeedbackForm } from '@/components/feedback-form';
import { type FeedbackState, feedbackMachine, ratingOf } from '@/machines/feedback';

const start: FeedbackState = { status: 'rating' };

export default async function FeedbackPage({ searchParams }: PageProps<'/feedback'>) {
  const rating = ratingOf((await searchParams).rating);
  const initial = rating ? feedbackMachine.reducer(start, { type: 'RATE', rating }) : start;

  return (
    <>
      <header className="page-header">
        <h1>Feedback</h1>
        <p className="muted">
          A reducer machine with <code>useMachineReducer</code>. This server component imports the machine file. For
          a link such as <a href="/feedback?rating=4">/feedback?rating=4</a>, it calls <code>machine.reducer</code> to
          start the form with that rating.
        </p>
      </header>
      <FeedbackForm initial={initial} />
    </>
  );
}
