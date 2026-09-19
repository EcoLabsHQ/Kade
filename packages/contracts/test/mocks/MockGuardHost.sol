// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {KadeLock} from "../../src/KadeLock.sol";
import {Enum} from "safe-smart-account/contracts/libraries/Enum.sol";

// Minimal host that mirrors how a Safe calls its Guard: the guard is consulted
// before any value leaves the host. It exists only to prove that KadeLock can
// gate real value movement; it is not a Safe implementation and is never
// deployed.
contract MockGuardHost {
    KadeLock public immutable guard;

    constructor(KadeLock guard_) {
        guard = guard_;
    }

    function execute(address to, uint256 value) external {
        guard.checkTransaction(
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
            msg.sender
        );
        (bool ok, ) = to.call{value: value}("");
        require(ok, "MockGuardHost: transfer failed");
    }

    receive() external payable {}
}
