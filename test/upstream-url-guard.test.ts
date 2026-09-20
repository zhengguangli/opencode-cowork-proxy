/**
 * Regression tests for the X-Upstream-Url guard.
 *
 * Security context: the X-Upstream-Url header is untrusted client input used
 * to point the proxy at a custom endpoint. Before this guard, any syntactically
 * valid URL was accepted, which let a caller holding a well-formed API key
 * relay requests to arbitrary addresses (SSRF): loopback services, private
 * networks and the cloud metadata endpoint.
 *
 * These tests lock in the guard so the deployment cannot regress into an open
 * relay.
 */
import { describe, it, expect } from 'bun:test';
import { getUpstream, isAllowedUpstreamUrl } from '../src/routing';
import { GO_UPSTREAM } from '../src/config';

const NO_ALLOWLIST = new Set<string>();

function req(url: string): Request {
  return new Request('http://localhost/v1/messages', { headers: { 'X-Upstream-Url': url } });
}

describe('isAllowedUpstreamUrl - accepted', () => {
  it('accepts a public https host', () => {
    expect(isAllowedUpstreamUrl('https://api.anthropic.com', NO_ALLOWLIST)).toBe(true);
  });

  it('accepts a public https host with a path and port', () => {
    expect(isAllowedUpstreamUrl('https://custom.example.com:8443/v1', NO_ALLOWLIST)).toBe(true);
  });

  it('accepts a public IP literal', () => {
    expect(isAllowedUpstreamUrl('https://93.184.216.34', NO_ALLOWLIST)).toBe(true);
  });
});

describe('isAllowedUpstreamUrl - scheme', () => {
  it('rejects plain http', () => {
    expect(isAllowedUpstreamUrl('http://api.anthropic.com', NO_ALLOWLIST)).toBe(false);
  });

  it('rejects non-http schemes', () => {
    expect(isAllowedUpstreamUrl('file:///etc/passwd', NO_ALLOWLIST)).toBe(false);
    expect(isAllowedUpstreamUrl('gopher://example.com', NO_ALLOWLIST)).toBe(false);
  });

  it('rejects a malformed URL', () => {
    expect(isAllowedUpstreamUrl('not-a-valid-url', NO_ALLOWLIST)).toBe(false);
  });
});

describe('isAllowedUpstreamUrl - loopback and private networks', () => {
  it('rejects the cloud metadata endpoint', () => {
    expect(isAllowedUpstreamUrl('http://169.254.169.254/latest/meta-data/', NO_ALLOWLIST)).toBe(false);
    expect(isAllowedUpstreamUrl('https://169.254.169.254/', NO_ALLOWLIST)).toBe(false);
  });

  it('rejects IPv4 loopback and RFC1918 ranges', () => {
    for (const host of ['127.0.0.1', '127.8.9.9', '10.1.2.3', '172.16.0.5', '172.31.255.255', '192.168.1.1', '0.0.0.0']) {
      expect(isAllowedUpstreamUrl(`https://${host}`, NO_ALLOWLIST)).toBe(false);
    }
  });

  it('rejects CGNAT, TEST-NET-1 and multicast/reserved ranges', () => {
    for (const host of ['100.64.0.1', '100.127.255.255', '192.0.2.10', '224.0.0.1', '240.0.0.1']) {
      expect(isAllowedUpstreamUrl(`https://${host}`, NO_ALLOWLIST)).toBe(false);
    }
  });

  it('accepts the public ranges adjacent to private ones', () => {
    for (const host of ['172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1', '169.253.0.1', '223.255.255.255']) {
      expect(isAllowedUpstreamUrl(`https://${host}`, NO_ALLOWLIST)).toBe(true);
    }
  });

  it('rejects localhost hostnames', () => {
    expect(isAllowedUpstreamUrl('https://localhost', NO_ALLOWLIST)).toBe(false);
    expect(isAllowedUpstreamUrl('https://api.localhost', NO_ALLOWLIST)).toBe(false);
  });

  it('rejects IPv6 loopback, unique-local and link-local literals', () => {
    expect(isAllowedUpstreamUrl('https://[::1]', NO_ALLOWLIST)).toBe(false);
    expect(isAllowedUpstreamUrl('https://[::]', NO_ALLOWLIST)).toBe(false);
    expect(isAllowedUpstreamUrl('https://[fc00::1]', NO_ALLOWLIST)).toBe(false);
    expect(isAllowedUpstreamUrl('https://[fd12:3456::1]', NO_ALLOWLIST)).toBe(false);
    expect(isAllowedUpstreamUrl('https://[fe80::1]', NO_ALLOWLIST)).toBe(false);
  });

  it('rejects IPv4-mapped IPv6 literals that hide a private address', () => {
    expect(isAllowedUpstreamUrl('https://[::ffff:127.0.0.1]', NO_ALLOWLIST)).toBe(false);
    expect(isAllowedUpstreamUrl('https://[::ffff:169.254.169.254]', NO_ALLOWLIST)).toBe(false);
  });

  it('accepts a public IPv6 literal', () => {
    expect(isAllowedUpstreamUrl('https://[2606:4700:4700::1111]', NO_ALLOWLIST)).toBe(true);
  });
});

