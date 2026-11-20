import { products, type Product } from '@/lib/products.ts';

/**
 * A product search for the example app. It answers after 600 ms, and it stops when `signal` aborts.
 * When `offline` is true, it fails as a lost connection does.
 */
export function searchProducts(query: string, signal: AbortSignal, offline: boolean): Promise<Product[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (offline) reject(new Error('Connection lost'));
      else resolve(products.filter((product) => product.name.toLowerCase().includes(query.trim().toLowerCase())));
    }, 600);

    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}
