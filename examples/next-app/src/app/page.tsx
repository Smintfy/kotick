import { SignupForm } from '@/components/signup-form';

export default function NewsletterPage() {
  return (
    <>
      <header className="page-header">
        <h1>Newsletter</h1>
        <p className="muted">
          A form machine with <code>useMachine</code>. The server renders it, and the browser hydrates it.
        </p>
      </header>
      <SignupForm />
    </>
  );
}
