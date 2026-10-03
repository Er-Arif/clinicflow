export function newIdempotencyKey(prefix = 'cf') {
  const random = Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}
