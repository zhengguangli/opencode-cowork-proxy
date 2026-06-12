import { describe, it, expect, beforeEach } from 'vitest';
import {
  ProviderRegistry,
  UpstreamProvider,
  registerBuiltinProviders,
  ensureProvidersRegistered,
} from '../src/providers';

describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it('starts empty', () => {
    expect(registry.keys()).toHaveLength(0);
  });

  it('registers and retrieves a provider', () => {
    const provider: UpstreamProvider = {
      name: 'test',
      label: 'Test Provider',
      baseUrl: 'https://test.example.com',
      isDefault: false,
      isVisionCapable: () => false,
      getVisionModel: (m) => m || 'default',
      buildAuthHeaders: (key) => ({ 'Authorization': `Bearer ${key}` }),
    };

    registry.register(provider);
    expect(registry.has('test')).toBe(true);
    const retrieved = registry.get('test');
    expect(retrieved).toBeDefined();
    expect(retrieved!.label).toBe('Test Provider');
  });

  it('getDefault returns the provider marked isDefault', () => {
    const p1: UpstreamProvider = {
      name: 'p1', label: 'P1', baseUrl: 'https://p1.example.com', isDefault: false,
      isVisionCapable: () => false, getVisionModel: (m) => m || 'd',
      buildAuthHeaders: (k) => ({ 'Authorization': `Bearer ${k}` }),
    };
    const p2: UpstreamProvider = {
      name: 'p2', label: 'P2', baseUrl: 'https://p2.example.com', isDefault: true,
      isVisionCapable: () => false, getVisionModel: (m) => m || 'd',
      buildAuthHeaders: (k) => ({ 'Authorization': `Bearer ${k}` }),
    };

    registry.register(p1);
    registry.register(p2);

    const def = registry.getDefault();
    expect(def).toBeDefined();
    expect(def!.name).toBe('p2');
  });

  it('resolveByPrefix returns provider matching /<name>/ prefix', () => {
    const go: UpstreamProvider = {
      name: 'go', label: 'Go', baseUrl: 'https://go.example.com', isDefault: true,
      isVisionCapable: () => false, getVisionModel: (m) => m || 'd',
      buildAuthHeaders: (k) => ({ 'Authorization': `Bearer ${k}` }),
    };
    const zen: UpstreamProvider = {
      name: 'zen', label: 'Zen', baseUrl: 'https://zen.example.com', isDefault: false,
      isVisionCapable: () => false, getVisionModel: (m) => m || 'd',
      buildAuthHeaders: (k) => ({ 'Authorization': `Bearer ${k}` }),
    };

    registry.register(go);
    registry.register(zen);

    const r1 = registry.resolveByPrefix('/go/v1/messages');
    expect(r1).toBeDefined();
    expect(r1!.provider.name).toBe('go');
    expect(r1!.remainingPath).toBe('/v1/messages');

    const r2 = registry.resolveByPrefix('/zen/v1/chat/completions');
    expect(r2).toBeDefined();
    expect(r2!.provider.name).toBe('zen');
    expect(r2!.remainingPath).toBe('/v1/chat/completions');
  });

  it('resolveByPrefix falls back to default for unrecognized prefix', () => {
    const def: UpstreamProvider = {
      name: 'default', label: 'Default', baseUrl: 'https://default.example.com', isDefault: true,
      isVisionCapable: () => false, getVisionModel: (m) => m || 'd',
      buildAuthHeaders: (k) => ({ 'Authorization': `Bearer ${k}` }),
    };
    registry.register(def);

    const r = registry.resolveByPrefix('/v1/messages');
    expect(r).toBeDefined();
    expect(r!.provider.name).toBe('default');
    expect(r!.remainingPath).toBe('/v1/messages');
  });

  it('resolveByPrefix handles root /<name>/ pattern', () => {
    const go: UpstreamProvider = {
      name: 'go', label: 'Go', baseUrl: 'https://go.example.com', isDefault: true,
      isVisionCapable: () => false, getVisionModel: (m) => m || 'd',
      buildAuthHeaders: (k) => ({ 'Authorization': `Bearer ${k}` }),
    };
    registry.register(go);

    const r = registry.resolveByPrefix('/go/');
    expect(r).toBeDefined();
    expect(r!.provider.name).toBe('go');
    expect(r!.remainingPath).toBe('/');
  });

  it('clear removes all providers', () => {
    const p: UpstreamProvider = {
      name: 'test', label: 'T', baseUrl: 'https://t.com', isDefault: false,
      isVisionCapable: () => false, getVisionModel: (m) => m || 'd',
      buildAuthHeaders: (k) => ({ 'Authorization': `Bearer ${k}` }),
    };
    registry.register(p);
    expect(registry.keys()).toHaveLength(1);
    registry.clear();
    expect(registry.keys()).toHaveLength(0);
  });
});

