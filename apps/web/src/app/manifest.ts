import type { MetadataRoute } from 'next';

/**
 * Web app manifest for the Onchain Island residency platform.
 *
 * Mirrors the intent of the supplied favicon manifest: the same name and short
 * name, the same start URL and `browser` display mode, the supplied theme and
 * background colours, and the 192/512 tile icons. Those two PNGs live in
 * `public/` and are served by URL; Next serves this module at
 * `/manifest.webmanifest` and injects the `<link rel="manifest">` itself.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Onchain Island',
    short_name: 'Onchain Island',
    start_url: '/',
    display: 'browser',
    background_color: '#0B1220',
    theme_color: '#008CFF',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
