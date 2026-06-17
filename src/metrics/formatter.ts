/**
 * Prometheus exposition-format output helpers.
 *
 * Pure functions with zero side effects — take data in, return text out.
 * Fully unit-testable without any metric state.
 *
 * WHEN TO READ THIS FILE: Modifying Prometheus output format, adding a new
 * metric type, or debugging format issues.
 *
 * References:
 *   https://prometheus.io/docs/instrumenting/exposition_formats/
 */

import { BUCKET_BOUNDS, type HistogramEntry } from './registry';

/** Escape a label value per Prometheus exposition format. */
export function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** Serialise a label set to `key="value",key2="value2"` (sorted keys). */
export function labelKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
    .join(',');
}

/**
 * Render a gauge metric line (with optional labels).
 *
 * Prometheus output:
 *   # HELP <name> <help>
 *   # TYPE <name> gauge
 *   <name>{<labels>} <value>
 */
export function formatGauge(name: string, help: string, value: number, labels?: Record<string, string>): string {
  let out = `# HELP ${name} ${help}\n# TYPE ${name} gauge\n`;
  if (labels) {
    out += `${name}{${labelKey(labels)}} ${value}\n`;
  } else {
    out += `${name} ${value}\n`;
  }
  return out;
}

/**
 * Render a counter metric from an entries map.
 *
 * Prometheus output:
 *   # HELP <name> <help>
 *   # TYPE <name> counter
 *   <name>{<labels>} <value>
 *
 * The entries map must already use Prometheus label strings as keys.
 */
export function formatCounter(name: string, help: string, entries: ReadonlyMap<string, number>): string {
  let out = `# HELP ${name} ${help}\n# TYPE ${name} counter\n`;
  for (const [labels, value] of entries) {
    out += `${name}{${labels}} ${value}\n`;
  }
  return out;
}

/**
 * Parse a label string `key="value",key2="value2"` back into an object.
 * Used internally to reconstruct histogram lookup keys with consistent ordering.
 */
function parseLabelString(s: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!s) return result;
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
  let match;
  while ((match = re.exec(s)) !== null) {
    result[match[1]] = match[2].replace(/\\(.)/g, '$1');
  }
  return result;
}

/**
 * Render a histogram metric from entries that store {count, sum} per bucket.
 *
 * Prometheus output:
 *   # HELP <name> <help>
 *   # TYPE <name> histogram
 *   <name>_bucket{<base_labels>,le="<bound>"} <cumulative>
 *   <name>_sum …   (exact, no longer estimated)
 *   <name>_count …
 *
 * Entries use label strings that include `le="<bound>"`. The method groups
 * entries by their base labels (without `le`), then emits cumulative buckets.
 *
 * Uses labelKey() for key construction so label ordering stays consistent
 * whether or not `le` sorts before or after other labels alphabetically.
 */
export function formatHistogram(
  name: string,
  help: string,
  entries: ReadonlyMap<string, HistogramEntry>,
): string {
  const buckets = BUCKET_BOUNDS;
  let out = `# HELP ${name} ${help}\n# TYPE ${name} histogram\n`;

  // Group by base labels (without `le`)
  const baseKeys = new Set<string>();
  for (const key of entries.keys()) {
    const withoutLe = key.replace(/,\s*le="[^"]*"/, '').replace(/^le="[^"]*",?\s*/, '');
    baseKeys.add(withoutLe);
  }

  let totalCount = 0;
  let totalSum = 0;

  for (const base of baseKeys) {
    // Parse base labels once per series
    const baseLabels = parseLabelString(base);
    let cumulative = 0;
    let baseSum = 0;

    for (const bound of [...buckets, '+Inf']) {
      // Convert to string label value (bound is number | '+Inf')
      const leStr = bound === '+Inf' ? '+Inf' : String(bound);
      // Construct lookup key using labelKey so ordering matches the stored key
      const k = labelKey({ ...baseLabels, le: leStr });
      const entry = entries.get(k);
      const rawCount = entry?.count ?? 0;
      const bucketSum = entry?.sum ?? 0;

      // Emit cumulative count for this bucket
      cumulative += rawCount;
      baseSum += bucketSum;
      const fullLabelsKey = labelKey({ ...baseLabels, le: leStr });
      out += `${name}_bucket{${fullLabelsKey}} ${cumulative}\n`;
    }
    totalCount += cumulative;
    totalSum += baseSum;
  }

  out += `${name}_sum ${totalSum}\n`;
  out += `${name}_count ${totalCount}\n`;
  return out;
}
