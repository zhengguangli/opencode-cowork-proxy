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

export function hasImages(body: any): boolean {
  const messages = body?.messages;
  if (Array.isArray(messages) && messages.some((msg: any) =>
    Array.isArray(msg.content) && msg.content.some((part: any) => part.type === "image")
  )) return true;
  const system = body?.system;
  if (Array.isArray(system)) {
    return system.some((part: any) => part.type === "image");
  }
  return false;
}

export function hasResponsesImages(body: any): boolean {
  const input = body?.input;
  if (!Array.isArray(input)) return false;
  return input.some((item: any) =>
    item.type === "message" && Array.isArray(item.content) &&
    item.content.some((part: any) => part.type === "input_image" || part.type === "image_url")
  );
}

export function hasOpenAIImages(body: any): boolean {
  const messages = body?.messages;
  if (Array.isArray(messages) && messages.some((msg: any) => {
    if (typeof msg.content === "string") return false;
    if (Array.isArray(msg.content)) {
      return msg.content.some((part: any) => part.type === "image_url");
    }
    return false;
  })) return true;
  const system = body?.system;
  if (Array.isArray(system)) {
    return system.some((part: any) => part.type === "image_url");
  }
  return false;
}

export function rawBodyMayHaveImages(rawBody: string): boolean {
  return rawBody.includes('"image_url"') ||
    rawBody.includes('"input_image"') ||
    rawBody.includes('"type":"image"') ||
    rawBody.includes('"type": "image"');
}

export function hasAnyImageInMessages(body: any): boolean {
  const messages = body?.messages;
  if (Array.isArray(messages)) {
    const hasInMessages = messages.some((msg: any) => {
      if (typeof msg.content === "string") return false;
      if (!Array.isArray(msg.content)) return false;
      return msg.content.some(
        (part: any) => part.type === "image" || part.type === "image_url"
      );
    });
    if (hasInMessages) return true;
  }
  const system = body?.system;
  if (Array.isArray(system)) {
    return system.some(
      (part: any) => part.type === "image" || part.type === "image_url"
    );
  }
  return false;
}