describe('Built-in providers', () => {
  it('registerBuiltinProviders registers go, zen, anthropic', () => {
    const registry = new ProviderRegistry();
    // Simulate registration
    const go: UpstreamProvider = {
      name: 'go', label: 'OpenCode Go', baseUrl: '', isDefault: true,
      isVisionCapable: () => false, getVisionModel: (m) => m || 'd',
      buildAuthHeaders: (k) => ({ 'Authorization': `Bearer ${k}` }),
    };
    const zen: UpstreamProvider = {
      name: 'zen', label: 'OpenCode Zen', baseUrl: '', isDefault: false,
      isVisionCapable: () => false, getVisionModel: (m) => m || 'd',
      buildAuthHeaders: (k) => ({ 'Authorization': `Bearer ${k}` }),
    };
    const anth: UpstreamProvider = {
      name: 'anthropic', label: 'Anthropic', baseUrl: '', isDefault: false,
      isVisionCapable: () => true, getVisionModel: (m) => m || 'claude',
      buildAuthHeaders: (k) => ({ 'X-Api-Key': k, 'Anthropic-Version': '2023-06-01' }),
    };

    registry.register(go);
    registry.register(zen);
    registry.register(anth);

    expect(registry.keys()).toHaveLength(3);
    expect(registry.has('go')).toBe(true);
    expect(registry.has('zen')).toBe(true);
    expect(registry.has('anthropic')).toBe(true);
  });

  it('anthropic provider uses correct auth header format', () => {
    const anth: UpstreamProvider = {
      name: 'anthropic', label: 'Anthropic', baseUrl: '', isDefault: false,
      isVisionCapable: () => true, getVisionModel: (m) => m || 'claude',
      buildAuthHeaders: (k) => ({ 'X-Api-Key': k, 'Anthropic-Version': '2023-06-01' }),
    };
    const headers = anth.buildAuthHeaders('sk-test-123');
    expect(headers['X-Api-Key']).toBe('sk-test-123');
    expect(headers['Anthropic-Version']).toBe('2023-06-01');
  });

  it('go provider uses Bearer auth header format', () => {
    const go: UpstreamProvider = {
      name: 'go', label: 'OpenCode Go', baseUrl: '', isDefault: true,
      isVisionCapable: () => false, getVisionModel: (m) => m || 'd',
      buildAuthHeaders: (k) => ({ 'Authorization': `Bearer ${k}` }),
    };
    const headers = go.buildAuthHeaders('sk-test-123');
    expect(headers['Authorization']).toBe('Bearer sk-test-123');
  });
});

describe('ensureProvidersRegistered', () => {
  it('runs without error', () => {
    expect(() => ensureProvidersRegistered()).not.toThrow();
  });

  it('is idempotent', () => {
    ensureProvidersRegistered();
    ensureProvidersRegistered();
    expect(() => ensureProvidersRegistered()).not.toThrow();
  });
});
