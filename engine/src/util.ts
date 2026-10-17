/** Use in the `default` branch of a switch to get a compile error when a union variant is unhandled. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}

/** Immutable "set key" for records. */
export function withEntry<K extends PropertyKey, V>(
  record: Readonly<Record<K, V>>,
  key: K,
  value: V,
): Readonly<Record<K, V>> {
  return { ...record, [key]: value } as Record<K, V>;
}

/** Immutable "delete key" for records. */
export function without<K extends PropertyKey, V>(
  record: Readonly<Record<K, V>>,
  key: K,
): Readonly<Record<K, V>> {
  const copy = { ...record } as Record<K, V>;
  delete copy[key];
  return copy;
}
