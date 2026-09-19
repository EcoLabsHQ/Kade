// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Deterministic Safe proxy address derivation (Week 1 contract D4).
//
// D4 requires the resident Safe to resolve to one address on every active
// chain, derived from frozen deployment inputs. Iteration 1 activates Ethereum
// Sepolia and Base Sepolia; Arbitrum is deferred (contract v1.6).
// This library is the pure arithmetic behind that promise. It mirrors the
// canonical Safe v1.5.0 `SafeProxyFactory.createProxyWithNonce`:
//
//   initCode     = proxyCreationCode ++ uint256(uint160(singleton))   // 32-byte word
//   initCodeHash = keccak256(initCode)
//   salt         = keccak256(initCodeHash(initializer) ++ saltNonce)  // 32-byte word
//   address      = keccak256(0xff ++ factory ++ salt ++ initCodeHash)[12:]
//
// The factory, singleton, initializer, salt nonce and proxy creation code are
// **not supplied by the project yet**; every concrete value is [arbitrary] and
// awaits the Account gate (week-1 contract sections 5 and 7). This library
// derives addresses only. It deploys nothing and is not a deployment path.
//
// No chain id is used, because D4 uses the chain-agnostic
// `createProxyWithNonce`. `createChainSpecificProxyWithNonce`, which folds the
// chain id into the salt, would produce different addresses per chain and is
// deliberately not modelled.

/// @title SafeAddress — pure CREATE2 Safe proxy address derivation.
library SafeAddress {
    /// @notice A zero factory can never deploy the proxy; reject it explicitly.
    error ZeroFactory();

    /// @notice `keccak256(proxyCreationCode ++ uint256(uint160(singleton)))`.
    /// @dev The singleton is appended as a full 32-byte word, matching
    ///      `SafeProxyFactory.deployProxy`'s `abi.encodePacked(..., uint256(uint160(_singleton)))`.
    function proxyInitCodeHash(
        bytes memory proxyCreationCode,
        address singleton
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(proxyCreationCode, uint256(uint160(singleton))));
    }

    /// @notice `keccak256(initializerHash ++ uint256(saltNonce))`.
    /// @dev Matches `createProxyWithNonce`'s
    ///      `keccak256(abi.encodePacked(keccak256(initializer), saltNonce))`.
    function safeSalt(bytes32 initializerHash, uint256 saltNonce) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(initializerHash, saltNonce));
    }

    /// @notice Predicts the Safe proxy address for the given frozen inputs.
    /// @param factory The SafeProxyFactory that will deploy with CREATE2.
    /// @param singleton The Safe singleton (master copy) the proxy delegates to.
    /// @param initializerHash `keccak256` of the Safe setup initializer calldata.
    /// @param saltNonce The salt nonce passed to `createProxyWithNonce`.
    /// @param proxyCreationCode `SafeProxy` creation code from the factory version.
    function predictSafeAddress(
        address factory,
        address singleton,
        bytes32 initializerHash,
        uint256 saltNonce,
        bytes memory proxyCreationCode
    ) internal pure returns (address) {
        if (factory == address(0)) revert ZeroFactory();
        bytes32 initCodeHash = proxyInitCodeHash(proxyCreationCode, singleton);
        bytes32 salt = safeSalt(initializerHash, saltNonce);
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"ff", factory, salt, initCodeHash)))));
    }
}
