import { PageHeader } from '@/components/PageHeader.tsx';
import { ProductSearch } from '@/components/ProductSearch.tsx';
import { examples } from '@/examples.ts';

export function SearchPage() {
  return (
    <>
      <PageHeader example={examples.search} />
      <ProductSearch />
    </>
  );
}
