import { describe, it, expect } from 'vitest';
import { withContextIds, getRequestId, getTraceId, resolveContextIds } from '../src/log/context';
import { startRequestSpan, startSpan, getCurrentSpan } from '../src/tracing';
import { RingBuffer } from '../src/audit';
import { verifyAdminAuth, unauthorizedResponse } from '../src/auth';
import { streamOpenAIToAnthropic } from '../src/translate/stream/openai-to-anthropic';
import { streamAnthropicToOpenAI } from '../src/translate/stream/anthropic-to-openai';
import { streamChatCompletionsToResponses } from '../src/translate/stream/chat-completions-to-responses';

describe('Optimizations: Concurrency Context Isolation (AsyncLocalStorage)', () => {
  it('isolates context IDs across interleaved concurrent async operations', async () => {
    const results: Array<{ id: string; observedReq: string | undefined; observedTrace: string | undefined }> = [];

    async function simulatedWork(reqId: string, traceId: string, delayMs: number) {
      await withContextIds({ req: reqId, traceId }, async () => {
        // Step 1
        expect(getRequestId()).toBe(reqId);
        expect(getTraceId()).toBe(traceId);

        // Sleep to yield and allow other concurrent tasks to interleave
        await new Promise(r => setTimeout(r, delayMs));

        // Step 2 — should still retain original context despite other tasks running
        results.push({
          id: reqId,
          observedReq: getRequestId(),
          observedTrace: getTraceId(),
        });
      });
    }

    // Launch 5 concurrent async tasks with varying delays
    await Promise.all([
      simulatedWork('req-1', 'trace-A', 50),
      simulatedWork('req-2', 'trace-B', 10),
      simulatedWork('req-3', 'trace-C', 30),
      simulatedWork('req-4', 'trace-D', 5),
      simulatedWork('req-5', 'trace-E', 40),
    ]);

    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.observedReq).toBe(r.id);
      expect(r.observedTrace).toBeDefined();
    }
  });

  it('isolates OpenTelemetry spans across concurrent requests', async () => {
    await withContextIds({ req: 'req-parent-1' }, async () => {
      const span1 = startRequestSpan('/v1/messages', 'POST');
      expect(getCurrentSpan()).toBe(span1);

      await withContextIds({ req: 'req-parent-2' }, async () => {
        const span2 = startRequestSpan('/v1/chat/completions', 'POST');
        expect(getCurrentSpan()).toBe(span2);

        const childSpan2 = startSpan('child-2');
        expect(childSpan2).toBeDefined();
      });

      // Returning to context 1
      expect(getCurrentSpan()).toBe(span1);
    });
  });
});

describe('Optimizations: RingBuffer O(1) Efficiency', () => {
  it('handles item pushes within capacity', () => {
    const rb = new RingBuffer<number>(5);
    rb.push(1);
    rb.push(2);
    rb.push(3);

    expect(rb.length).toBe(3);
    expect(rb.slice(10)).toEqual([1, 2, 3]);
  });

  it('correctly overwrites oldest items upon wrapping around', () => {
    const rb = new RingBuffer<string>(3);
    rb.push('A');
    rb.push('B');
    rb.push('C');
    expect(rb.slice(10)).toEqual(['A', 'B', 'C']);

    rb.push('D'); // overwrites A
    expect(rb.length).toBe(3);
    expect(rb.slice(10)).toEqual(['B', 'C', 'D']);

    rb.push('E'); // overwrites B
    expect(rb.slice(10)).toEqual(['C', 'D', 'E']);
  });

  it('correctly honors slice limit less than total buffered count', () => {
    const rb = new RingBuffer<number>(5);
    for (let i = 1; i <= 5; i++) rb.push(i);

    expect(rb.slice(2)).toEqual([4, 5]);
    expect(rb.slice(1)).toEqual([5]);
  });

  it('clears ring buffer correctly', () => {
    const rb = new RingBuffer<number>(3);
    rb.push(1);
    rb.push(2);
    rb.clear();
    expect(rb.length).toBe(0);
    expect(rb.slice(10)).toEqual([]);
  });
});

describe('Optimizations: Stream Cancellation Propagation', () => {
  it('cancels upstream reader when streamOpenAIToAnthropic is cancelled', async () => {
    let upstreamCancelled = false;
    let cancelReason: unknown;

    const mockUpstream = new ReadableStream<Uint8Array>({
      start() {},
      cancel(reason) {
        upstreamCancelled = true;
        cancelReason = reason;
      },
    });

    const translated = streamOpenAIToAnthropic(mockUpstream, 'gpt-5');
    const reader = translated.getReader();

    await reader.cancel('client disconnected');
    expect(upstreamCancelled).toBe(true);
    expect(cancelReason).toBe('client disconnected');
  });

  it('cancels upstream reader when streamAnthropicToOpenAI is cancelled', async () => {
    let upstreamCancelled = false;

    const mockUpstream = new ReadableStream<Uint8Array>({
      start() {},
      cancel() {
        upstreamCancelled = true;
      },
    });

    const translated = streamAnthropicToOpenAI(mockUpstream, 'claude-sonnet-4-6');
    const reader = translated.getReader();

    await reader.cancel('client abort');
    expect(upstreamCancelled).toBe(true);
  });

  it('cancels upstream reader when streamChatCompletionsToResponses is cancelled', async () => {
    let upstreamCancelled = false;

    const mockUpstream = new ReadableStream<Uint8Array>({
      start() {},
      cancel() {
        upstreamCancelled = true;
      },
    });

    const translated = streamChatCompletionsToResponses(mockUpstream, 'deepseek-v4-pro');
    const reader = translated.getReader();

    await reader.cancel('user abort');
    expect(upstreamCancelled).toBe(true);
  });
});

describe('Optimizations: Admin Auth & Security Guard', () => {
  it('allows access when ADMIN_API_KEY is not set', () => {
    const req = new Request('http://localhost/audit/log');
    expect(verifyAdminAuth(req)).toBe(true);
  });

  it('returns structured 401 unauthorizedResponse', async () => {
    const res = unauthorizedResponse('Forbidden area');
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, any>;
    expect(body.error.message).toBe('Forbidden area');
  });
});
