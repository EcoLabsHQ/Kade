// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {KadeLock} from "../src/KadeLock.sol";
import {Enum} from "safe-smart-account/contracts/libraries/Enum.sol";
import {IERC165} from "safe-smart-account/contracts/interfaces/IERC165.sol";
import {
    BaseTransactionGuard,
    ITransactionGuard
} from "safe-smart-account/contracts/base/GuardManager.sol";

contract KadeLockTest is Test {
    KadeLock internal kadeLock;

    address internal admin = address(0xA11CE);
    address internal newAdmin = address(0xA11CF);
    address internal attacker = address(0xBAD);
    address internal treasury = address(0xBEEF);
    address internal instrument = address(0x1234);
    address internal stranger = address(0x5678);

    uint64 internal initialUnlockAt;

    function setUp() public {
        vm.warp(1_000_000);
        initialUnlockAt = uint64(block.timestamp + 30 days);
        kadeLock = new KadeLock(admin, initialUnlockAt);
    }

    function _checkTransaction(address to, uint256 value) internal view {
        kadeLock.checkTransaction(
            to,
            value,
            "",
            Enum.Operation.Call,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            "",
            admin
        );
    }

    // ---------------------------------------------------------------------
    // 1. Unauthorised configuration changes are rejected
    // ---------------------------------------------------------------------

    function test_UnauthorizedConfigurationChangesAreRejected() public {
        vm.startPrank(attacker);

        vm.expectRevert(abi.encodeWithSelector(KadeLock.NotAdmin.selector, attacker));
        kadeLock.setAdmin(attacker);

        vm.expectRevert(abi.encodeWithSelector(KadeLock.NotAdmin.selector, attacker));
        kadeLock.lock(uint64(block.timestamp + 1 days));

        vm.expectRevert(abi.encodeWithSelector(KadeLock.NotAdmin.selector, attacker));
        kadeLock.unlock();

        vm.expectRevert(abi.encodeWithSelector(KadeLock.NotAdmin.selector, attacker));
        kadeLock.allowDestination(attacker);

        vm.expectRevert(abi.encodeWithSelector(KadeLock.NotAdmin.selector, attacker));
        kadeLock.disallowDestination(treasury);

        vm.stopPrank();
    }

    function test_UnauthorizedSetAdminReverts() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(KadeLock.NotAdmin.selector, attacker));
        kadeLock.setAdmin(attacker);
    }

    function test_UnauthorizedLockReverts() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(KadeLock.NotAdmin.selector, attacker));
        kadeLock.lock(uint64(block.timestamp + 1 days));
    }

    function test_UnauthorizedUnlockReverts() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(KadeLock.NotAdmin.selector, attacker));
        kadeLock.unlock();
    }

    function test_UnauthorizedAllowDestinationReverts() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(KadeLock.NotAdmin.selector, attacker));
        kadeLock.allowDestination(attacker);
    }

    function test_UnauthorizedDisallowDestinationReverts() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(KadeLock.NotAdmin.selector, attacker));
        kadeLock.disallowDestination(treasury);
    }

    function test_AdminCanConfigureAllowlistAndUnlockTime() public {
        uint64 extended = initialUnlockAt + 10 days;

        vm.startPrank(admin);
        kadeLock.allowDestination(treasury);
        kadeLock.allowDestination(instrument);
        kadeLock.lock(extended);
        kadeLock.disallowDestination(instrument);
        vm.stopPrank();

        assertTrue(kadeLock.allowedDestinations(treasury));
        assertFalse(kadeLock.allowedDestinations(instrument));
        assertEq(kadeLock.unlockAt(), extended);
    }

    function test_AdminSetAdminTransfersConfigurationAuthority() public {
        vm.prank(admin);
        kadeLock.setAdmin(newAdmin);
        assertEq(kadeLock.admin(), newAdmin);

        vm.prank(newAdmin);
        kadeLock.allowDestination(treasury);
        assertTrue(kadeLock.allowedDestinations(treasury));

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(KadeLock.NotAdmin.selector, admin));
        kadeLock.allowDestination(instrument);
    }

    function test_ConstructorRejectsZeroAdmin() public {
        vm.expectRevert(KadeLock.ZeroAdmin.selector);
        new KadeLock(address(0), initialUnlockAt);
    }

    function test_SetAdminRejectsZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(KadeLock.ZeroAdmin.selector);
        kadeLock.setAdmin(address(0));
    }

    function test_AllowDestinationRejectsZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(KadeLock.ZeroDestination.selector);
        kadeLock.allowDestination(address(0));
    }

    // ---------------------------------------------------------------------
    // 2. Lock enforcement before unlockAt
    // ---------------------------------------------------------------------

    function test_LockBlocksOutboundValueBeforeUnlockAt() public {
        assertTrue(kadeLock.isLocked());
        vm.expectRevert(abi.encodeWithSelector(KadeLock.DestinationNotAllowed.selector, stranger));
        _checkTransaction(stranger, 1 ether);
    }

    function test_LockAllowsZeroValueTransfersBeforeUnlockAt() public view {
        assertTrue(kadeLock.isLocked());
        _checkTransaction(stranger, 0);
    }

    function test_IsLockedIsFalseAtExactUnlockBoundary() public {
        vm.warp(initialUnlockAt);
        assertFalse(kadeLock.isLocked());
    }

    // ---------------------------------------------------------------------
    // 3. Permitted destinations
    // ---------------------------------------------------------------------

    function test_PermittedDestinationAllowsValueBeforeUnlockAt() public {
        vm.prank(admin);
        kadeLock.allowDestination(treasury);

        assertTrue(kadeLock.isLocked());
        _checkTransaction(treasury, 1 ether);
    }

    function test_PermittedDestinationCanBeRemovedBeforeUnlockAt() public {
        vm.startPrank(admin);
        kadeLock.allowDestination(treasury);
        kadeLock.disallowDestination(treasury);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(KadeLock.DestinationNotAllowed.selector, treasury));
        _checkTransaction(treasury, 1 ether);
    }

    // ---------------------------------------------------------------------
    // 4. Rejected destinations
    // ---------------------------------------------------------------------

    function test_RejectedDestinationRevertsBeforeUnlockAt() public {
        vm.prank(admin);
        kadeLock.allowDestination(treasury);

        uint256 balancePreserved = 1 ether;
        vm.expectRevert(abi.encodeWithSelector(KadeLock.DestinationNotAllowed.selector, stranger));
        _checkTransaction(stranger, balancePreserved);
    }

    function test_RejectedDestinationRevertsForAnyPositiveValue() public {
        vm.expectRevert(abi.encodeWithSelector(KadeLock.DestinationNotAllowed.selector, stranger));
        _checkTransaction(stranger, 1);

        vm.expectRevert(abi.encodeWithSelector(KadeLock.DestinationNotAllowed.selector, stranger));
        _checkTransaction(stranger, type(uint256).max);
    }

    // ---------------------------------------------------------------------
    // 5. Post-unlock behaviour
    // ---------------------------------------------------------------------

    function test_PostUnlockBehaviourLockNoLongerBlocks() public {
        vm.warp(uint256(initialUnlockAt) + 1);

        assertFalse(kadeLock.isLocked());
        _checkTransaction(stranger, 1 ether);
    }

    function test_PostUnlockBehaviourAnyDestinationSucceeds() public {
        vm.warp(uint256(initialUnlockAt) + 365 days);

        _checkTransaction(stranger, 1 ether);
        _checkTransaction(treasury, 1 ether);
        _checkTransaction(instrument, 0);
    }

    // ---------------------------------------------------------------------
    // Lock / unlock controls
    // ---------------------------------------------------------------------

    function test_UnlockControlMovesUnlockAtToNow() public {
        vm.prank(admin);
        kadeLock.unlock();

        assertEq(kadeLock.unlockAt(), uint64(block.timestamp));
        assertFalse(kadeLock.isLocked());
        _checkTransaction(stranger, 1 ether);
    }

    function test_LockControlExtendsTheLock() public {
        vm.warp(uint256(initialUnlockAt) + 1);
        assertFalse(kadeLock.isLocked());

        uint64 relockedUntil = uint64(block.timestamp + 5 days);
        vm.prank(admin);
        kadeLock.lock(relockedUntil);

        assertTrue(kadeLock.isLocked());
        vm.expectRevert(abi.encodeWithSelector(KadeLock.DestinationNotAllowed.selector, stranger));
        _checkTransaction(stranger, 1 ether);
    }

    function test_LockControlRejectsTimestampInThePast() public {
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(KadeLock.UnlockAtNotInFuture.selector, uint64(block.timestamp))
        );
        kadeLock.lock(uint64(block.timestamp));
    }

    function test_UnlockedLockCanBeReEngagedByAdmin() public {
        vm.startPrank(admin);
        kadeLock.unlock();
        assertFalse(kadeLock.isLocked());

        kadeLock.lock(uint64(block.timestamp + 1 days));
        assertTrue(kadeLock.isLocked());
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(KadeLock.DestinationNotAllowed.selector, stranger));
        _checkTransaction(stranger, 1 ether);
    }

    // ---------------------------------------------------------------------
    // Guard interface conformance
    // ---------------------------------------------------------------------

    function test_SupportsGuardAndErc165Interfaces() public view {
        assertTrue(kadeLock.supportsInterface(type(ITransactionGuard).interfaceId));
        assertTrue(kadeLock.supportsInterface(type(IERC165).interfaceId));
        assertFalse(kadeLock.supportsInterface(bytes4(0xdeadbeef)));
    }

    function test_CheckAfterExecutionIsCallableAndDoesNotRevert() public {
        kadeLock.checkAfterExecution(bytes32(uint256(1)), true);
        kadeLock.checkAfterExecution(bytes32(uint256(2)), false);
    }

    function test_ConstructorRecordsAdminAndUnlockAt() public view {
        assertEq(kadeLock.admin(), admin);
        assertEq(kadeLock.unlockAt(), initialUnlockAt);
    }

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    function test_AllowDestinationEmitsEvent() public {
        vm.expectEmit(true, false, false, true, address(kadeLock));
        emit KadeLock.DestinationAllowed(treasury);

        vm.prank(admin);
        kadeLock.allowDestination(treasury);
    }

    function test_DisallowDestinationEmitsEvent() public {
        vm.startPrank(admin);
        kadeLock.allowDestination(treasury);

        vm.expectEmit(true, false, false, true, address(kadeLock));
        emit KadeLock.DestinationDisallowed(treasury);
        kadeLock.disallowDestination(treasury);
        vm.stopPrank();
    }

    function test_UnlockEmitsUnlockAtChanged() public {
        vm.expectEmit(false, false, false, true, address(kadeLock));
        emit KadeLock.UnlockAtChanged(initialUnlockAt, uint64(block.timestamp));

        vm.prank(admin);
        kadeLock.unlock();
    }
}
