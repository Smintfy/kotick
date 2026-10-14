import { CheckoutForm } from '@/components/CheckoutForm.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';
import { examples } from '@/examples.ts';

export function CheckoutPage() {
  return (
    <>
      <PageHeader example={examples.checkout} />
      <CheckoutForm />
    </>
  );
}
