// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {KadeLock} from "../src/KadeLock.sol";
import {MockGuardHost} from "./mocks/MockGuardHost.sol";

contract KadeLockSafeIntegrationTest is Test {
    KadeLock internal kadeLock;
    MockGuardHost internal host;

    address internal admin = address(0xA11CE);
    address internal treasury = address(0xBEEF);
    address internal stranger = address(0x5678);

    uint64 internal unlockAt;

    function setUp() public {
        vm.warp(1_000_000);
        unlockAt = uint64(block.timestamp + 30 days);
        kadeLock = new KadeLock(admin, unlockAt);
        host = new MockGuardHost(kadeLock);
        vm.deal(address(host), 10 ether);
    }

    function test_IntegrationValueToAllowedDestinationMovesBeforeUnlock() public {
        vm.prank(admin);
        kadeLock.allowDestination(treasury);

        host.execute(treasury, 1 ether);

        assertEq(treasury.balance, 1 ether);
        assertEq(address(host).balance, 9 ether);
    }

    function test_IntegrationValueToRejectedDestinationIsBlockedBeforeUnlock() public {
        vm.expectRevert(abi.encodeWithSelector(KadeLock.DestinationNotAllowed.selector, stranger));
        host.execute(stranger, 1 ether);

        assertEq(stranger.balance, 0);
        assertEq(address(host).balance, 10 ether);
    }

    function test_IntegrationValueMovesAfterUnlock() public {
        vm.warp(uint256(unlockAt) + 1);

        host.execute(stranger, 2 ether);

        assertEq(stranger.balance, 2 ether);
        assertEq(address(host).balance, 8 ether);
    }
}
