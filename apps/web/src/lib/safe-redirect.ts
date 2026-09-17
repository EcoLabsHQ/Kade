/**
 * Safe post-authentication return paths.
 *
 * Root cause of the defect this replaces: URL safety was decided by inspecting a
 * string prefix (`startsWith('/') && !startsWith('//')`). URL parsers normalise a
 * backslash to a path separator for special schemes, so `/\evil.com` passes that
 * prefix check and resolves to `http://evil.com/`. An attacker could share
 * `/login?next=/\evil.com`, and a resident signing in normally would be returned
 * to the attacker's origin.
 *
 * Safety is therefore decided by the property we actually need — "the resolved
 * target is our own origin" — rather than by pattern-matching the input.
 *
 * The trusted origin is always supplied by the caller from configuration, never
 * derived from the incoming request, so a spoofed Host header cannot influence
 * the decision.
 */

export const DEFAULT_RETURN_PATH = '/';

/**
 * Returns a same-origin path safe to redirect to, or `fallback`.
 *
 * Accepts only a rooted path. Rejects absolute URLs, protocol-relative URLs,
 * backslashes in any position, and encoded separators that would change the
 * origin if a downstream consumer decoded the value again.
 */
export function resolveSafeReturnPath(
  candidate: string | null | undefined,
  trustedOrigin: string,
  fallback: string = DEFAULT_RETURN_PATH,
): string {
  if (typeof candidate !== 'string') return fallback;

  const raw = candidate.trim();
  if (raw === '') return fallback;

  // A backslash is normalised to a slash by URL parsers. Reject outright rather
  // than reason about each parser's normalisation rules.
  if (raw.includes('\\')) return fallback;

  // Must be a rooted path: not absolute (`https://…`) and not
  // protocol-relative (`//host`).
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//')) return fallback;

  let parsed: URL;
  let trusted: URL;
  try {
    parsed = new URL(raw, trustedOrigin);
    trusted = new URL(trustedOrigin);
  } catch {
    return fallback;
  }

  // The only property that matters.
  if (parsed.origin !== trusted.origin) return fallback;

  // Decode once more, because a consumer that re-decodes the value could
  // otherwise reintroduce a separator we did not see.
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    return fallback;
  }
  if (decodedPath.includes('\\') || decodedPath.startsWith('//')) return fallback;

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