describe('isAllowedUpstreamUrl - allowlist', () => {
  it('accepts an allowlisted host, case-insensitively', () => {
    const allow = new Set(['api.anthropic.com']);
    expect(isAllowedUpstreamUrl('https://API.Anthropic.com', allow)).toBe(true);
  });

  it('rejects a host that is not allowlisted', () => {
    const allow = new Set(['api.anthropic.com']);
    expect(isAllowedUpstreamUrl('https://api.openai.com', allow)).toBe(false);
  });

  it('does not treat a suffix match as allowlisted', () => {
    const allow = new Set(['example.com']);
    expect(isAllowedUpstreamUrl('https://evil-example.com', allow)).toBe(false);
  });
});

describe('getUpstream fallback contract', () => {
  it('returns routeUpstream when no header is present', () => {
    const r = new Request('http://localhost/v1/messages');
    expect(getUpstream(r, GO_UPSTREAM)).toBe(GO_UPSTREAM);
  });

  it('returns the header when it is a public https host', () => {
    expect(getUpstream(req('https://custom.example.com'), GO_UPSTREAM)).toBe('https://custom.example.com');
  });

  it('falls back to routeUpstream for a malformed header', () => {
    expect(getUpstream(req('not-a-valid-url'), GO_UPSTREAM)).toBe(GO_UPSTREAM);
  });

  it('falls back to routeUpstream instead of relaying to loopback', () => {
    expect(getUpstream(req('http://169.254.169.254/latest/meta-data/'), GO_UPSTREAM)).toBe(GO_UPSTREAM);
    expect(getUpstream(req('http://127.0.0.1:8787/internal'), GO_UPSTREAM)).toBe(GO_UPSTREAM);
    expect(getUpstream(req('https://localhost:8443'), GO_UPSTREAM)).toBe(GO_UPSTREAM);
  });

  it('honours an explicit allowlist passed by the caller', () => {
    const allow = new Set(['api.anthropic.com']);
    expect(getUpstream(req('https://api.anthropic.com'), GO_UPSTREAM, allow)).toBe('https://api.anthropic.com');
    expect(getUpstream(req('https://api.openai.com'), GO_UPSTREAM, allow)).toBe(GO_UPSTREAM);
  });
});

describe('additional reserved IPv4 segments', () => {
  const cases: Array<[string, boolean]> = [
    ['https://192.0.0.9', false],        // IETF protocol assignments
    ['https://192.0.1.1', true],         // adjacent public space
    ['https://198.18.0.105', false],     // benchmarking
    ['https://198.19.255.255', false],
    ['https://198.20.0.1', true],
    ['https://198.51.100.7', false],     // TEST-NET-2
    ['https://203.0.113.7', false],      // TEST-NET-3
    ['https://203.0.114.7', true],
  ];
  for (const [url, expected] of cases) {
    it(`${url} -> ${expected ? 'allowed' : 'rejected'}`, () => {
      expect(isAllowedUpstreamUrl(url, NO_ALLOWLIST)).toBe(expected);
    });
  }
});

