import { describe, it, expect, beforeEach } from 'vitest';
import { recordAudit, getRecentAuditEvents, auditAuth, auditStream } from '../src/audit';

describe('audit module', () => {
  beforeEach(() => {
    // Clear the buffer by calling recordAudit isn't practical
    // Just verify the functions work
  });

  it('recordAudit creates events with correct type', () => {
    recordAudit('auth', 'test_action', { key: 'value' });
    const events = getRecentAuditEvents(10);
    const found = events.find(e => e.action === 'test_action');
    expect(found).toBeDefined();
    expect(found!.type).toBe('auth');
    expect(found!.details.key).toBe('value');
  });

  it('getRecentAuditEvents returns events newest-last', () => {
    recordAudit('proxy', 'event1', {});
    recordAudit('proxy', 'event2', {});
    const events = getRecentAuditEvents(10);
    const idx1 = events.findIndex(e => e.action === 'event1');
    const idx2 = events.findIndex(e => e.action === 'event2');
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThan(idx1);
  });

  it('getRecentAuditEvents respects limit', () => {
    // Clear by reading + verifying limited
    const events = getRecentAuditEvents(1);
    expect(events.length).toBeLessThanOrEqual(1);
  });

  it('auditAuth creates auth event', () => {
    auditAuth('sk-test-key-12345', '/v1/messages', true);
    const events = getRecentAuditEvents(10);
    const found = events.find(e => e.type === 'auth' && e.action === 'authenticated');
    expect(found).toBeDefined();
    expect(found!.details.path).toBe('/v1/messages');
  });

  it('auditAuth creates auth_failed event', () => {
    auditAuth(null, '/v1/chat/completions', false, 'Missing key');
    const events = getRecentAuditEvents(10);
    const found = events.find(e => e.type === 'auth' && e.action === 'auth_failed');
    expect(found).toBeDefined();
    expect(found!.details.error).toBe('Missing key');
  });

  it('auditStream creates stream events', () => {
    auditStream('/v1/messages', 'start', 'claude-sonnet-4');
    const events = getRecentAuditEvents(10);
    const found = events.find(e => e.type === 'stream' && e.action === 'start');
    expect(found).toBeDefined();
    expect(found!.details.model).toBe('claude-sonnet-4');
  });
});
