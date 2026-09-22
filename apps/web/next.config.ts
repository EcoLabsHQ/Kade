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
  // Country marks are loaded from the same source the reference uses.
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'flagcdn.com' }],
  },
  transpilePackages: ['@kade/shared'],
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    // WalletConnect's transitive dependencies import optional Node-only
    // packages; excluding them keeps the browser bundle from trying to resolve
    // them. This is the configuration Reown documents for Next.js.
    const externals = Array.isArray(config.externals) ? config.externals : [];
    config.externals = [...externals, 'pino-pretty', 'lokijs', 'encoding'];

    // `@wagmi/connectors` pulls in the Coinbase Smart Wallet connector, whose
    // `@coinbase/cdp-sdk` optionally imports the x402 payment modules. Kade
    // offers neither, and the modules are not installed, so webpack cannot
    // resolve them and the build fails. They are stubbed out of the bundle
    // rather than installed: nothing in this app calls the x402 path, and the
    // connector they belong to is not one of the two Kade offers (browser
    // extension and WalletConnect).
    //
    // The same applies to three more optional dependencies of wagmi v3
    // connectors and features Kade does not use: MetaMask's SDK connector, the
    // wagmi WalletConnect connector (AppKit connects through its own
    // `@walletconnect/universal-provider`), and wagmi's "tempo" module, which
    // imports a bare `accounts` specifier that no published package provides.
    // Each is stubbed so the build resolves; none is reachable from the two
    // connection routes the step offers.
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@x402/core': false,
      '@x402/evm': false,
      '@x402/svm': false,
      '@metamask/connect-evm': false,
      '@walletconnect/ethereum-provider': false,
      accounts: false,
    };

    return config;
  },
};

export default nextConfig;
