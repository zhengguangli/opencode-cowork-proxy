/**
 * Audit log retrieval endpoint — serves recent audit events from the ring buffer.
 *
 * WHEN TO READ THIS FILE: Debugging security events, checking audit trail.
 *
 * GET /audit/log returns the last N audit events as JSON array.
 * No authentication (local-friendly); add auth in production.
 */

import { getRecentAuditEvents } from '../audit';
import { RouteInfo } from './shared';

/**
 * Handle GET /audit/log — returns recent audit events.
 */
export async function handleAuditLog(_request: Request, _route: RouteInfo): Promise<Response> {
  const url = new URL(_request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '200', 10), 1), 1000);
  const events = getRecentAuditEvents(limit);
  return new Response(JSON.stringify(events, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}
