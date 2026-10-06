// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {Ownable2Step} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

import {ColosseumResident} from "./ColosseumResident.sol";
import {ColosseumCitizen} from "./ColosseumCitizen.sol";

// MembershipManager — coordinates issue, promote and revoke for the two
// soulbound Colosseum credential collections.
//
// Scope and status: compiled and Foundry-tested only. NOT deployed.
//
// Access control: the owner is the Safe (Ownable2Step). All membership-changing
// functions are restricted to the Safe, and no administrative permission
// remains with the deployer wallet. The manager is the only account the
// collections accept as a minter/burner.
//
// State machine:
//   None --issueResident--> Resident --promoteToCitizen--> Citizen
//   Resident|Citizen --revokeMembership--> None
// Invalid transitions revert. Promotion is atomic: the Resident credential is
// burned and the Citizen credential minted in one transaction, so a failure
// (for example a receiver that rejects the Citizen token) reverts the whole
// promotion and leaves the Resident credential intact.
contract MembershipManager is Ownable2Step, ReentrancyGuard {
    enum Membership {
        None,
        Resident,
        Citizen
    }

    /// @notice The Resident collection. Wired once, then immutable in practice.
    ColosseumResident public resident;
    /// @notice The Citizen collection. Wired once, then immutable in practice.
    ColosseumCitizen public citizen;

    mapping(address account => Membership) private _membership;
    mapping(address account => uint256) private _tokenId;

    event MembershipChanged(
        address indexed account,
        Membership previous,
        Membership current
    );
    event CollectionsSet(address indexed resident, address indexed citizen);

    error ZeroAccount();
    error AlreadyMember(address account, Membership current);
    error NotResident(address account);
    error NoMembership(address account);
    error CollectionsAlreadySet();
    error CollectionsNotSet();
    error ZeroCollection();
    error WrongManager();

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ---------------------------------------------------------------------
    // Wiring — one-time, restricted to the Safe
    // ---------------------------------------------------------------------

    /// @notice Wires the two collections once. The collections are deployed
    ///         with this manager's address as their only minter/burner; wiring
    ///         is rejected otherwise.
    function setCollections(
        ColosseumResident resident_,
        ColosseumCitizen citizen_
    ) external onlyOwner {
        if (address(resident) != address(0) || address(citizen) != address(0)) {
            revert CollectionsAlreadySet();
        }
        if (address(resident_) == address(0) || address(citizen_) == address(0)) {
            revert ZeroCollection();
        }
        if (resident_.manager() != address(this) || citizen_.manager() != address(this)) {
            revert WrongManager();
        }
        resident = resident_;
        citizen = citizen_;
        emit CollectionsSet(address(resident_), address(citizen_));
    }

    // ---------------------------------------------------------------------
    // Membership changes — Safe only
    // ---------------------------------------------------------------------

    /// @notice Issues a Resident credential to `account`. Requires None.
    /// @dev `nonReentrant` runs before `onlyOwner`, so a reentrant callback
    ///      from a receiver is rejected by the guard regardless of caller.
    function issueResident(address account) external nonReentrant onlyOwner {
        _requireCollections();
        if (account == address(0)) revert ZeroAccount();
        Membership previous = _membership[account];
        if (previous != Membership.None) revert AlreadyMember(account, previous);

        // State before the _safeMint callback.
        _membership[account] = Membership.Resident;
        uint256 tokenId = resident.mint(account);
        _tokenId[account] = tokenId;

        emit MembershipChanged(account, Membership.None, Membership.Resident);
    }

    /// @notice Promotes a Resident to Citizen. Requires Resident. Atomic: the
    ///         Resident credential is burned and the Citizen credential minted
    ///         in the same transaction.
    function promoteToCitizen(address account) external nonReentrant onlyOwner {
        _requireCollections();
        if (account == address(0)) revert ZeroAccount();
        Membership previous = _membership[account];
        if (previous != Membership.Resident) revert NotResident(account);

        uint256 residentTokenId = _tokenId[account];

        // State before the callbacks. Burn the Resident credential first so the
        // two credentials never coexist for the same wallet. If the Citizen
        // mint fails, the whole transaction reverts and the Resident credential
        // remains.
        _membership[account] = Membership.Citizen;
        delete _tokenId[account];
        resident.burn(residentTokenId);
        uint256 citizenTokenId = citizen.mint(account);
        _tokenId[account] = citizenTokenId;

        emit MembershipChanged(account, Membership.Resident, Membership.Citizen);
    }

    /// @notice Revokes the active credential of `account`. Requires Resident or
    ///         Citizen. Revocation burns the token.
    function revokeMembership(address account) external nonReentrant onlyOwner {
        _requireCollections();
        if (account == address(0)) revert ZeroAccount();
        Membership previous = _membership[account];
        if (previous == Membership.None) revert NoMembership(account);

        uint256 tokenId = _tokenId[account];

        // State before the burn.
        _membership[account] = Membership.None;
        delete _tokenId[account];
        if (previous == Membership.Resident) {
            resident.burn(tokenId);
        } else {
            citizen.burn(tokenId);
        }

        emit MembershipChanged(account, previous, Membership.None);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function membershipOf(address account) external view returns (Membership) {
        return _membership[account];
    }

    /// @notice The active credential's token id, or 0 when there is none.
    function tokenIdOf(address account) external view returns (uint256) {
        return _tokenId[account];
    }

    function _requireCollections() private view {
        if (address(resident) == address(0) || address(citizen) == address(0)) {
            revert CollectionsNotSet();
        }
    }
}
