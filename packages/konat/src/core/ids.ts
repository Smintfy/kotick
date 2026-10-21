// The ids that name things in the registry, as the parsers of app data and stored data check them.

/** A machine id or an instance id: a non-empty string. */
export function isId(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** A leaf id, such as `payment.error`. */
export function isLeafId(value: unknown): value is string {
  return typeof value === 'string';
}
