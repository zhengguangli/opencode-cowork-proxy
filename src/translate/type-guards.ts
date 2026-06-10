/**
 * Shared type guard helpers for safe type narrowing.
 *
 * WHEN TO READ THIS FILE: When adding new translator logic that casts
 * JSON-deserialized objects or arrays, import these helpers instead of
 * using raw `as` assertions.
 *
 * These functions perform runtime-safe checks (is object? is array?)
 * before returning the cast, so they are safer than bare `as` casts.
 * If the check fails, they return a default value (empty object/array)
 * rather than crashing.
 */

/** Safe cast for JSON-deserialized objects. Returns {} if not an object. */
export function asRecord(x: unknown): Record<string, unknown> {
  if (typeof x !== "object" || x === null) return {};
  return x as Record<string, unknown>;
}

/** Safe cast for arrays of objects. Returns [] if not an array. */
export function asRecordArray(x: unknown): Record<string, unknown>[] {
  if (!Array.isArray(x)) return [];
  return x as Record<string, unknown>[];
}

/** Safe cast for a value that may be an object or undefined. Returns undefined if not an object. */
export function asRecordOptional(x: unknown): Record<string, unknown> | undefined {
  if (typeof x !== "object" || x === null) return undefined;
  return x as Record<string, unknown>;
}