describe('additional reserved IPv6 segments', () => {
  it('rejects ff00::/8 multicast', () => {
    expect(isAllowedUpstreamUrl('https://[ff02::1]', NO_ALLOWLIST)).toBe(false);
  });
  it('rejects fec0:: site-local even though fe80::/10 is reported separately', () => {
    expect(isAllowedUpstreamUrl('https://[fec0::1]', NO_ALLOWLIST)).toBe(false);
  });
  it('rejects 2002::/16 6to4 that encodes 127.0.0.1', () => {
    expect(isAllowedUpstreamUrl('https://[2002:7f00:1::]', NO_ALLOWLIST)).toBe(false);
  });
  it('rejects 2002::/16 6to4 that encodes 169.254.169.254', () => {
    expect(isAllowedUpstreamUrl('https://[2002:a9fe:a9fe::]', NO_ALLOWLIST)).toBe(false);
  });
  it('still allows a public IPv6 address', () => {
    expect(isAllowedUpstreamUrl('https://[2606:4700:4700::1111]', NO_ALLOWLIST)).toBe(true);
  });
});

describe('root-label (trailing-dot) hostnames', () => {
  it('rejects "localhost." - WHATWG keeps the dot, it is the same host', () => {
    expect(isAllowedUpstreamUrl('https://localhost.:8443', NO_ALLOWLIST)).toBe(false);
  });
  it('rejects "app.localhost."', () => {
    expect(isAllowedUpstreamUrl('https://app.localhost.', NO_ALLOWLIST)).toBe(false);
  });
  it('accepts a public host with a trailing dot', () => {
    expect(isAllowedUpstreamUrl('https://custom.example.com.', NO_ALLOWLIST)).toBe(true);
  });
  it('matches a trailing-dot host against an allowlist entry', () => {
    const allow = new Set(['custom.example.com']);
    expect(isAllowedUpstreamUrl('https://custom.example.com.', allow)).toBe(true);
  });
});

describe('allowlist precedence over the private-address rules', () => {
  it('trusts an explicitly allowlisted loopback host', () => {
    const allow = new Set(['127.0.0.1']);
    expect(isAllowedUpstreamUrl('https://127.0.0.1:8443', allow)).toBe(true);
    expect(getUpstream(req('https://127.0.0.1:8443'), GO_UPSTREAM, allow)).toBe('https://127.0.0.1:8443');
  });

  it('trusts an explicitly allowlisted internal hostname', () => {
    const allow = new Set(['upstream.internal.example']);
    expect(isAllowedUpstreamUrl('https://upstream.internal.example', allow)).toBe(true);
  });

  it('still blocks everything else when an allowlist is set', () => {
    const allow = new Set(['127.0.0.1']);
    expect(isAllowedUpstreamUrl('https://10.0.0.5', allow)).toBe(false);
    expect(isAllowedUpstreamUrl('https://api.openai.com', allow)).toBe(false);
  });

  it('still requires https even for an allowlisted host', () => {
    const allow = new Set(['127.0.0.1']);
    expect(isAllowedUpstreamUrl('http://127.0.0.1:8787/health', allow)).toBe(false);
  });
});

describe('UPSTREAM_ALLOW_PRIVATE escape hatch', () => {
  it('allows private addresses only when opted in', () => {
    expect(isAllowedUpstreamUrl('https://127.0.0.1:8443', NO_ALLOWLIST, false)).toBe(false);
    expect(isAllowedUpstreamUrl('https://127.0.0.1:8443', NO_ALLOWLIST, true)).toBe(true);
  });

  it('does not waive the https requirement', () => {
    expect(isAllowedUpstreamUrl('http://169.254.169.254/latest/meta-data/', NO_ALLOWLIST, true)).toBe(false);
  });

  it('does not waive the allowlist when one is configured', () => {
    const allow = new Set(['api.anthropic.com']);
    expect(isAllowedUpstreamUrl('https://127.0.0.1:8443', allow, true)).toBe(false);
  });

  it('does not waive localhost hostname rejection', () => {
    expect(isAllowedUpstreamUrl('https://localhost:8443', NO_ALLOWLIST, true)).toBe(false);
  });

  it('propagates through getUpstream', () => {
    expect(getUpstream(req('https://127.0.0.1:8443'), GO_UPSTREAM, NO_ALLOWLIST, true)).toBe('https://127.0.0.1:8443');
    expect(getUpstream(req('https://127.0.0.1:8443'), GO_UPSTREAM, NO_ALLOWLIST, false)).toBe(GO_UPSTREAM);
  });
});
