// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {Base64} from "openzeppelin-contracts/contracts/utils/Base64.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import {IERC721Errors} from "openzeppelin-contracts/contracts/interfaces/draft-IERC6093.sol";

import {ColosseumMembership} from "../src/ColosseumMembership.sol";
import {ColosseumResident} from "../src/ColosseumResident.sol";
import {ColosseumCitizen} from "../src/ColosseumCitizen.sol";
import {IERC5192} from "../src/interfaces/IERC5192.sol";

// Token rules for the soulbound credential collections (both collections share
// the ColosseumMembership base).
contract ColosseumMembershipTest is Test {
    ColosseumResident internal resident;
    ColosseumCitizen internal citizen;

    address internal constant MANAGER = address(0x4A4E);
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant OPERATOR = address(0x0B0B);

    function setUp() public {
        resident = new ColosseumResident(MANAGER);
        citizen = new ColosseumCitizen(MANAGER);
    }

    function _mintResident(address to) internal returns (uint256) {
        vm.prank(MANAGER);
        return resident.mint(to);
    }

    function _mintCitizen(address to) internal returns (uint256) {
        vm.prank(MANAGER);
        return citizen.mint(to);
    }

    // ---------------------------------------------------------------------
    // Construction / access
    // ---------------------------------------------------------------------

    function test_ConstructorRejectsZeroManager() public {
        vm.expectRevert(ColosseumMembership.ZeroManager.selector);
        new ColosseumResident(address(0));

        vm.expectRevert(ColosseumMembership.ZeroManager.selector);
        new ColosseumCitizen(address(0));
    }

    function test_OnlyManagerCanMintAndBurn() public {
        uint256 tokenId = _mintResident(ALICE);

        vm.prank(BOB);
        vm.expectRevert(abi.encodeWithSelector(ColosseumMembership.NotManager.selector, BOB));
        resident.mint(BOB);

        vm.prank(BOB);
        vm.expectRevert(abi.encodeWithSelector(ColosseumMembership.NotManager.selector, BOB));
        resident.burn(tokenId);
    }

    // ---------------------------------------------------------------------
    // One active credential per address
    // ---------------------------------------------------------------------

    function test_BalanceIsZeroOrOne() public {
        assertEq(resident.balanceOf(ALICE), 0);

        uint256 tokenId = _mintResident(ALICE);
        assertEq(tokenId, 1);
        assertEq(resident.balanceOf(ALICE), 1);

        // A second credential for the same address is rejected, so the balance
        // stays at one.
        vm.prank(MANAGER);
        vm.expectRevert(
            abi.encodeWithSelector(ColosseumMembership.AlreadyHoldsCredential.selector, ALICE)
        );
        resident.mint(ALICE);
        assertEq(resident.balanceOf(ALICE), 1);
    }

    // ---------------------------------------------------------------------
    // Mint events
    // ---------------------------------------------------------------------

    function test_MintEmitsTransferAndLocked() public {
        vm.expectEmit(true, true, true, true, address(resident));
        emit IERC721.Transfer(address(0), ALICE, 1);

        vm.expectEmit(true, true, true, true, address(resident));
        emit IERC5192.Locked(1);

        vm.prank(MANAGER);
        resident.mint(ALICE);
    }

    // ---------------------------------------------------------------------
    // ERC-5192
    // ---------------------------------------------------------------------

    function test_LockedIsTrueForAnExistingToken() public {
        uint256 tokenId = _mintResident(ALICE);
        assertTrue(resident.locked(tokenId));
    }

    function test_LockedRevertsForANonExistentToken() public {
        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, uint256(999))
        );
        resident.locked(999);
    }

    function test_LockedRevertsForABurnedToken() public {
        uint256 tokenId = _mintResident(ALICE);

        vm.prank(MANAGER);
        resident.burn(tokenId);

        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, tokenId)
        );
        resident.locked(tokenId);
    }

    // ---------------------------------------------------------------------
    // Soulbound enforcement
    // ---------------------------------------------------------------------

    function test_EveryTransferVariantReverts() public {
        uint256 tokenId = _mintResident(ALICE);

        vm.prank(ALICE);
        vm.expectRevert(ColosseumMembership.Soulbound.selector);
        resident.transferFrom(ALICE, BOB, tokenId);

        vm.prank(ALICE);
        vm.expectRevert(ColosseumMembership.Soulbound.selector);
        resident.safeTransferFrom(ALICE, BOB, tokenId);

        vm.prank(ALICE);
        vm.expectRevert(ColosseumMembership.Soulbound.selector);
        resident.safeTransferFrom(ALICE, BOB, tokenId, "");

        // Single-token approval.
        vm.prank(ALICE);
        resident.approve(OPERATOR, tokenId);
        vm.prank(OPERATOR);
        vm.expectRevert(ColosseumMembership.Soulbound.selector);
        resident.transferFrom(ALICE, BOB, tokenId);

        // Operator for all.
        vm.prank(ALICE);
        resident.setApprovalForAll(OPERATOR, true);
        vm.prank(OPERATOR);
        vm.expectRevert(ColosseumMembership.Soulbound.selector);
        resident.safeTransferFrom(ALICE, BOB, tokenId);

        assertEq(resident.ownerOf(tokenId), ALICE);
        assertEq(resident.balanceOf(BOB), 0);
    }

    // ---------------------------------------------------------------------
    // Burned ids are never reused
    // ---------------------------------------------------------------------

    function test_BurnedIdsAreNotReused() public {
        uint256 first = _mintResident(ALICE);

        vm.prank(MANAGER);
        resident.burn(first);

        uint256 second = _mintResident(BOB);
        assertNotEq(first, second);
        assertEq(second, first + 1);

        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, first)
        );
        resident.locked(first);
        assertTrue(resident.locked(second));
    }

    // ---------------------------------------------------------------------
    // ERC-165 / ERC-721 / ERC-5192 interface support
    // ---------------------------------------------------------------------

    function test_SupportsInterfaceForErc165Erc721AndErc5192() public view {
        assertEq(type(IERC5192).interfaceId, bytes4(0xb45a3c0e));

        assertTrue(resident.supportsInterface(0x01ffc9a7)); // ERC-165
        assertTrue(resident.supportsInterface(0x80ac58cd)); // ERC-721
        assertTrue(resident.supportsInterface(0xb45a3c0e)); // ERC-5192
        assertFalse(resident.supportsInterface(0xdeadbeef));

        assertTrue(citizen.supportsInterface(0x01ffc9a7));
        assertTrue(citizen.supportsInterface(0x80ac58cd));
        assertTrue(citizen.supportsInterface(0xb45a3c0e));
        assertFalse(citizen.supportsInterface(0xdeadbeef));
    }

    // ---------------------------------------------------------------------
    // Metadata: name, image and membership type; no personal data
    // ---------------------------------------------------------------------

    function test_ResidentMetadataCarriesNameImageAndType() public {
        assertEq(resident.name(), "Colosseum Resident");
        assertEq(resident.symbol(), "KRES");
        assertEq(resident.membershipType(), "Resident");
        assertEq(resident.imageURI(), "ipfs://colosseum-resident");

        uint256 tokenId = _mintResident(ALICE);

        string memory expectedJson = string.concat(
            '{"name":"Colosseum Resident #',
            vm.toString(tokenId),
            '","description":"Colosseum Resident credential. Soulbound.",',
            '"image":"ipfs://colosseum-resident",',
            '"membershipType":"Resident",',
            '"attributes":[{"trait_type":"Membership","value":"Resident"}]}'
        );
        assertEq(
            resident.tokenURI(tokenId),
            string.concat("data:application/json;base64,", Base64.encode(bytes(expectedJson)))
        );

        string memory expectedContractJson =
            '{"name":"Colosseum Resident","description":"Colosseum Resident credential. Soulbound.","image":"ipfs://colosseum-resident"}';
        assertEq(
            resident.contractURI(),
            string.concat("data:application/json;base64,", Base64.encode(bytes(expectedContractJson)))
        );
    }

    function test_CitizenMetadataCarriesNameImageAndType() public {
        assertEq(citizen.name(), "Colosseum Citizen");
        assertEq(citizen.symbol(), "KCIT");
        assertEq(citizen.membershipType(), "Citizen");
        assertEq(citizen.imageURI(), "ipfs://colosseum-citizen");

        uint256 tokenId = _mintCitizen(ALICE);

        string memory expectedJson = string.concat(
            '{"name":"Colosseum Citizen #',
            vm.toString(tokenId),
            '","description":"Colosseum Citizen credential. Soulbound.",',
            '"image":"ipfs://colosseum-citizen",',
            '"membershipType":"Citizen",',
            '"attributes":[{"trait_type":"Membership","value":"Citizen"}]}'
        );
        assertEq(
            citizen.tokenURI(tokenId),
            string.concat("data:application/json;base64,", Base64.encode(bytes(expectedJson)))
        );
    }

    function test_TokenUriRevertsForNonExistentToken() public {
        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, uint256(1))
        );
        resident.tokenURI(1);
    }
}
