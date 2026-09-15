export function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function checksumKey(parts: Array<string | number>): string {
  return parts.map((part) => String(part)).join('::');
}
