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
}
