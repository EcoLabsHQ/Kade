import type { NextConfig } from 'next';

/**
 * Kade web application configuration.
 *
 * `transpilePackages` is required because `@kade/shared` ships TypeScript
 * source (see packages/shared/package.json) and must be compiled with the app.
 *
 * `extensionAlias` lets webpack resolve the package's `.js` ESM specifiers
 * (for example `./provenance.js`) to their TypeScript sources, which is the
 * convention the shared package uses.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@kade/shared'],
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
