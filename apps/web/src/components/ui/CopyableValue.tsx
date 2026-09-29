'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { CheckGlyph } from '@/components/icons/CheckGlyph';
import { CopyGlyph } from '@/components/icons/CopyGlyph';
import { ExternalLinkGlyph } from '@/components/icons/ExternalLinkGlyph';
import { shortAddress } from '@/lib/wealth/format';
import { tokens } from './tokens';

/**
 * An on-chain identifier (an address or a transaction hash) rendered as
 * actionable text rather than a clipped string.
 *
 * The visible label is shortened for layout, but nothing is lost: the full
 * value is in the `title`, the copy button writes the full value to the
 * clipboard, and an optional explorer link opens the value on its own chain.
 *
 * Accessibility: both affordances are icon-only, so they carry no visible text
 * (the owner asked for icons rather than labels). The copy affordance is a real
 * `<button>` (keyboard-reachable, not a clickable `<div>`) and it acknowledges
 * the copy by swapping the copy glyph for a confirmation tick and renaming its
 * accessible label to "Copied …" — never by colour alone. The explorer link is a
 * real `<a>` opening in a new tab with `rel="noopener noreferrer"`.
 */
export interface CopyableValueProps {
  /** The full value; never replaced by its shortened display form. */
  readonly value: string;
  /** Names the value in the control labels, e.g. "vault address". */
  readonly label: string;
  /** When set, an explorer link opens this URL in a new tab. */
  readonly explorerUrl?: string | null;
  readonly testId?: string;
}

export function CopyableValue({
  value,
  label,
  explorerUrl = null,
  testId,
}: CopyableValueProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; the full value stays in the title so it
      // can still be selected and copied by hand.
    }
  }

  return (
    <span style={row} data-testid={testId}>
      <code title={value} style={code}>
        {shortAddress(value)}
      </code>
      <button
        type="button"
        aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
        title={copied ? `Copied ${label}` : `Copy ${label}`}
        onClick={() => void copy()}
        style={copyButton}
      >
        {copied ? <CheckGlyph /> : <CopyGlyph />}
      </button>
      {explorerUrl ? (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View ${label} on the block explorer`}
          title={`View ${label} on the block explorer`}
          style={link}
        >
          <ExternalLinkGlyph />
        </a>
      ) : null}
    </span>
  );
}

const row: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '8px',
  flexWrap: 'wrap',
  minWidth: 0,
};

const code: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '12px',
  fontWeight: 500,
  color: tokens.ink,
  whiteSpace: 'nowrap',
};

const copyButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: `1px solid ${tokens.border}`,
  borderRadius: '999px',
  background: '#fff',
  color: tokens.brandPrimary,
  lineHeight: 0,
  padding: '4px 7px',
  cursor: 'pointer',
};

const link: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: tokens.brandPrimary,
  lineHeight: 0,
  textDecoration: 'none',
};
