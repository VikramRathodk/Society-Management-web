/** Case-insensitive compare that orders embedded numbers numerically ("101" < "1001"). */
export function compareNatural(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function sortBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareNatural(key(a), key(b)));
}
