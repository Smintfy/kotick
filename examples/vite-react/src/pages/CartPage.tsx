import { Cart } from '@/components/Cart.tsx';
import { PageHeader } from '@/components/PageHeader.tsx';
import { examples } from '@/examples.ts';

export function CartPage() {
  return (
    <>
      <PageHeader example={examples.cart} />
      <Cart />
    </>
  );
}
