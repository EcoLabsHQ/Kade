// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// IERC5192 — Minimal Soulbound NFTs (ERC-5192).
//
// Written in-repo on purpose: the human preferred a small own extension over
// vendoring a third-party ERC-5192 reference implementation. Only the minimal
// interface is declared here; the behaviour lives in ColosseumMembership.
//
// Interface id: 0xb45a3c0e (the selector of `locked(uint256)`).
//
// Scope and status: Colosseum Membership v1 is compiled and Foundry-tested
// only. It is NOT deployed. See packages/contracts/README.md.
interface IERC5192 {
    /// @notice Emitted when `tokenId` becomes non-transferable.
    event Locked(uint256 tokenId);

    /// @notice Emitted when `tokenId` becomes transferable. Never emitted here:
    ///         membership credentials are permanently soulbound.
    event Unlocked(uint256 tokenId);

    /// @notice Returns whether `tokenId` is locked (non-transferable).
    /// @dev MUST revert when `tokenId` does not exist or was burned.
    function locked(uint256 tokenId) external view returns (bool);
}
