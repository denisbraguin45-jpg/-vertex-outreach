// node:sqlite returns Record<string, SQLOutputValue>; these helpers centralize
// the safe cast to domain row types.
export function asRow<T>(row: unknown): T | null {
  if (row === undefined || row === null) return null;
  return row as T;
}

export function asRows<T>(rows: unknown): T[] {
  return rows as T[];
}
