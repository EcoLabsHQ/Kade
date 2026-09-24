import { getAddress, type Address } from 'viem';

/**
 * The MetaMorpho vault interface this build uses (Week 2, D18 / EXE-014).
 *
 * The Invest target is a **MetaMorpho vault**, not a Morpho Blue market. A
 * MetaMorpho vault is an ERC-4626 vault: a single deployed contract that holds
 * one underlying asset (USDC) and issues ERC-20 shares. Depositing is therefore
 * the ERC-4626 `deposit(assets, receiver)`, and the resulting position is a
 * plain ERC-20 `balanceOf(receiver)` — there is no market, no `marketParams`
 * and no computed market id in this path.
 *
 * Source: the ERC-4626 tokenized-vault standard
 * (`eips.ethereum.org/EIPS/eip-4626`) and the MetaMorpho interface
 * (`morpho-org/metamorpho`, `src/interfaces/IMetaMorpho.sol`), which inherits
 * ERC-4626. The ABI is declared here rather than pulled from an SDK because no
 * Morpho package is installed and the surface needed for one deposit is tiny
 * and canonical.
 *
 * The vault address and its underlying USDC address are configuration
 * (`./morpho-config.ts`), never literals in this file or in a component.
 *
 * `deposit(assets, receiver)` takes exactly `assets` of the underlying USDC and
 * credits the resulting shares to `receiver`. Passing the resident Safe as
 * `receiver` is what makes the position theirs: the vault pulls the USDC from
 * the Safe (`msg.sender`, which is why the Safe must approve first) and mints
 * the shares to the Safe.
 */

/** The MetaMorpho vault surface needed for the USDC deposit path. */
export const METAMORPHO_VAULT_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'asset',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'assetToken', type: 'address' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'convertToAssets',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/** Normalise and checksum a config-supplied address, throwing when malformed. */
export function checksumAddress(value: string, field: string): Address {
  try {
    return getAddress(value.trim());
  } catch {
    throw new Error(`${field} is not a valid 20-byte hex address: "${value}".`);
  }
}
