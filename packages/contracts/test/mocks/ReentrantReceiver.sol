// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC721Receiver} from "openzeppelin-contracts/contracts/token/ERC721/IERC721Receiver.sol";
import {MembershipManager} from "../../src/MembershipManager.sol";

// ReentrantReceiver — on every ERC-721 receipt it tries to re-enter the manager
// with a duplicate issue, swallowing the expected revert so the outer mint can
// complete. Used to prove a reentrant receiver cannot mint a duplicate or end
// up holding both credentials. Test-only; never deployed.
contract ReentrantReceiver is IERC721Receiver {
    MembershipManager public immutable manager;

    uint256 public attempts;
    uint256 public reverted;

    constructor(MembershipManager manager_) {
        manager = manager_;
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external returns (bytes4) {
        attempts++;
        try manager.issueResident(address(this)) {
            // Should be unreachable: the manager is reentrancy-protected.
        } catch {
            reverted++;
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}
