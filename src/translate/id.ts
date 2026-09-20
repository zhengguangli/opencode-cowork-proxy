/**
 * Synthetic ID generation for objects the proxy originates.
 *
 * WHEN TO READ THIS FILE: Changing the shape of generated message/response
 * IDs, or debugging duplicate-ID reports from clients that key rendered
 * output by these IDs.
 *
 * Upstream IDs are always forwarded verbatim; this module only covers the
 * objects the proxy has to synthesize (e.g. a non-streaming response built
 * from translated chunks).
 *
 * A bare `Date.now()` collides for two responses created in the same
 * millisecond - realistic when a client issues parallel requests that all
 * miss cache. The random suffix keeps IDs unique without a counter, which
 * matters because this runs in a shared, concurrently-executed runtime.
 */

const SUFFIX_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function randomSuffix(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += SUFFIX_ALPHABET[Math.floor(Math.random() * SUFFIX_ALPHABET.length)];
  }
  return out;
}

/** e.g. syntheticId("msg") -> "msg_m1abc2x9f3k" */
export function syntheticId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomSuffix(9)}`;
}
