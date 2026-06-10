/**
 * Image detection and vision model selection across 3 API formats.
 *
 * WHEN TO READ THIS FILE: Adding a new API format's image support,
 * debugging vision model routing, or updating getVisionModel logic.
 *
 * FUNCTION QUICK REFERENCE:
 *   hasImages(body)              — Anthropic Messages format (type:"image")
 *   hasOpenAIImages(body)        — OpenAI Chat Completions format (type:"image_url")
 *   hasResponsesImages(body)     — OpenAI Responses API format (type:"input_image"/"image_url")
 *   hasAnyImageInMessages(body)  — Generic: both "image" and "image_url" (used in pass-through paths)
 *   rawBodyMayHaveImages(raw)    — Fast pre-check: string scan before full JSON parse
 *   getVisionModel(upstream, model) — Returns vision-capable model or upstream default
 */

import { VISION_CAPABLE_GO, VISION_CAPABLE_ZEN, GO_VISION_MODEL, ZEN_VISION_MODEL } from './config';

export function getVisionModel(upstream: string, requestedModel?: string | null): string {
  if (requestedModel) {
    if (upstream.includes("/zen/go") && VISION_CAPABLE_GO.has(requestedModel)) return requestedModel;
    if (upstream.includes("/zen") && !upstream.includes("/zen/go") && VISION_CAPABLE_ZEN.has(requestedModel)) return requestedModel;
  }
  if (upstream.includes("/zen/go")) return GO_VISION_MODEL;
  if (upstream.includes("/zen")) return ZEN_VISION_MODEL;
  return GO_VISION_MODEL;
}

export function hasImages(body: Record<string, unknown>): boolean {
  const messages = body?.messages;
  if (Array.isArray(messages) && messages.some((msg: Record<string, unknown>) =>
    Array.isArray(msg.content) && (msg.content as Record<string, unknown>[]).some((part: Record<string, unknown>) => part.type === "image")
  )) return true;
  const system = body?.system;
  if (Array.isArray(system)) {
    return system.some((part: Record<string, unknown>) => part.type === "image");
  }
  return false;
}

export function hasResponsesImages(body: Record<string, unknown>): boolean {
  const input = body?.input;
  if (!Array.isArray(input)) return false;
  return input.some((item: Record<string, unknown>) =>
    item.type === "message" && Array.isArray(item.content) &&
    (item.content as Record<string, unknown>[]).some((part: Record<string, unknown>) => part.type === "input_image" || part.type === "image_url")
  );
}

export function hasOpenAIImages(body: Record<string, unknown>): boolean {
  const messages = body?.messages;
  if (Array.isArray(messages) && messages.some((msg: Record<string, unknown>) => {
    if (typeof msg.content === "string") return false;
    if (Array.isArray(msg.content)) {
      return (msg.content as Record<string, unknown>[]).some((part: Record<string, unknown>) => part.type === "image_url");
    }
    return false;
  })) return true;
  const system = body?.system;
  if (Array.isArray(system)) {
    return system.some((part: Record<string, unknown>) => part.type === "image_url");
  }
  return false;
}

export function rawBodyMayHaveImages(rawBody: string): boolean {
  return rawBody.includes('"image_url"') ||
    rawBody.includes('"input_image"') ||
    rawBody.includes('"type":"image"') ||
    rawBody.includes('"type": "image"');
}

export function hasAnyImageInMessages(body: Record<string, unknown>): boolean {
  const messages = body?.messages;
  if (Array.isArray(messages)) {
    const hasInMessages = messages.some((msg: Record<string, unknown>) => {
      if (typeof msg.content === "string") return false;
      if (!Array.isArray(msg.content)) return false;
      return (msg.content as Record<string, unknown>[]).some(
        (part: Record<string, unknown>) => part.type === "image" || part.type === "image_url"
      );
    });
    if (hasInMessages) return true;
  }
  const system = body?.system;
  if (Array.isArray(system)) {
    return system.some(
      (part: Record<string, unknown>) => part.type === "image" || part.type === "image_url"
    );
  }
  return false;
}
