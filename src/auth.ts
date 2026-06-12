/**
 * API key extraction, format validation, and structured error responses.
 *
 * WHEN TO READ THIS FILE: Changing authentication logic, adding a new key source,
 * modifying key validation rules, or debugging 401 errors.
 *
 * Pure functions with no runtime dependencies (testable without CF Workers).
 *
 * Key format validation:
 *   - OpenCode API keys: typically start with "sk-" or "pk-" and are 32+ chars
 *   - Anthropic API keys: start with "sk-ant-" and are 40+ chars
 *   - Generic keys: at least 32 chars of base64-like characters
 */

const KEY_PATTERN = /^[A-Za-z0-9_-]{32,}$/;
const OPENCODE_KEY_PATTERN = /^(sk-|pk-)[A-Za-z0-9_-]{29,}$/;
const ANTHROPIC_KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{35,}$/;

export function extractApiKey(headers: Headers | Record<string, string | null>): string | null {
  const get = (name: string) => {
    if (headers instanceof Headers) return headers.get(name);
    const record = headers as Record<string, string | null>;
    return record[name] || record[name.toLowerCase()] || null;
  };
  return get("X-Api-Key") || get("Authorization")?.replace(/^(Bearer|Token)\s+/i, "")?.trim() || null;
}

interface AuthError {
  status: number;
  body: Record<string, unknown>;
}

export function validateApiKey(key: string | null): AuthError | null {
  if (!key) {
    return {
      status: 401,
      body: { error: { type: "authentication_error", message: "Missing API key. Provide X-Api-Key header." } },
    };
  }

  // Length check
  if (key.length < 32) {
    return {
      status: 401,
      body: { error: { type: "authentication_error", message: "Invalid API key: must be at least 32 characters." } },
    };
  }

  // Format check: must be valid base64url characters
  if (!KEY_PATTERN.test(key)) {
    return {
      status: 401,
      body: {
        error: {
          type: "authentication_error",
          message: "Invalid API key format: key contains invalid characters. Expected base64url (A-Z, a-z, 0-9, -, _).",
        },
      },
    };
  }

  return null;
}

/**
 * Identify the key type based on its prefix pattern.
 * Returns a human-readable label for logging/audit.
 */
export function identifyKeyType(key: string): string {
  if (ANTHROPIC_KEY_PATTERN.test(key)) return "anthropic";
  if (OPENCODE_KEY_PATTERN.test(key)) return "opencode";
  if (key.length >= 40) return "generic-long";
  return "generic";
}

export function authErrorResponse(err: AuthError, path?: string): Response {
  const isAnthropicPath = path === '/v1/messages' || path === '/v1/models';
  const body = isAnthropicPath
    ? { type: "error", error: err.body.error }
    : err.body;
  return new Response(JSON.stringify(body), {
    status: err.status,
    headers: { "Content-Type": "application/json" },
  });
}
