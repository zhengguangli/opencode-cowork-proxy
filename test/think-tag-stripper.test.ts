/**
 * Tests for think-tag-stripper utilities.
 *
 * Covers:
 *   - stripThinkTags() — non-streaming regex-based stripping
 *   - ThinkTagStripper — stateful streaming stripper (handles tags split across chunks)
 *
 * See docs/FIXES.md §Fix 1 for the minimax-m3-free background.
 */
import { describe, it, expect } from 'vitest';
import { stripThinkTags, ThinkTagStripper } from '../src/think-tag-stripper';

// ─── stripThinkTags (non-streaming) ────────────────────────────────────────

describe('stripThinkTags (non-streaming)', () => {
  it('strips a complete <think> block from the middle of text', () => {
    const input = 'Hello<think>internal reasoning</think> World';
    expect(stripThinkTags(input)).toBe('Hello World');
  });

  it('strips <think> block at the beginning', () => {
    const input = '<think>deep thought</think>Result';
    expect(stripThinkTags(input)).toBe('Result');
  });

  it('strips <think> block at the end', () => {
    const input = 'Answer<think>reasoning</think>';
    expect(stripThinkTags(input)).toBe('Answer');
  });

  it('returns empty string when entire content is a think block', () => {
    const input = '<think>just reasoning</think>';
    expect(stripThinkTags(input)).toBe('');
  });

  it('handles no think tags (pass-through)', () => {
    const input = 'Hello World';
    expect(stripThinkTags(input)).toBe('Hello World');
  });

  it('handles empty string', () => {
    expect(stripThinkTags('')).toBe('');
  });

  it('strips think blocks with newlines inside', () => {
    const input = 'Hello<think>\nmulti\nline\nreasoning\n</think> World';
    expect(stripThinkTags(input)).toBe('Hello World');
  });

  it('strips multiple think blocks', () => {
    const input = '<think>first</think>text1<think>second</think>text2';
    // stripThinkTags removes the blocks and trims — no space injected between blocks
    expect(stripThinkTags(input)).toBe('text1text2');
  });

  it('trims whitespace around the result', () => {
    const input = '<think>reasoning</think>   ';
    expect(stripThinkTags(input)).toBe('');
  });

  it('handles empty think tag (no content inside)', () => {
    const input = '<think></think>result';
    expect(stripThinkTags(input)).toBe('result');
  });
});

// ─── ThinkTagStripper (streaming) ──────────────────────────────────────────

describe('ThinkTagStripper (streaming)', () => {
  it('passes through text with no think tags', () => {
    const stripper = new ThinkTagStripper();
    expect(stripper.strip('Hello World')).toBe('Hello World');
  });

  it('strips a think block entirely within a single chunk', () => {
    const stripper = new ThinkTagStripper();
    expect(stripper.strip('Hello<think>deep thought</think>World')).toBe('HelloWorld');
  });

  it('strips think block where <think> and content are in one chunk, </think> in next', () => {
    // Chunk 1: opening tag + content, no closing tag yet
    const stripper = new ThinkTagStripper();
    expect(stripper.strip('before<think>content continues')).toBe('before');
    // Chunk 2: content continues + closing tag + after-text
    expect(stripper.strip('and ends</think>after')).toBe('after');
  });

  it('strips think block where entire tag is in one chunk followed by more text', () => {
    const stripper = new ThinkTagStripper();
    expect(stripper.strip('hello<think>content</think> world')).toBe('hello world');
  });

  it('handles content that continues across multiple chunks inside a think tag', () => {
    // Chunk 1: text before tag + opening tag + partial content
    const stripper = new ThinkTagStripper();
    expect(stripper.strip('Hello<think>deep')).toBe('Hello');
    // Chunk 2: rest of content + closing tag + after-text
    expect(stripper.strip(' thought</think>World')).toBe('World');
  });

  it('strips tag that starts with no preceding text in first chunk', () => {
    const stripper = new ThinkTagStripper();
    expect(stripper.strip('<think>deep')).toBeNull();
    expect(stripper.strip(' thought</think>World')).toBe('World');
  });

  it('returns null when entire chunk is inside a think tag', () => {
    const stripper = new ThinkTagStripper();
    expect(stripper.strip('Hello<think>deep thought')).toBe('Hello');
    expect(stripper.strip('still thinking')).toBeNull();
    expect(stripper.strip('</think>World')).toBe('World');
  });

  it('handles multiple think blocks in sequence', () => {
    const stripper = new ThinkTagStripper();
    // Entire chunk is a think block → result is empty → returns null
    expect(stripper.strip('<think>first</think>')).toBeNull();
    // Second chunk: text followed by second think block
    expect(stripper.strip('middle<think>second</think>')).toBe('middle');
    expect(stripper.strip('end')).toBe('end');
  });

  it('handles empty string', () => {
    const stripper = new ThinkTagStripper();
    expect(stripper.strip('')).toBe('');
  });

  it('handles text with no think tags across multiple chunks', () => {
    const stripper = new ThinkTagStripper();
    expect(stripper.strip('Hello ')).toBe('Hello ');
    expect(stripper.strip('World ')).toBe('World ');
    expect(stripper.strip('Foo')).toBe('Foo');
  });

  it('handles adjacent think blocks', () => {
    const stripper = new ThinkTagStripper();
    // <think>first</think><think>second</think>text
    expect(stripper.strip('<think>first</think><think>second</think>text')).toBe('text');
  });

  it('handles empty think block (<think></think>) in a chunk', () => {
    const stripper = new ThinkTagStripper();
    // Empty think block → result is empty → returns null
    expect(stripper.strip('before<think></think>after')).toBe('beforeafter');
  });

  it('strips think block, then emits subsequent text normally', () => {
    const stripper = new ThinkTagStripper();
    expect(stripper.strip('<think>secret</think>visible')).toBe('visible');
    expect(stripper.strip(' more')).toBe(' more');
  });
});
