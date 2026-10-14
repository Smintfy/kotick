export function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatSize(bytes: number) {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1_000)} KB`;
}
