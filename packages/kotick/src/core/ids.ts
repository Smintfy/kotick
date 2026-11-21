export function isId(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

export function isLeafId(value: unknown): value is string {
  return typeof value === 'string';
}
