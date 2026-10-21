export type Product = {
  id: string;
  name: string;
  priceCents: number;
};

export type LineItem = Product & { qty: number };

export const products: Product[] = [
  { id: 'sku_1', name: 'Linen tote', priceCents: 2400 },
  { id: 'sku_2', name: 'Ceramic mug', priceCents: 1800 },
  { id: 'sku_3', name: 'Notebook', priceCents: 900 },
];
