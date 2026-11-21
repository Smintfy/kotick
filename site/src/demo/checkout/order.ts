type Cents = number;

export type LineItem = {
  id: string;
  name: string;
  price: Cents;
  qty: number;
};

export type Card = {
  number: string;
  expiry: string;
  cvc: string;
};

export type Shipping = 'standard' | 'express' | 'pickup';

export type CheckoutEvent =
  | { type: 'SET_QTY'; id: string; qty: number }
  | { type: 'REMOVE_ITEM'; id: string }
  | { type: 'RESTORE_ITEMS' }
  | { type: 'CONTINUE' }
  | { type: 'BACK' }
  | { type: 'SHIP_STANDARD' }
  | { type: 'SHIP_EXPRESS' }
  | { type: 'SHIP_PICKUP' }
  | { type: 'UPDATE_CARD'; field: keyof Card; value: string }
  | { type: 'PAY' }
  | { type: 'RETRY' }
  | { type: 'EDIT_CARD' };

export const maxQty = 9;

export const startItems: LineItem[] = [
  { id: 'sku_1', name: 'Linen tote', price: 2400, qty: 2 },
  { id: 'sku_2', name: 'Canvas pouch', price: 1200, qty: 1 },
];

export const emptyCard: Card = { number: '', expiry: '', cvc: '' };

export const digitsOf = (value: string) => value.replace(/\D/g, '');

export const subtotalOf = (items: LineItem[]): Cents => items.reduce((sum, item) => sum + item.price * item.qty, 0);

export const withQty = (items: LineItem[], id: string, qty: number) =>
  items.map((item) => (item.id === id ? { ...item, qty: Math.min(Math.max(qty, 1), maxQty) } : item));

export function expiryProblem(expiry: string, now = new Date()): string | undefined {
  const digits = digitsOf(expiry);

  if (digits.length < 4) return undefined;

  const month = Number(digits.slice(0, 2));
  const year = 2000 + Number(digits.slice(2, 4));

  if (month < 1 || month > 12) return 'The expiry month must be 01 to 12';

  const firstDayAfterExpiryMonth = new Date(year, month);

  if (firstDayAfterExpiryMonth <= now) return 'The card has expired';

  return undefined;
}

export const isCardComplete = (card: Card) =>
  digitsOf(card.number).length === 16 &&
  digitsOf(card.expiry).length === 4 &&
  expiryProblem(card.expiry) === undefined &&
  /^\d{3,4}$/.test(card.cvc);

/** The payment service declines each card that ends in 0002. */
export async function chargeCard(card: Card): Promise<{ receiptId: string }> {
  await new Promise((resolve) => setTimeout(resolve, 800));

  if (digitsOf(card.number).endsWith('0002')) throw new Error('Card declined');

  return { receiptId: `rcpt_${Math.random().toString(36).slice(2, 8)}` };
}
