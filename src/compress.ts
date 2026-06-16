/**
 * Stream compression utilities for SSE and response payloads.
 *
 * WHEN TO READ THIS FILE: Adding new compression strategies, debugging
 * compressed stream behavior, or changing compression thresholds.
 *
 * Provides:
 *   compressibleStream() — conditionally wraps a ReadableStream with
 *     CompressionStream when the client supports gzip encoding.
 *   isCompressionAccepted() — checks Accept-Encoding header.
 */
import { log } from './logger';

/**
 * Check if the client accepts gzip compression via Accept-Encoding header.
 */
export function isCompressionAccepted(request: Request): boolean {
  const accept = request.headers.get('Accept-Encoding') || '';
  return accept.includes('gzip');
}

/**
 * Conditionally compress a ReadableStream using gzip CompressionStream.
 *
 * If the client accepts gzip encoding, the output is compressed on-the-fly
 * and the caller should set Content-Encoding: gzip on the response.
 *
 * SSE streams benefit from compression because repeated SSE metadata
 * (event: lines, data: prefixes) is highly compressible.
 *
 * @param stream - The output ReadableStream<Uint8Array>
 * @param request - The incoming request (used to check Accept-Encoding)
 * @returns { stream, contentEncoding } where contentEncoding is 'gzip' or null
 */
export function compressibleStream(
  stream: ReadableStream,
  request: Request,
): { stream: ReadableStream; contentEncoding: string | null } {
  if (!isCompressionAccepted(request)) {
    return { stream, contentEncoding: null };
  }

  // CompressionStream operates on-the-fly — the stream size is unknown at
  // this point, but small payloads compress efficiently regardless.
  try {
    const compressed = stream.pipeThrough(new CompressionStream('gzip'));
    return { stream: compressed, contentEncoding: 'gzip' };
  } catch (err) {
    log.debug('COMPRESS', 'CompressionStream not available', { error: err });
    return { stream, contentEncoding: null };
  }
}
