/**
 * API key extraction and validation.
 * Pure functions with no runtime dependencies (testable without CF Workers).
 */

export function extractApiKey(headers: Headers | Record<string, string | null>): string | null {
  const get = (name: string) => {
    if (headers instanceof Headers) return headers.get(name);
    // Handle both original-case and lowercase keys in Record objects
    const record = headers as Record<string, string | null>;
    return record[name] || record[name.toLowerCase()] || null;
  };
  return get("X-Api-Key") || get("Authorization")?.replace(/^(Bearer|Token)\s+/i, "")?.trim() || null;
}

export interface AuthError {
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
  if (key.length < 32) {
    return {
      status: 401,
      body: { error: { type: "authentication_error", message: "Invalid API key: must be at least 32 characters." } },
    };
  }
  return null;
}

export function authErrorResponse(err: AuthError, path?: string): Response {
  // Anthropic clients (hitting /v1/messages or /v1/models with anthropic fmt) expect
  // { type: "error", error: { ... } } wrapper. Other paths use OpenAI format.
  const isAnthropicPath = path === '/v1/messages' || path === '/v1/models';
  const body = isAnthropicPath
    ? { type: "error", error: err.body.error }
    : err.body;
  return new Response(JSON.stringify(body), {
    status: err.status,
    headers: { "Content-Type": "application/json" },
  });
}
