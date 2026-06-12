/**
 * Upstream provider abstraction.
 *
 * WHEN TO READ THIS FILE: Adding a new upstream provider, customizing
 * provider-specific behavior (auth headers, vision models, base URLs),
 * or understanding the provider routing model.
 *
 * Architecture:
 *   UpstreamProvider (interface)
 *        ↕
 *   ProviderRegistry (keyed by name)
 *        ↕
 *   routing.ts resolves which provider handles a request
 *
 * This decouples provider-specific configuration from the routing logic.
 * To add a new provider, implement UpstreamProvider and register it.
 */
import { VISION_CAPABLE_GO, VISION_CAPABLE_ZEN, GO_VISION_MODEL, ZEN_VISION_MODEL, GO_UPSTREAM, ZEN_UPSTREAM, DEFAULT_UPSTREAM } from './config';

// ---- Provider interface ----

export interface UpstreamProvider {
  /** Unique provider name (e.g., "go", "zen") */
  name: string;
  /** Human-readable label */
  label: string;
  /** Base URL for API requests */
  baseUrl: string;
  /** Whether this is the default provider */
  isDefault: boolean;

  /** Check if a model is vision-capable */
  isVisionCapable(model: string): boolean;
  /** Get the fallback vision model for this provider */
  getVisionModel(requestedModel?: string | null): string;
  /** Build auth headers for this provider */
  buildAuthHeaders(apiKey: string): Record<string, string>;
  /** API version header, if needed */
  apiVersion?: string;
}

// ---- Built-in providers ----

const goProvider: UpstreamProvider = {
  name: 'go',
  label: 'OpenCode Go',
  baseUrl: GO_UPSTREAM,
  isDefault: true,
  isVisionCapable(model: string): boolean {
    return VISION_CAPABLE_GO.has(model);
  },
  getVisionModel(requestedModel?: string | null): string {
    if (requestedModel && VISION_CAPABLE_GO.has(requestedModel)) return requestedModel;
    return GO_VISION_MODEL;
  },
  buildAuthHeaders(apiKey: string): Record<string, string> {
    return { 'Authorization': `Bearer ${apiKey}` };
  },
};

const zenProvider: UpstreamProvider = {
  name: 'zen',
  label: 'OpenCode Zen',
  baseUrl: ZEN_UPSTREAM,
  isDefault: false,
  isVisionCapable(model: string): boolean {
    return VISION_CAPABLE_ZEN.has(model);
  },
  getVisionModel(requestedModel?: string | null): string {
    if (requestedModel && VISION_CAPABLE_ZEN.has(requestedModel)) return requestedModel;
    return ZEN_VISION_MODEL;
  },
  buildAuthHeaders(apiKey: string): Record<string, string> {
    return { 'Authorization': `Bearer ${apiKey}` };
  },
};

const anthropicCompatProvider: UpstreamProvider = {
  name: 'anthropic',
  label: 'Anthropic-Compatible',
  baseUrl: '',  // Dynamic — set via X-Upstream-Url header
  isDefault: false,
  isVisionCapable(_model: string): boolean {
    return true; // Assume Anthropic handles vision if it serves the model
  },
  getVisionModel(requestedModel?: string | null): string {
    return requestedModel || 'claude-sonnet-4-20250514';
  },
  buildAuthHeaders(apiKey: string): Record<string, string> {
    return { 'X-Api-Key': apiKey, 'Anthropic-Version': '2023-06-01' };
  },
};

// ---- Registry ----

export class ProviderRegistry {
  private providers = new Map<string, UpstreamProvider>();

  register(provider: UpstreamProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): UpstreamProvider | undefined {
    return this.providers.get(name);
  }

  getDefault(): UpstreamProvider | undefined {
    for (const provider of this.providers.values()) {
      if (provider.isDefault) return provider;
    }
    return this.providers.values().next().value;
  }

  keys(): string[] {
    return Array.from(this.providers.keys());
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * Resolve provider by URL path prefix.
   *
   * @example
   *   resolveByPrefix('/go/v1/messages')  → go provider
   *   resolveByPrefix('/zen/v1/models')   → zen provider
   *   resolveByPrefix('/v1/chat')         → default provider
   */
  resolveByPrefix(path: string): { provider: UpstreamProvider; remainingPath: string } | undefined {
    // Try exact prefix match first: /go/... → go, /zen/... → zen
    const prefixes = Array.from(this.providers.values())
      .filter(p => p.name !== 'anthropic')
      .sort((a, b) => b.name.length - a.name.length); // longer prefix first

    for (const provider of prefixes) {
      const prefix = `/${provider.name}`;
      if (path === prefix) {
        return { provider, remainingPath: '/' };
      }
      if (path.startsWith(`${prefix}/`)) {
        return { provider, remainingPath: path.slice(prefix.length) };
      }
    }

    // Fall back to default
    const defaultProvider = this.getDefault();
    if (defaultProvider) {
      return { provider: defaultProvider, remainingPath: path };
    }

    return undefined;
  }

  clear(): void {
    this.providers.clear();
  }
}

// ---- Singleton ----

/** Global provider registry instance. */
export const providerRegistry = new ProviderRegistry();

/**
 * Register all built-in providers.
 * Call once at startup before handling requests.
 */
export function registerBuiltinProviders(): void {
  providerRegistry.register(goProvider);
  providerRegistry.register(zenProvider);
  providerRegistry.register(anthropicCompatProvider);
}

let providersInitialized = false;
export function ensureProvidersRegistered(): void {
  if (!providersInitialized) {
    registerBuiltinProviders();
    providersInitialized = true;
  }
}
