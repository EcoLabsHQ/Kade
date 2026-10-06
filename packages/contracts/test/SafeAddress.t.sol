// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {SafeAddress} from "../src/SafeAddress.sol";
import {SafeProxy} from "safe-smart-account/contracts/proxies/SafeProxy.sol";

// External wrapper so `vm.expectRevert` can observe a revert from an internal
// library call (Foundry requires the revert at a lower call depth).
contract SafeAddressHarness {
    function predict(
        address factory,
        address singleton,
        bytes32 initializerHash,
        uint256 saltNonce,
        bytes memory proxyCreationCode
    ) external pure returns (address) {
        return
            SafeAddress.predictSafeAddress(
                factory,
                singleton,
                initializerHash,
                saltNonce,
                proxyCreationCode
            );
    }
}

// D4 deterministic-address machinery.
//
// These tests pin the arithmetic in src/SafeAddress.sol against:
//   1. a fixed synthetic vector — it tests the arithmetic, not the deployment;
//   2. Foundry's own `vm.computeCreate2Address` oracle; and
//   3. the creation-code assumption itself (`keccak256(type(SafeProxy).creationCode)`),
//      which pins *this repository's* artifact so a toolchain change is loud.
//
// How the known vector was constructed is recorded in the header of
// scripts/safe-address-vector.mjs and can be re-derived with
// `node scripts/safe-address-vector.mjs` after `forge build`.
contract SafeAddressTest is Test {
    // --- Known vector: synthetic inputs, chosen to exercise the arithmetic.
    address internal constant FACTORY = address(0x1111111111111111111111111111111111111111);
    address internal constant SINGLETON = address(0x2222222222222222222222222222222222222222);
    // keccak256("kade-safe-initializer-vector-v1"). Stands in for the real
    // keccak256 of the Safe setup initializer (WebAuthn signer, threshold 1).
    bytes32 internal constant INITIALIZER_HASH =
        0x9a780d80c645a85c08e4b8239cdf4144595d63891e554e6791844c0a7802ce49;
    uint256 internal constant SALT_NONCE = 0;

    // Expected outputs of the same [arbitrary] vector. Re-derived independently
    // (viem) from this repository's compiled `SafeProxy` creation code by
    // `node scripts/safe-address-vector.mjs`.
    //
    // These values were re-derived when the pinned OpenZeppelin dependency
    // (v5.7.0) was added for the Colosseum Membership contracts. Foundry
    // compiles every source in one solc input, so adding sources changes each
    // artifact's metadata (and therefore its creation code). The change is
    // loud on purpose; the vector arithmetic itself is unchanged.
    //
    // NOTE: this hash pins our own build. It is deliberately NOT the code the
    // deployed factory uses (438 bytes, 0x941b3e88…), so it must not be used to
    // derive a real account address.
    address internal constant EXPECTED_ADDRESS = 0x82d8D41378E916167Cb0ddef489B0fb9887c217c;
    bytes32 internal constant PROXY_CREATION_CODE_HASH =
        0xf2deadba95d5ae1951007f5719ce3eaa70b96918e544e6b31e519b08d3279f9d;

    bytes internal proxyCreationCode;

    function setUp() public {
        proxyCreationCode = type(SafeProxy).creationCode;
    }

    function _predict(
        address factory,
        address singleton,
        bytes32 initializerHash,
        uint256 saltNonce
    ) internal view returns (address) {
        return
            SafeAddress.predictSafeAddress(
                factory,
                singleton,
                initializerHash,
                saltNonce,
                proxyCreationCode
            );
    }

    // ---------------------------------------------------------------------
    // Known vector
    // ---------------------------------------------------------------------

    function test_PredictsKnownSafeAddressVector() public view {
        assertEq(_predict(FACTORY, SINGLETON, INITIALIZER_HASH, SALT_NONCE), EXPECTED_ADDRESS);
    }

    function test_PinsProxyCreationCodeAssumption() public view {
        assertEq(keccak256(proxyCreationCode), PROXY_CREATION_CODE_HASH);
    }

    function test_InitCodeAppendsSingletonAs32ByteWord() public view {
        bytes memory initCode = abi.encodePacked(proxyCreationCode, uint256(uint160(SINGLETON)));
        assertEq(keccak256(initCode), SafeAddress.proxyInitCodeHash(proxyCreationCode, SINGLETON));
    }

    function test_SaltIsHashOfInitializerHashAndNonce() public pure {
        assertEq(
            SafeAddress.safeSalt(INITIALIZER_HASH, SALT_NONCE),
            keccak256(abi.encodePacked(INITIALIZER_HASH, SALT_NONCE))
        );
    }

    // ---------------------------------------------------------------------
    // Cross-check against Foundry's CREATE2 oracle
    // ---------------------------------------------------------------------

    function test_MatchesVmComputeCreate2Address() public view {
        bytes32 initCodeHash = SafeAddress.proxyInitCodeHash(proxyCreationCode, SINGLETON);
        bytes32 salt = SafeAddress.safeSalt(INITIALIZER_HASH, SALT_NONCE);

        assertEq(
            _predict(FACTORY, SINGLETON, INITIALIZER_HASH, SALT_NONCE),
            vm.computeCreate2Address(salt, initCodeHash, FACTORY)
        );
    }

    // ---------------------------------------------------------------------
    // D4's property: changing any one input changes the address
    // ---------------------------------------------------------------------

    function test_ChangingFactoryChangesAddress() public view {
        address baseline = _predict(FACTORY, SINGLETON, INITIALIZER_HASH, SALT_NONCE);
        address changed = _predict(
            address(0x1111111111111111111111111111111111111122),
            SINGLETON,
            INITIALIZER_HASH,
            SALT_NONCE
        );
        assertNotEq(baseline, changed);
    }

    function test_ChangingSingletonChangesAddress() public view {
        address baseline = _predict(FACTORY, SINGLETON, INITIALIZER_HASH, SALT_NONCE);
        address changed = _predict(
            FACTORY,
            address(0x2222222222222222222222222222222222222233),
            INITIALIZER_HASH,
            SALT_NONCE
        );
        assertNotEq(baseline, changed);
    }

    function test_ChangingInitializerHashChangesAddress() public view {
        address baseline = _predict(FACTORY, SINGLETON, INITIALIZER_HASH, SALT_NONCE);
        address changed = _predict(FACTORY, SINGLETON, bytes32(uint256(1)), SALT_NONCE);
        assertNotEq(baseline, changed);
    }

    function test_ChangingSaltNonceChangesAddress() public view {
        address baseline = _predict(FACTORY, SINGLETON, INITIALIZER_HASH, SALT_NONCE);
        address changed = _predict(FACTORY, SINGLETON, INITIALIZER_HASH, SALT_NONCE + 1);
        assertNotEq(baseline, changed);
    }

    function test_ChangingCreationCodeChangesAddress() public view {
        address baseline = _predict(FACTORY, SINGLETON, INITIALIZER_HASH, SALT_NONCE);
        address changed = SafeAddress.predictSafeAddress(
            FACTORY,
            SINGLETON,
            INITIALIZER_HASH,
            SALT_NONCE,
            hex"60006000"
        );
        assertNotEq(baseline, changed);
    }

    // ---------------------------------------------------------------------
    // D4's cross-chain requirement
    // ---------------------------------------------------------------------

    function test_AddressIsIndependentOfChainId() public {
        address baseline = _predict(FACTORY, SINGLETON, INITIALIZER_HASH, SALT_NONCE);

        vm.chainId(11155111); // Ethereum Sepolia
        assertEq(_predict(FACTORY, SINGLETON, INITIALIZER_HASH, SALT_NONCE), baseline);

        vm.chainId(421614); // Arbitrum Sepolia
        assertEq(_predict(FACTORY, SINGLETON, INITIALIZER_HASH, SALT_NONCE), baseline);

        vm.chainId(84532); // Base Sepolia
        assertEq(_predict(FACTORY, SINGLETON, INITIALIZER_HASH, SALT_NONCE), baseline);
    }

    // ---------------------------------------------------------------------
    // Input validation
    // ---------------------------------------------------------------------

    function test_ZeroFactoryReverts() public {
        SafeAddressHarness harness = new SafeAddressHarness();
        vm.expectRevert(SafeAddress.ZeroFactory.selector);
        harness.predict(address(0), SINGLETON, INITIALIZER_HASH, SALT_NONCE, proxyCreationCode);
    }
}
