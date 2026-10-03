function randomHex(length: number): string {
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += Math.floor(Math.random() * 16).toString(16);
  }
  return value;
}

/** Correlation-only UUID. It is not used as a security token. */
export function newRequestId(): string {
  const variant = (8 + Math.floor(Math.random() * 4)).toString(16);
  return `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-${variant}${randomHex(3)}-${randomHex(12)}`;
}
