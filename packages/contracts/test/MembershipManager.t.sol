// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {IERC721Errors} from "openzeppelin-contracts/contracts/interfaces/draft-IERC6093.sol";

import {MembershipManager} from "../src/MembershipManager.sol";
import {ColosseumMembership} from "../src/ColosseumMembership.sol";
import {ColosseumResident} from "../src/ColosseumResident.sol";
import {ColosseumCitizen} from "../src/ColosseumCitizen.sol";
import {RejectingReceiver} from "./mocks/RejectingReceiver.sol";
import {ReentrantReceiver} from "./mocks/ReentrantReceiver.sol";

// MembershipManager: access control, the full state machine, atomic promotion
// and reentrancy.
contract MembershipManagerTest is Test {
    MembershipManager internal manager;
    ColosseumResident internal resident;
    ColosseumCitizen internal citizen;

    address internal constant SAFE = address(0x5AFE);
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant ATTACKER = address(0xBAD);

    function setUp() public {
        manager = new MembershipManager(SAFE);
        resident = new ColosseumResident(address(manager));
        citizen = new ColosseumCitizen(address(manager));
        vm.prank(SAFE);
        manager.setCollections(resident, citizen);
    }

    function _issue(address account) internal {
        vm.prank(SAFE);
        manager.issueResident(account);
    }

    function _promote(address account) internal {
        vm.prank(SAFE);
        manager.promoteToCitizen(account);
    }

    function _revoke(address account) internal {
        vm.prank(SAFE);
        manager.revokeMembership(account);
    }

    function _membership(address account) internal view returns (MembershipManager.Membership) {
        return manager.membershipOf(account);
    }

    // ---------------------------------------------------------------------
    // 1. Access control — only the Safe (owner)
    // ---------------------------------------------------------------------

    function test_OwnerIsSafeAndDeployerHasNoAuthority() public {
        assertEq(manager.owner(), SAFE);
        assertEq(manager.pendingOwner(), address(0));
        assertTrue(address(this) != SAFE);

        // The deployer (this test contract) is not the owner.
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this))
        );
        manager.issueResident(ALICE);
    }

    function test_OnlySafeCanChangeMemberships() public {
        vm.startPrank(ATTACKER);

        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ATTACKER)
        );
        manager.issueResident(ALICE);

        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ATTACKER)
        );
        manager.promoteToCitizen(ALICE);

        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ATTACKER)
        );
        manager.revokeMembership(ALICE);

        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ATTACKER)
        );
        manager.setCollections(resident, citizen);

        vm.stopPrank();
    }

    function test_ZeroOwnerRejected() public {
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0))
        );
        new MembershipManager(address(0));
    }

    function test_ManagerOwnershipIsTwoStep() public {
        vm.prank(SAFE);
        manager.transferOwnership(BOB);
        assertEq(manager.pendingOwner(), BOB);
        assertEq(manager.owner(), SAFE);

        vm.prank(BOB);
        manager.acceptOwnership();
        assertEq(manager.owner(), BOB);
        assertEq(manager.pendingOwner(), address(0));
    }

    function test_RenounceOwnershipIsDisabled() public {
        // The Safe is the only account that can administer membership, so
        // renouncing ownership would brick the contract permanently. The
        // override reverts and leaves the owner untouched.
        vm.prank(SAFE);
        vm.expectRevert(MembershipManager.OwnershipRenounceDisabled.selector);
        manager.renounceOwnership();
        assertEq(manager.owner(), SAFE);

        // Ownership can still move, but only through the two-step transfer.
        vm.prank(SAFE);
        manager.transferOwnership(BOB);
        vm.prank(BOB);
        manager.acceptOwnership();
        assertEq(manager.owner(), BOB);
        assertEq(manager.pendingOwner(), address(0));
    }

    // ---------------------------------------------------------------------
    // Wiring
    // ---------------------------------------------------------------------

    function test_CollectionsMustBeSetBeforeIssue() public {
        MembershipManager fresh = new MembershipManager(SAFE);
        vm.prank(SAFE);
        vm.expectRevert(MembershipManager.CollectionsNotSet.selector);
        fresh.issueResident(ALICE);
    }

    function test_SetCollectionsIsOneTimeAndSafeOnly() public {
        vm.prank(SAFE);
        vm.expectRevert(MembershipManager.CollectionsAlreadySet.selector);
        manager.setCollections(resident, citizen);

        MembershipManager fresh = new MembershipManager(SAFE);
        ColosseumResident freshResident = new ColosseumResident(address(fresh));
        ColosseumCitizen freshCitizen = new ColosseumCitizen(address(fresh));

        vm.prank(ATTACKER);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, ATTACKER)
        );
        fresh.setCollections(freshResident, freshCitizen);
    }

    function test_SetCollectionsRejectsCollectionsWiredToAnotherManager() public {
        MembershipManager fresh = new MembershipManager(SAFE);

        // These collections are wired to `manager`, not `fresh`.
        vm.prank(SAFE);
        vm.expectRevert(MembershipManager.WrongManager.selector);
        fresh.setCollections(resident, citizen);
    }

    function test_SetCollectionsRejectsTheSameCollectionTwice() public {
        MembershipManager fresh = new MembershipManager(SAFE);
        ColosseumResident freshResident = new ColosseumResident(address(fresh));

        // Wiring one collection as both resident and citizen would make
        // promoteToCitizen burn and re-mint inside a single collection,
        // silently conflating the two credential types.
        vm.prank(SAFE);
        vm.expectRevert(MembershipManager.CollectionsMustDiffer.selector);
        fresh.setCollections(freshResident, ColosseumCitizen(address(freshResident)));
    }

    // ---------------------------------------------------------------------
    // 7. Full state machine: issue -> promote -> revoke
    // ---------------------------------------------------------------------

    function test_IssueResident() public {
        _issue(ALICE);

        assertEq(uint8(_membership(ALICE)), uint8(MembershipManager.Membership.Resident));
        assertEq(resident.balanceOf(ALICE), 1);
        assertEq(citizen.balanceOf(ALICE), 0);

        uint256 tokenId = manager.tokenIdOf(ALICE);
        assertEq(tokenId, 1);
        assertTrue(resident.locked(tokenId));
    }

    function test_PromoteToCitizen() public {
        _issue(ALICE);
        uint256 residentTokenId = manager.tokenIdOf(ALICE);

        _promote(ALICE);

        assertEq(uint8(_membership(ALICE)), uint8(MembershipManager.Membership.Citizen));
        assertEq(resident.balanceOf(ALICE), 0);
        assertEq(citizen.balanceOf(ALICE), 1);

        // The two collections number independently, so ids may coincide; the
        // uniqueness requirement is within a collection.
        uint256 citizenTokenId = manager.tokenIdOf(ALICE);
        assertEq(citizenTokenId, 1);
        assertTrue(citizen.locked(citizenTokenId));

        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, residentTokenId)
        );
        resident.locked(residentTokenId);
    }

    function test_RevokeResident() public {
        _issue(ALICE);
        uint256 tokenId = manager.tokenIdOf(ALICE);

        _revoke(ALICE);

        assertEq(uint8(_membership(ALICE)), uint8(MembershipManager.Membership.None));
        assertEq(resident.balanceOf(ALICE), 0);
        assertEq(manager.tokenIdOf(ALICE), 0);

        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, tokenId)
        );
        resident.locked(tokenId);
    }

    function test_RevokeCitizen() public {
        _issue(ALICE);
        _promote(ALICE);
        uint256 tokenId = manager.tokenIdOf(ALICE);

        _revoke(ALICE);

        assertEq(uint8(_membership(ALICE)), uint8(MembershipManager.Membership.None));
        assertEq(citizen.balanceOf(ALICE), 0);
        assertEq(manager.tokenIdOf(ALICE), 0);

        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, tokenId)
        );
        citizen.locked(tokenId);
    }

    function test_FullStateMachineIssuePromoteRevoke() public {
        _issue(ALICE);
        assertEq(uint8(_membership(ALICE)), uint8(MembershipManager.Membership.Resident));

        _promote(ALICE);
        assertEq(uint8(_membership(ALICE)), uint8(MembershipManager.Membership.Citizen));

        _revoke(ALICE);
        assertEq(uint8(_membership(ALICE)), uint8(MembershipManager.Membership.None));
        assertEq(resident.balanceOf(ALICE), 0);
        assertEq(citizen.balanceOf(ALICE), 0);
        assertEq(manager.tokenIdOf(ALICE), 0);
    }

    // ---------------------------------------------------------------------
    // Rejection paths
    // ---------------------------------------------------------------------

    function test_RejectDuplicateIssue() public {
        _issue(ALICE);

        vm.prank(SAFE);
        vm.expectRevert(
            abi.encodeWithSelector(
                MembershipManager.AlreadyMember.selector,
                ALICE,
                MembershipManager.Membership.Resident
            )
        );
        manager.issueResident(ALICE);
    }

    function test_RejectPromoteWithoutResident() public {
        // Never a member.
        vm.prank(SAFE);
        vm.expectRevert(abi.encodeWithSelector(MembershipManager.NotResident.selector, ALICE));
        manager.promoteToCitizen(ALICE);

        // Already revoked.
        _issue(ALICE);
        _revoke(ALICE);
        vm.prank(SAFE);
        vm.expectRevert(abi.encodeWithSelector(MembershipManager.NotResident.selector, ALICE));
        manager.promoteToCitizen(ALICE);

        // Already a Citizen.
        _issue(ALICE);
        _promote(ALICE);
        vm.prank(SAFE);
        vm.expectRevert(abi.encodeWithSelector(MembershipManager.NotResident.selector, ALICE));
        manager.promoteToCitizen(ALICE);
    }

    function test_RejectRevokeWithoutMembership() public {
        vm.prank(SAFE);
        vm.expectRevert(abi.encodeWithSelector(MembershipManager.NoMembership.selector, ALICE));
        manager.revokeMembership(ALICE);
    }

    function test_RejectZeroAddress() public {
        vm.startPrank(SAFE);

        vm.expectRevert(MembershipManager.ZeroAccount.selector);
        manager.issueResident(address(0));

        vm.expectRevert(MembershipManager.ZeroAccount.selector);
        manager.promoteToCitizen(address(0));

        vm.expectRevert(MembershipManager.ZeroAccount.selector);
        manager.revokeMembership(address(0));

        vm.stopPrank();
    }

    // ---------------------------------------------------------------------
    // 4. Both credentials can never coexist
    // ---------------------------------------------------------------------

    function test_BothCredentialsNeverCoexist() public {
        _issue(ALICE);
        assertEq(resident.balanceOf(ALICE), 1);
        assertEq(citizen.balanceOf(ALICE), 0);
        assertEq(resident.balanceOf(ALICE) + citizen.balanceOf(ALICE), 1);

        _promote(ALICE);
        assertEq(resident.balanceOf(ALICE), 0);
        assertEq(citizen.balanceOf(ALICE), 1);
        assertEq(resident.balanceOf(ALICE) + citizen.balanceOf(ALICE), 1);
    }

    // ---------------------------------------------------------------------
    // 5. Atomic promotion when the recipient rejects the Citizen token
    // ---------------------------------------------------------------------

    function test_PromotionIsAtomicWhenCitizenMintIsRejected() public {
        RejectingReceiver receiver = new RejectingReceiver();

        _issue(address(receiver));
        receiver.setRejectCollection(address(citizen));

        uint256 residentTokenId = manager.tokenIdOf(address(receiver));

        vm.prank(SAFE);
        vm.expectRevert(bytes("RejectingReceiver: rejected"));
        manager.promoteToCitizen(address(receiver));

        // The whole promotion reverted: the Resident credential survives.
        assertEq(uint8(_membership(address(receiver))), uint8(MembershipManager.Membership.Resident));
        assertEq(resident.balanceOf(address(receiver)), 1);
        assertEq(resident.ownerOf(residentTokenId), address(receiver));
        assertEq(citizen.balanceOf(address(receiver)), 0);
        assertEq(manager.tokenIdOf(address(receiver)), residentTokenId);
    }

    // ---------------------------------------------------------------------
    // 6. A reentrant receiver cannot duplicate or hold both
    // ---------------------------------------------------------------------

    function test_ReentrantReceiverCannotDuplicateOrHoldBoth() public {
        ReentrantReceiver receiver = new ReentrantReceiver(manager);

        _issue(address(receiver));
        assertEq(receiver.attempts(), 1);
        assertEq(receiver.reverted(), 1);
        assertEq(uint8(_membership(address(receiver))), uint8(MembershipManager.Membership.Resident));
        assertEq(resident.balanceOf(address(receiver)), 1);
        assertEq(citizen.balanceOf(address(receiver)), 0);

        // Reentrancy during the Citizen mint is also blocked.
        _promote(address(receiver));
        assertEq(receiver.attempts(), 2);
        assertEq(receiver.reverted(), 2);
        assertEq(uint8(_membership(address(receiver))), uint8(MembershipManager.Membership.Citizen));
        assertEq(resident.balanceOf(address(receiver)), 0);
        assertEq(citizen.balanceOf(address(receiver)), 1);
    }

    // ---------------------------------------------------------------------
    // 9. Burned ids are not reused after revoke + re-issue
    // ---------------------------------------------------------------------

    function test_BurnedIdsAreNotReusedThroughTheManager() public {
        _issue(ALICE);
        uint256 first = manager.tokenIdOf(ALICE);

        _revoke(ALICE);
        _issue(ALICE);
        uint256 second = manager.tokenIdOf(ALICE);

        assertNotEq(first, second);
        assertEq(second, first + 1);

        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, first)
        );
        resident.locked(first);
        assertTrue(resident.locked(second));
    }

    // ---------------------------------------------------------------------
    // Events and collection authority
    // ---------------------------------------------------------------------

    function test_IssueEmitsMembershipChanged() public {
        vm.expectEmit(true, false, false, true, address(manager));
        emit MembershipManager.MembershipChanged(
            ALICE,
            MembershipManager.Membership.None,
            MembershipManager.Membership.Resident
        );
        _issue(ALICE);
    }

    function test_PromoteEmitsMembershipChanged() public {
        _issue(ALICE);

        vm.expectEmit(true, false, false, true, address(manager));
        emit MembershipManager.MembershipChanged(
            ALICE,
            MembershipManager.Membership.Resident,
            MembershipManager.Membership.Citizen
        );
        _promote(ALICE);
    }

    function test_RevokeEmitsMembershipChanged() public {
        _issue(ALICE);

        vm.expectEmit(true, false, false, true, address(manager));
        emit MembershipManager.MembershipChanged(
            ALICE,
            MembershipManager.Membership.Resident,
            MembershipManager.Membership.None
        );
        _revoke(ALICE);
    }

    function test_CollectionsAreOnlyMintableByTheManager() public {
        vm.prank(SAFE);
        vm.expectRevert(abi.encodeWithSelector(ColosseumMembership.NotManager.selector, SAFE));
        resident.mint(ALICE);
    }
}
