import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * SEO / social metadata wiring.
 *
 * The deployment (mvp.kade.global) needs a real title, OpenGraph/Twitter card
 * and favicon set, while staying `noindex` because every resident route is
 * authenticated. This asserts the shipped configuration, not a re-implementation:
 * it imports the real layout metadata (with only `next/font` stubbed) and the
 * real `manifest`/`robots` file-convention modules.
 */

vi.mock('next/font/google', () => ({
  Plus_Jakarta_Sans: () => ({ variable: '--font-plus-jakarta' }),
}));

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('app layout metadata', () => {
  it('uses the exact requested title and noindex robots', async () => {
    const { metadata } = await import('@/app/layout');

    expect(metadata.title).toBe(
      'Onchain Island Residency Platform powered by Kade',
    );
    expect(metadata.robots).toEqual({ index: false });
  });

  it('sets an absolute metadataBase from the configured site URL', async () => {
    const { readSiteUrl } = await import('@/lib/env');
    const { metadata } = await import('@/app/layout');

    expect(metadata.metadataBase).toBeInstanceOf(URL);
    expect(metadata.metadataBase?.toString()).toBe(
      new URL(readSiteUrl()).toString(),
    );
  });

  it('carries matching OpenGraph and summary_large_image Twitter cards', async () => {
    const { metadata } = await import('@/app/layout');

    expect(metadata.openGraph).toMatchObject({
      type: 'website',
      siteName: 'Onchain Island',
      url: '/',
      title: 'Onchain Island Residency Platform powered by Kade',
    });
    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      title: 'Onchain Island Residency Platform powered by Kade',
    });
    const description = metadata.description ?? '';
    for (const forbidden of ['banking', 'card issuance', 'payouts', 'borrow']) {
      // The description may name these only to say they are not available.
      if (description.toLowerCase().includes(forbidden)) {
        expect(description.toLowerCase()).toContain('not available');
      }
    }
  });

  it('does not hard-code a production origin or private host', async () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/app/layout.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/https?:\/\/[^'"\s]*kade\.global/i);
  });
});

describe('app icon conventions', () => {
  it('ships the SVG, PNG variants and Apple touch icon', () => {
    const assets = [
      'src/app/icon.svg',
      'src/app/icon1.png',
      'src/app/icon2.png',
      'src/app/icon3.png',
      'src/app/apple-icon.png',
      'public/icon-192.png',
      'public/icon-512.png',
    ];
    for (const asset of assets) {
      const path = resolve(process.cwd(), asset);
      expect(existsSync(path), `${asset} should exist`).toBe(true);
      expect(statSync(path).size, `${asset} should not be empty`).toBeGreaterThan(
        0,
      );
    }
    // The supplied SVG must be the transparent browser mark, not the dark tile.
    const svg = readFileSync(resolve(process.cwd(), 'src/app/icon.svg'), 'utf8');
    expect(svg).toContain('fill="#008CFF"');
    expect(svg).not.toContain('<metadata');
  });
});

describe('app/opengraph-image.png', () => {
  it('is a real 1200x630 PNG served from a public path', () => {
    const path = resolve(process.cwd(), 'src/app/opengraph-image.png');
    const bytes = readFileSync(path);
    // PNG signature + IHDR: width and height are big-endian uint32 at 16 and 20.
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
  });
});

describe('app/manifest.ts', () => {
  it('preserves the supplied manifest name, colours and icon sizes', async () => {
    const manifest = (await import('@/app/manifest')).default();

    expect(manifest.name).toBe('Onchain Island');
    expect(manifest.short_name).toBe('Onchain Island');
    expect(manifest.theme_color).toBe('#008CFF');
    expect(manifest.background_color).toBe('#0B1220');
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icon-192.png', sizes: '192x192' }),
        expect.objectContaining({ src: '/icon-512.png', sizes: '512x512' }),
      ]),
    );
  });
});

describe('app/robots.ts', () => {
  it('disallows all crawling', async () => {
    const robots = (await import('@/app/robots')).default();

    expect(robots.rules).toMatchObject({ userAgent: '*', disallow: '/' });
  });
});

describe('readSiteUrl', () => {
  it('uses NEXT_PUBLIC_SITE_URL as the single source of truth', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test';
    const { readSiteUrl } = await import('@/lib/env');
    expect(readSiteUrl()).toBe('https://example.test');
  });

  it('falls back to localhost for local development', async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const { readSiteUrl } = await import('@/lib/env');
    expect(readSiteUrl()).toBe('http://localhost:3000');
  });
});
