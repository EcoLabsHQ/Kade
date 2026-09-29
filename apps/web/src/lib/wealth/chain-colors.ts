/**
 * Per-chain accent colours for the balance breakdowns.
 *
 * [arbitrary] Brand colours as they appear on the public explorers; they are
 * presentation only and carry no meaning.
 */
export const CHAIN_COLORS: Record<string, string> = {
  Ethereum: '#627EEA',
  Base: '#0052FF',
  Arbitrum: '#2D374B',
  // The frozen registry names chain 42161 "Arbitrum One"; keep its swatch.
  'Arbitrum One': '#2D374B',
  Optimism: '#FF0420',
  Celo: '#FCFF52',
};

/** The accent for a chain name, falling back to a neutral grey. */
export function chainColor(name: string): string {
  return CHAIN_COLORS[name] ?? '#667085';
}
