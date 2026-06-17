/**
 * Shared RouteInfo interface used by all handler functions.
 *
 * WHEN TO READ THIS FILE: Adding a new field to RouteInfo, or understanding
 * what data each handler receives for routing decisions.
 */

export interface RouteInfo {
  path: string;
  modelOverride?: string | null;
  upstream: string;
  /**
   * Final resolved model set by the handler after applying all overrides
   * (URL → vision → thinking). Index.ts reads this for per-model metrics.
   * Undefined means the handler hasn't resolved it yet.
   */
  resolvedModel?: string;
}
