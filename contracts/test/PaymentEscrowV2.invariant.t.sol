// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console, StdInvariant} from "forge-std/Test.sol";
import {PaymentEscrowV2} from "../src/PaymentEscrowV2.sol";

/// @notice Handler is the "fuzzer's surface" for invariant testing.
///         The Foundry invariant runner randomly calls functions on this
///         handler with random inputs, and the invariant test (below)
///         checks global properties after each sequence.
contract Handler is Test {
    PaymentEscrowV2 public escrow;

    address[] internal agents;
    address[] internal services;

    // Bookkeeping totals -- our "shadow" model of the contract's expected state.
    uint256 public totalDeposited;
    uint256 public totalWithdrawn;
    uint256 public totalSettled;

    // Track claimed nonces to avoid re-using them within the fuzz run
    mapping(bytes32 => bool) internal seenNonceKey;

    bytes32 constant CLAIM_TYPEHASH = keccak256(
        "Claim(address agent,address service,uint256 amount,uint256 nonce,uint256 expiry)"
    );

    constructor(PaymentEscrowV2 _escrow) {
        escrow = _escrow;
        // Pre-create some fixed agents (with deterministic keys) and services
        for (uint256 i = 1; i <= 5; i++) {
            address a = vm.addr(uint256(keccak256(abi.encodePacked("agent", i))));
            agents.push(a);
            vm.deal(a, 1000 ether);
        }
        for (uint256 i = 1; i <= 3; i++) {
            services.push(vm.addr(uint256(keccak256(abi.encodePacked("service", i)))));
        }
    }

    function _agent(uint256 seed) internal view returns (address) {
        return agents[seed % agents.length];
    }

    function _agentPk(uint256 seed) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked("agent", (seed % 5) + 1)));
    }

    function _service(uint256 seed) internal view returns (address) {
        return services[seed % services.length];
    }

    function deposit(uint256 seed, uint256 amount) public {
        amount = bound(amount, 0.001 ether, 10 ether);
        address a = _agent(seed);
        vm.deal(a, a.balance + amount);
        vm.prank(a);
        escrow.deposit{value: amount}();
        totalDeposited += amount;
    }

    function withdraw(uint256 seed, uint256 amount) public {
        address a = _agent(seed);
        uint256 bal = escrow.balanceOf(a);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        vm.prank(a);
        escrow.withdraw(amount);
        totalWithdrawn += amount;
    }

    function _signClaim(
        address a, address s, uint256 amount, uint256 nonce, uint256 expiry, uint256 pk
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, a, s, amount, nonce, expiry));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(pk, digest);
        return abi.encodePacked(r, ss, v);
    }

    function claim(uint256 agentSeed, uint256 svcSeed, uint256 amount, uint256 nonce) public {
        address a = _agent(agentSeed);
        address s = _service(svcSeed);
        uint256 bal = escrow.balanceOf(a);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        nonce = bound(nonce, 1, type(uint128).max);

        bytes32 key = keccak256(abi.encode(a, s, nonce));
        if (escrow.usedNonces(key) || seenNonceKey[key]) return;
        seenNonceKey[key] = true;

        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _signClaim(a, s, amount, nonce, expiry, _agentPk(agentSeed));

        vm.prank(s);
        try escrow.claim(a, amount, nonce, expiry, sig) {
            totalSettled += amount;
        } catch {
            // Some claims may revert (e.g., InsufficientBalance race). That's fine.
        }
    }
}

contract PaymentEscrowV2InvariantTest is StdInvariant, Test {
    PaymentEscrowV2 escrow;
    Handler handler;

    function setUp() public {
        escrow = new PaymentEscrowV2();
        handler = new Handler(escrow);
        targetContract(address(handler));

        // Restrict the fuzzer to handler functions only
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = Handler.deposit.selector;
        selectors[1] = Handler.withdraw.selector;
        selectors[2] = Handler.claim.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    /// @notice INV-1: Conservation of value.
    ///         Sum of all current escrow balances + total settled out + total withdrawn
    ///         must equal total deposited. No value created, no value destroyed.
    function invariant_conservationOfValue() public view {
        uint256 sumBalances;
        for (uint256 i = 1; i <= 5; i++) {
            address a = vm.addr(uint256(keccak256(abi.encodePacked("agent", i))));
            sumBalances += escrow.balanceOf(a);
        }
        assertEq(
            handler.totalDeposited(),
            sumBalances + handler.totalSettled() + handler.totalWithdrawn(),
            "value conservation broken"
        );
    }

    /// @notice INV-2: Native balance of the escrow contract equals sum of current
    ///         agent balances. Anything else means funds got stuck or duplicated.
    function invariant_contractBalanceMatchesBookkeeping() public view {
        uint256 sumBalances;
        for (uint256 i = 1; i <= 5; i++) {
            address a = vm.addr(uint256(keccak256(abi.encodePacked("agent", i))));
            sumBalances += escrow.balanceOf(a);
        }
        assertEq(address(escrow).balance, sumBalances, "contract balance diverged from bookkeeping");
    }

    /// @notice INV-3: No agent can have a negative effective balance
    ///         (i.e. claim more than was ever deposited for them).
    function invariant_balancesNonNegative() public view {
        for (uint256 i = 1; i <= 5; i++) {
            address a = vm.addr(uint256(keccak256(abi.encodePacked("agent", i))));
            assertLe(escrow.balanceOf(a), handler.totalDeposited(), "agent balance exceeds total deposits");
        }
    }
}
