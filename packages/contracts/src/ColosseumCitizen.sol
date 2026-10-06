// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ColosseumMembership} from "./ColosseumMembership.sol";

// ColosseumCitizen — soulbound ERC-721 (ERC-5192) Citizen credential.
//
// Scope and status: compiled and Foundry-tested only. NOT deployed. The
// manager is the only account allowed to mint or burn.
contract ColosseumCitizen is ColosseumMembership {
    // Placeholder image; replaced with the real asset at deployment (there is
    // no deployment in this iteration).
    string private constant IMAGE = "ipfs://colosseum-citizen";

    constructor(
        address manager_
    ) ColosseumMembership(manager_, "Colosseum Citizen", "KCIT") {}

    function membershipType() public pure override returns (string memory) {
        return "Citizen";
    }

    function imageURI() public pure override returns (string memory) {
        return IMAGE;
    }

    function description() public pure override returns (string memory) {
        return "Colosseum Citizen credential. Soulbound.";
    }
}
