/**
 * Metrics module barrel export.
 *
 * Re-exports:
 *   - MetricsRegistry class + singleton instance
 *   - BUCKET_BOUNDS + HistogramEntry type
 *   - Prometheus format helpers
 *   - trackActiveStream — ReadableStream wrapper for active-connection tracking
 *
 * WHEN TO READ THIS FILE: Adding a new metric sub-module.
 */

export { MetricsRegistry, metricsRegistry, BUCKET_BOUNDS } from './registry';
export type { HistogramEntry } from './registry';
export { formatGauge, formatCounter, formatHistogram, labelKey, escapeLabel } from './formatter';
export { trackActiveStream } from './stream-track';
