export type Product = {
  id: string;
  name: string;
  /** The price in cents. */
  price: number;
};

export type LineItem = Product & { qty: number };

export const products: Product[] = [
  { id: 'sku_1', name: 'Linen tote', price: 2400 },
  { id: 'sku_2', name: 'Ceramic mug', price: 1800 },
  { id: 'sku_3', name: 'Notebook', price: 900 },
];
