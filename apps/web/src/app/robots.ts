import type { MetadataRoute } from 'next';

/**
 * The resident platform is authenticated: every resident route is gated and
 * must never be indexed. The root layout also sets `robots: { index: false }`;
 * this additionally disallows crawling of the whole origin. It does not enable
 * indexing of anything.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  };
}
