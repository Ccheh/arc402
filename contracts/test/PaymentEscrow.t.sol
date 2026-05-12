// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PaymentEscrow} from "../src/PaymentEscrow.sol";

contract PaymentEscrowTest is Test {
    PaymentEscrow escrow;

    uint256 constant AGENT_PK = 0xA1;
    address agent;
    address service = makeAddr("service");

    bytes32 constant CLAIM_TYPEHASH = keccak256(
        "Claim(address agent,address service,uint256 amount,uint256 nonce,uint256 expiry)"
    );

    function setUp() public {
        escrow = new PaymentEscrow();
        agent = vm.addr(AGENT_PK);
        vm.deal(agent, 100 ether);
    }

    function _signClaim(
        uint256 pk,
        address svc,
        uint256 amount,
        uint256 nonce,
        uint256 expiry
    ) internal view returns (bytes memory) {
        address signer = vm.addr(pk);
        bytes32 structHash = keccak256(
            abi.encode(CLAIM_TYPEHASH, signer, svc, amount, nonce, expiry)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", escrow.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /* ---------------------------- deposit / withdraw ---------------------------- */

    function test_deposit() public {
        vm.prank(agent);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit PaymentEscrow.Deposited(agent, 10 ether, 10 ether);
        escrow.deposit{value: 10 ether}();
        assertEq(escrow.balanceOf(agent), 10 ether);
    }

    function test_deposit_zero_reverts() public {
        vm.prank(agent);
        vm.expectRevert(PaymentEscrow.ZeroAmount.selector);
        escrow.deposit{value: 0}();
    }

    function test_withdraw_partial() public {
        vm.startPrank(agent);
        escrow.deposit{value: 10 ether}();
        uint256 balBefore = agent.balance;
        escrow.withdraw(3 ether);
        assertEq(escrow.balanceOf(agent), 7 ether);
        assertEq(agent.balance, balBefore + 3 ether);
        vm.stopPrank();
    }

    function test_withdraw_full() public {
        vm.startPrank(agent);
        escrow.deposit{value: 5 ether}();
        escrow.withdraw(5 ether);
        assertEq(escrow.balanceOf(agent), 0);
        vm.stopPrank();
    }

    function test_withdraw_insufficient_reverts() public {
        vm.startPrank(agent);
        escrow.deposit{value: 1 ether}();
        vm.expectRevert(PaymentEscrow.InsufficientBalance.selector);
        escrow.withdraw(2 ether);
        vm.stopPrank();
    }

    function test_withdraw_zero_reverts() public {
        vm.prank(agent);
        vm.expectRevert(PaymentEscrow.ZeroAmount.selector);
        escrow.withdraw(0);
    }

    /* --------------------------------- claim ---------------------------------- */

    function test_claim_happy() public {
        vm.prank(agent);
        escrow.deposit{value: 10 ether}();

        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _signClaim(AGENT_PK, service, 1 ether, 1, expiry);
        uint256 svcBalBefore = service.balance;

        vm.prank(service);
        escrow.claim(agent, 1 ether, 1, expiry, sig);

        assertEq(escrow.balanceOf(agent), 9 ether);
        assertEq(service.balance, svcBalBefore + 1 ether);
        assertTrue(escrow.isNonceUsed(agent, service, 1));
    }

    function test_claim_replay_reverts() public {
        vm.prank(agent);
        escrow.deposit{value: 10 ether}();

        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _signClaim(AGENT_PK, service, 1 ether, 1, expiry);

        vm.startPrank(service);
        escrow.claim(agent, 1 ether, 1, expiry, sig);
        vm.expectRevert(PaymentEscrow.NonceAlreadyUsed.selector);
        escrow.claim(agent, 1 ether, 1, expiry, sig);
        vm.stopPrank();
    }

    function test_claim_expired_reverts() public {
        vm.prank(agent);
        escrow.deposit{value: 10 ether}();

        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _signClaim(AGENT_PK, service, 1 ether, 1, expiry);
        vm.warp(expiry + 1);

        vm.prank(service);
        vm.expectRevert(PaymentEscrow.ClaimExpired.selector);
        escrow.claim(agent, 1 ether, 1, expiry, sig);
    }

    function test_claim_wrong_service_reverts() public {
        vm.prank(agent);
        escrow.deposit{value: 10 ether}();

        // Signed FOR `service`, but a different attacker tries to claim
        bytes memory sig = _signClaim(AGENT_PK, service, 1 ether, 1, block.timestamp + 1 hours);
        address attacker = makeAddr("attacker");

        vm.prank(attacker);
        vm.expectRevert(PaymentEscrow.InvalidSignature.selector);
        escrow.claim(agent, 1 ether, 1, block.timestamp + 1 hours, sig);
    }

    function test_claim_tampered_sig_reverts() public {
        vm.prank(agent);
        escrow.deposit{value: 10 ether}();

        bytes memory sig = _signClaim(AGENT_PK, service, 1 ether, 1, block.timestamp + 1 hours);
        sig[0] = bytes1(uint8(sig[0]) ^ 0x01); // flip a bit

        vm.prank(service);
        vm.expectRevert(); // ECDSA library reverts before our InvalidSignature, both OK
        escrow.claim(agent, 1 ether, 1, block.timestamp + 1 hours, sig);
    }

    function test_claim_insufficient_balance_reverts() public {
        vm.prank(agent);
        escrow.deposit{value: 0.5 ether}();

        bytes memory sig = _signClaim(AGENT_PK, service, 1 ether, 1, block.timestamp + 1 hours);
        vm.prank(service);
        vm.expectRevert(PaymentEscrow.InsufficientBalance.selector);
        escrow.claim(agent, 1 ether, 1, block.timestamp + 1 hours, sig);
    }

    function test_claim_wrong_signer_reverts() public {
        vm.prank(agent);
        escrow.deposit{value: 10 ether}();

        // Sig from a DIFFERENT private key, but tries to claim as `agent`
        uint256 otherPK = 0xB2;
        bytes memory sig = _signClaim(otherPK, service, 1 ether, 1, block.timestamp + 1 hours);

        vm.prank(service);
        vm.expectRevert(PaymentEscrow.InvalidSignature.selector);
        escrow.claim(agent, 1 ether, 1, block.timestamp + 1 hours, sig);
    }

    function test_claim_zero_amount_reverts() public {
        vm.prank(agent);
        escrow.deposit{value: 10 ether}();
        bytes memory sig = _signClaim(AGENT_PK, service, 0, 1, block.timestamp + 1 hours);
        vm.prank(service);
        vm.expectRevert(PaymentEscrow.ZeroAmount.selector);
        escrow.claim(agent, 0, 1, block.timestamp + 1 hours, sig);
    }

    /* ----------------------------- fuzz / invariant --------------------------- */

    function testFuzz_deposit_withdraw_roundtrip(uint96 amount) public {
        vm.assume(amount > 0 && amount <= 100 ether);
        vm.startPrank(agent);
        escrow.deposit{value: amount}();
        assertEq(escrow.balanceOf(agent), amount);
        escrow.withdraw(amount);
        assertEq(escrow.balanceOf(agent), 0);
        vm.stopPrank();
    }

    function testFuzz_claim_partial(uint96 deposit_, uint96 claim_) public {
        vm.assume(deposit_ > 0 && deposit_ <= 100 ether);
        vm.assume(claim_ > 0 && claim_ <= deposit_);

        vm.prank(agent);
        escrow.deposit{value: deposit_}();

        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _signClaim(AGENT_PK, service, claim_, 42, expiry);

        vm.prank(service);
        escrow.claim(agent, claim_, 42, expiry, sig);
        assertEq(escrow.balanceOf(agent), uint256(deposit_) - uint256(claim_));
    }
}
