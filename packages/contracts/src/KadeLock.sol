// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Guard} from "safe-smart-account/contracts/base/GuardManager.sol";
import {Enum} from "safe-smart-account/contracts/common/Enum.sol";
import {IERC165} from "safe-smart-account/contracts/interfaces/IERC165.sol";

// KadeLock — Week 1 MVP Safe Guard.
//
// This implementation demonstrates time-based locking and destination
// allowlisting for native-value transactions. It is compiled and tested
// during Week 1 but is not intended as the production enforcement layer.
//
// Future versions may require a single-use, transaction-specific
// authorization signed by Kade's compliance service.
//
// Scope, roles, invariants and residual risks:
// docs/architecture/kadelock-threat-model.md.
// Compiled and Foundry-tested only; NOT deployed in Week 1
// (week-1 contract sections 6.2 and 9).
//
// Guard interface source: safe-smart-account v1.4.1
// (contracts/base/GuardManager.sol), installed under lib/ by scripts/setup.sh.
contract KadeLock is Guard {
    event AdminChanged(address indexed previousAdmin, address indexed newAdmin);
    event UnlockAtChanged(uint64 previousUnlockAt, uint64 newUnlockAt);
    event DestinationAllowed(address indexed destination);
    event DestinationDisallowed(address indexed destination);

    error NotAdmin(address caller);
    error ZeroAdmin();
    error ZeroDestination();
    error UnlockAtNotInFuture(uint64 unlockAt);
    error DestinationNotAllowed(address destination);

    address public admin;
    uint64 public unlockAt;
    mapping(address destination => bool allowed) public allowedDestinations;

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin(msg.sender);
        _;
    }

    constructor(address initialAdmin, uint64 initialUnlockAt) {
        if (initialAdmin == address(0)) revert ZeroAdmin();
        admin = initialAdmin;
        unlockAt = initialUnlockAt;
        emit AdminChanged(address(0), initialAdmin);
        emit UnlockAtChanged(0, initialUnlockAt);
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAdmin();
        emit AdminChanged(admin, newAdmin);
        admin = newAdmin;
    }

    function lock(uint64 until) external onlyAdmin {
        if (until <= block.timestamp) revert UnlockAtNotInFuture(until);
        emit UnlockAtChanged(unlockAt, until);
        unlockAt = until;
    }

    function unlock() external onlyAdmin {
        uint64 currentTime = uint64(block.timestamp);
        emit UnlockAtChanged(unlockAt, currentTime);
        unlockAt = currentTime;
    }

    function allowDestination(address destination) external onlyAdmin {
        if (destination == address(0)) revert ZeroDestination();
        allowedDestinations[destination] = true;
        emit DestinationAllowed(destination);
    }

    function disallowDestination(address destination) external onlyAdmin {
        allowedDestinations[destination] = false;
        emit DestinationDisallowed(destination);
    }

    function isLocked() public view returns (bool) {
        return block.timestamp < unlockAt;
    }

    function checkTransaction(
        address to,
        uint256 value,
        bytes memory,
        Enum.Operation,
        uint256,
        uint256,
        uint256,
        address,
        address payable,
        bytes memory,
        address
    ) external view override {
        if (!isLocked()) return;
        if (value == 0) return;
        if (allowedDestinations[to]) return;
        revert DestinationNotAllowed(to);
    }

    function checkAfterExecution(bytes32, bool) external override {}

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(Guard).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
