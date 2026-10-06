// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC721Receiver} from "openzeppelin-contracts/contracts/token/ERC721/IERC721Receiver.sol";

// RejectingReceiver — accepts ERC-721 tokens from every collection except
// `rejectCollection`. Used to prove that a promotion whose Citizen mint is
// rejected reverts atomically and leaves the Resident credential intact.
// Test-only; never deployed.
contract RejectingReceiver is IERC721Receiver {
    address public rejectCollection;

    function setRejectCollection(address collection) external {
        rejectCollection = collection;
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external view returns (bytes4) {
        if (msg.sender == rejectCollection) revert("RejectingReceiver: rejected");
        return IERC721Receiver.onERC721Received.selector;
    }
}
