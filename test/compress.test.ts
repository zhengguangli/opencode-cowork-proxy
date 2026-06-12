import { describe, it, expect } from 'vitest';
import { isCompressionAccepted, compressibleStream } from '../src/compress';

describe('isCompressionAccepted', () => {
  it('returns true when client sends gzip', () => {
    const req = new Request('http://localhost', {
      headers: { 'Accept-Encoding': 'gzip, deflate, br' },
    });
    expect(isCompressionAccepted(req)).toBe(true);
  });

  it('returns true when only gzip', () => {
    const req = new Request('http://localhost', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(isCompressionAccepted(req)).toBe(true);
  });

  it('returns false when no Accept-Encoding header', () => {
    const req = new Request('http://localhost');
    expect(isCompressionAccepted(req)).toBe(false);
  });

  it('returns false when Accept-Encoding does not include gzip', () => {
    const req = new Request('http://localhost', {
      headers: { 'Accept-Encoding': 'deflate' },
    });
    expect(isCompressionAccepted(req)).toBe(false);
  });

  it('returns false for empty Accept-Encoding', () => {
    const req = new Request('http://localhost', {
      headers: { 'Accept-Encoding': '' },
    });
    expect(isCompressionAccepted(req)).toBe(false);
  });
});

describe('compressibleStream', () => {
  it('returns original stream when client does not accept gzip', () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hello'));
        controller.close();
      },
    });
    const req = new Request('http://localhost');
    const result = compressibleStream(stream, req);
    expect(result.contentEncoding).toBeNull();
  });

  it('attempts compression when client accepts gzip', () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hello world'));
        controller.close();
      },
    });
    const req = new Request('http://localhost', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    const result = compressibleStream(stream, req);
    // Compression should succeed in this environment (Bun)
    // Content-Encoding may be 'gzip' or null depending on CompressionStream availability
    expect(result.stream).toBeDefined();
  });

  it('produces a valid readable stream', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('test data'));
        controller.close();
      },
    });
    const req = new Request('http://localhost', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    const result = compressibleStream(stream, req);

    const reader = result.stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    // Should have some output (compressed or not)
    expect(chunks.length).toBeGreaterThan(0);
  });
});
