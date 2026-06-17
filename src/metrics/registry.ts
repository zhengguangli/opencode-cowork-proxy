/**
 * MetricsRegistry — Encapsulates all metric state with typed recording methods.
 *
 * Separated from the HTTP handler layer to enable isolated testing and
 * to keep storage/recording logic decoupled from Prometheus output formatting.
 *
 * Metric types exposed:
 *   - Counter: http_requests_total, upstream_requests_total, upstream_errors_total
 *             model_requests_total, model_errors_total
 *   - Histogram: http_request_duration_ms, model_request_duration_ms
 *   - Gauge: active_streams, uptime_seconds
 *
 * Model-level metrics are tracked separately by {model, status} labels,
 * enabling per-model latency, throughput, and error rate analysis.
 *
 * NOTE: uptime_seconds is computed at render time from START_TIME rather than
 * tracked as a gauge, since it changes every second and is trivial to derive.
 *
 * WHEN TO READ THIS FILE: Adding a new metric, modifying recording behavior,
 * or debugging metric collection.
 */

import { START_TIME } from '../config';

/** Histogram bucket boundaries in milliseconds. */
export const BUCKET_BOUNDS: readonly number[] = [5, 10, 25, 50, 100, 250, 500, 1000, 3000, 10000];

/** Internal label-serialized histogram entry — count + exact sum. */
export interface HistogramEntry {
  count: number;
  sum: number;
}

/** Labels key → count for simple counters. */
type CounterMap = Map<string, number>;

/**
 * Thread-safe-ish metrics registry for Cloudflare Workers.
 * Each isolate processes one request at a time, so no atomicity needed.
 * All state resets on process restart (appropriate for Workers).
 */
export class MetricsRegistry {
  /** HTTP request counters keyed by {method, path, status}. */
  private requestCount: CounterMap = new Map();

  /**
   * Histogram bucket counts per {method, path, status, le}.
   * The full label key is stored directly (+Inf bucket included).
   */
  private durationBuckets: Map<string, HistogramEntry> = new Map();

  /** Upstream request counters keyed by {upstream}. */
  private upstreamRequestCount: CounterMap = new Map();

  /** Upstream error counters keyed by {upstream, status}. */
  private upstreamErrorCount: CounterMap = new Map();

  /** Per-model request counters keyed by {model, status}. */
  private modelRequestCount: CounterMap = new Map();

  /** Per-model duration histogram keyed by {model, status, le}. */
  private modelDurationBuckets: Map<string, HistogramEntry> = new Map();

  /** Per-model error counters keyed by {model, status}. */
  private modelErrorCount: CounterMap = new Map();

  /** Currently active streaming connections. */
  private activeStreams = 0;

  // ---- Label helpers ----

  /** Serialise a label set to a Prometheus label string for use as a Map key. */
  private labelKey(labels: Record<string, string>): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${this.escapeLabel(v)}"`)
      .join(',');
  }

  private escapeLabel(v: string): string {
    return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  // ---- Recording methods ----

  /** Record one HTTP request with its duration. */
  recordRequest(method: string, path: string, status: number, durationMs: number): void {
    const labels = { method, path, status: String(status) };
    const key = this.labelKey(labels);
    this.requestCount.set(key, (this.requestCount.get(key) || 0) + 1);

    // Duration bucketing
    let bucket = '+Inf';
    for (const bound of BUCKET_BOUNDS) {
      if (durationMs <= bound) { bucket = String(bound); break; }
    }

    const durKey = this.labelKey({ ...labels, le: bucket });
    const prev = this.durationBuckets.get(durKey) || { count: 0, sum: 0 };
    this.durationBuckets.set(durKey, {
      count: prev.count + 1,
      sum: prev.sum + durationMs,
    });
  }

  /**
   * Record a request by model for per-model performance tracking.
   * Call this after the final model is resolved (after URL + vision overrides).
   */
  recordModelRequest(model: string, status: number, durationMs: number): void {
    const labels = { model, status: String(status) };
    const key = this.labelKey(labels);
    this.modelRequestCount.set(key, (this.modelRequestCount.get(key) || 0) + 1);

    // Duration bucketing
    let bucket = '+Inf';
    for (const bound of BUCKET_BOUNDS) {
      if (durationMs <= bound) { bucket = String(bound); break; }
    }

    const durKey = this.labelKey({ ...labels, le: bucket });
    const prev = this.modelDurationBuckets.get(durKey) || { count: 0, sum: 0 };
    this.modelDurationBuckets.set(durKey, {
      count: prev.count + 1,
      sum: prev.sum + durationMs,
    });

    // Track error statuses separately for error rate calculation
    if (status >= 400) {
      this.modelErrorCount.set(key, (this.modelErrorCount.get(key) || 0) + 1);
    }
  }

  /** Record one upstream fetch request. */
  recordUpstreamRequest(upstream: string): void {
    const key = this.labelKey({ upstream });
    this.upstreamRequestCount.set(key, (this.upstreamRequestCount.get(key) || 0) + 1);
  }

  /** Record one upstream error. */
  recordUpstreamError(upstream: string, status: number): void {
    const key = this.labelKey({ upstream, status: String(status) });
    this.upstreamErrorCount.set(key, (this.upstreamErrorCount.get(key) || 0) + 1);
  }

  /** Bump the active-streaming-connections gauge. */
  incrementActiveStreams(): void {
    this.activeStreams++;
  }

  /** Drop the active-streaming-connections gauge (floor at zero). */
  decrementActiveStreams(): void {
    if (this.activeStreams > 0) this.activeStreams--;
  }

  // ---- Snapshot accessors for rendering ----

  /** Snapshot of http_requests_total counters. */
  get requestCountSnapshot(): ReadonlyMap<string, number> {
    return new Map(this.requestCount);
  }

  /** Snapshot of http_request_duration_ms histogram. */
  get durationBucketsSnapshot(): ReadonlyMap<string, HistogramEntry> {
    return new Map(this.durationBuckets);
  }

  /** Snapshot of upstream_requests_total counters. */
  get upstreamRequestCountSnapshot(): ReadonlyMap<string, number> {
    return new Map(this.upstreamRequestCount);
  }

  /** Snapshot of model_requests_total counters. */
  get modelRequestCountSnapshot(): ReadonlyMap<string, number> {
    return new Map(this.modelRequestCount);
  }

  /** Snapshot of model_request_duration_ms histogram. */
  get modelDurationBucketsSnapshot(): ReadonlyMap<string, HistogramEntry> {
    return new Map(this.modelDurationBuckets);
  }

  /** Snapshot of model_errors_total counters. */
  get modelErrorCountSnapshot(): ReadonlyMap<string, number> {
    return new Map(this.modelErrorCount);
  }

  /** Snapshot of upstream_errors_total counters. */
  get upstreamErrorCountSnapshot(): ReadonlyMap<string, number> {
    return new Map(this.upstreamErrorCount);
  }

  /** Current active streams gauge value. */
  get activeStreamsValue(): number {
    return this.activeStreams;
  }

  /** Proxy uptime in seconds (computed at call time). */
  get uptimeSeconds(): number {
    return Math.floor((Date.now() - START_TIME) / 1000);
  }
}

/** Application-wide singleton metrics registry. */
export const metricsRegistry = new MetricsRegistry();
