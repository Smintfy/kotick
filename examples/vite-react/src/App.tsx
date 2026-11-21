import { BrowserRouter, Route, Routes } from 'react-router';
import { Layout } from '@/Layout.tsx';
import { examples } from '@/examples.ts';
import { CartPage } from '@/pages/CartPage.tsx';
import { CheckoutPage } from '@/pages/CheckoutPage.tsx';
import { Home } from '@/pages/Home.tsx';
import { SearchPage } from '@/pages/SearchPage.tsx';
import { UploadsPage } from '@/pages/UploadsPage.tsx';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path={examples.checkout.path} element={<CheckoutPage />} />
          <Route path={examples.cart.path} element={<CartPage />} />
          <Route path={examples.uploads.path} element={<UploadsPage />} />
          <Route path={examples.search.path} element={<SearchPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
