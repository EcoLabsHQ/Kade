// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {Base64} from "openzeppelin-contracts/contracts/utils/Base64.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";

import {IERC5192} from "./interfaces/IERC5192.sol";

// ColosseumMembership — abstract soulbound credential collection
// (ERC-721 + ERC-5192).
//
// Scope and status: "Colosseum Membership v1" is compiled and Foundry-tested
// only. It is NOT deployed; this repository has no broadcast path. Mirrors the
// KadeLock status (packages/contracts/README.md).
//
// Token rules (both collections):
//   - balanceOf(wallet) is 0 or 1: one active credential per address;
//   - locked(tokenId) is always true for an existing token and reverts for a
//     token that does not exist or was burned;
//   - every mint emits both Transfer and Locked;
//   - every transfer between two non-zero addresses reverts;
//   - there is no unlock function;
//   - revocation burns the token, and burned ids are never reused;
//   - only the MembershipManager may mint or burn;
//   - metadata carries name, image and membership type only — no personal data.
//
// ERC721Burnable is deliberately NOT inherited: it would let an owner or an
// approved operator burn outside the administrative flow.
abstract contract ColosseumMembership is ERC721, IERC5192 {
    using Strings for uint256;

    /// @notice The only account allowed to mint or burn. Set once, immutable.
    address public immutable manager;

    // Token ids start at 1 and only ever increase, so a burned id is never
    // reused. 0 means "no token".
    uint256 private _lastTokenId;

    error NotManager(address caller);
    error ZeroManager();
    error Soulbound();
    error AlreadyHoldsCredential(address account);

    modifier onlyManager() {
        if (msg.sender != manager) revert NotManager(msg.sender);
        _;
    }

    constructor(
        address manager_,
        string memory name_,
        string memory symbol_
    ) ERC721(name_, symbol_) {
        if (manager_ == address(0)) revert ZeroManager();
        manager = manager_;
    }

    // ---------------------------------------------------------------------
    // Issuance / revocation — manager-only, never public
    // ---------------------------------------------------------------------

    /// @notice Mints the next credential to `account`. Only the manager.
    /// @dev Rejects a second credential for the same address, so
    ///      `balanceOf(account)` stays 0 or 1.
    function mint(address account) external onlyManager returns (uint256 tokenId) {
        if (balanceOf(account) != 0) revert AlreadyHoldsCredential(account);
        tokenId = ++_lastTokenId;
        _safeMint(account, tokenId);
        emit Locked(tokenId);
    }

    /// @notice Burns the credential `tokenId` (revocation). Only the manager.
    function burn(uint256 tokenId) external onlyManager {
        _burn(tokenId);
    }

    // ---------------------------------------------------------------------
    // ERC-5192
    // ---------------------------------------------------------------------

    /// @inheritdoc IERC5192
    function locked(uint256 tokenId) external view returns (bool) {
        // Reverts with ERC721NonexistentToken when the token does not exist or
        // was burned.
        _requireOwned(tokenId);
        return true;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override returns (bool) {
        return
            interfaceId == type(IERC5192).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    // ---------------------------------------------------------------------
    // Soulbound enforcement — mint and burn only
    // ---------------------------------------------------------------------

    /// @dev In OZ 5.x every mint, burn and transfer flows through `_update`.
    ///      A move between two non-zero addresses is rejected.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal virtual override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    // ---------------------------------------------------------------------
    // Metadata — name, image and membership type; no personal data
    // ---------------------------------------------------------------------

    /// @notice The membership type carried in the metadata ("Resident" or
    ///         "Citizen").
    function membershipType() public pure virtual returns (string memory);

    /// @notice The collection image URI. A placeholder until deployment.
    function imageURI() public pure virtual returns (string memory);

    /// @notice A short, personal-data-free collection description.
    function description() public pure virtual returns (string memory);

    /// @notice Collection-level metadata (e.g. for marketplaces).
    function contractURI() public view returns (string memory) {
        string memory json = string.concat(
            '{"name":"',
            name(),
            '","description":"',
            description(),
            '","image":"',
            imageURI(),
            '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @inheritdoc ERC721
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory json = string.concat(
            '{"name":"',
            name(),
            " #",
            tokenId.toString(),
            '","description":"',
            description(),
            '","image":"',
            imageURI(),
            '","membershipType":"',
            membershipType(),
            '","attributes":[{"trait_type":"Membership","value":"',
            membershipType(),
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
