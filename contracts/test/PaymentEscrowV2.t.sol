// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {PaymentEscrowV2} from "../src/PaymentEscrowV2.sol";

contract PaymentEscrowV2Test is Test {
    PaymentEscrowV2 escrow;

    uint256 constant AGENT_PK = 0xA1;
    uint256 constant SESSION_PK = 0xB1;
    address agent;
    address sessionKey;
    address service = makeAddr("service");

    bytes32 constant CLAIM_TYPEHASH = keccak256(
        "Claim(address agent,address service,uint256 amount,uint256 nonce,uint256 expiry)"
    );

    function setUp() public {
        escrow = new PaymentEscrowV2();
        agent = vm.addr(AGENT_PK);
        sessionKey = vm.addr(SESSION_PK);
        vm.deal(agent, 1000 ether);
        vm.deal(makeAddr("funder"), 100 ether);
    }

    /* -------------------------- helpers -------------------------- */

    function _signClaim(
        uint256 pk,
        address claimedAgent,
        address svc,
        uint256 amount,
        uint256 nonce,
        uint256 expiry
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(CLAIM_TYPEHASH, claimedAgent, svc, amount, nonce, expiry)
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", escrow.DOMAIN_SEPARATOR(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _mkClaim(uint256 amt, uint256 nonce, uint256 expiry)
        internal view returns (PaymentEscrowV2.Claim memory)
    {
        bytes memory sig = _signClaim(AGENT_PK, agent, service, amt, nonce, expiry);
        return PaymentEscrowV2.Claim(agent, amt, nonce, expiry, sig);
    }

    /* -------------------------- deposit / depositFor -------------------------- */

    function test_deposit() public {
        vm.prank(agent);
        escrow.deposit{value: 10 ether}();
        assertEq(escrow.balanceOf(agent), 10 ether);
    }

    function test_depositFor_sponsorship() public {
        address funder = makeAddr("funder");
        address freshAgent = makeAddr("fresh");
        vm.prank(funder);
        escrow.depositFor{value: 5 ether}(freshAgent);
        assertEq(escrow.balanceOf(freshAgent), 5 ether);
        assertEq(escrow.balanceOf(funder), 0);
    }

    function test_depositFor_zeroAddress_reverts() public {
        vm.prank(agent);
        vm.expectRevert(PaymentEscrowV2.InvalidSignature.selector);
        escrow.depositFor{value: 1 ether}(address(0));
    }

    /* ---------------------------- claim (single) ------------------------------ */

    function test_claim_single() public {
        vm.prank(agent);
        escrow.deposit{value: 10 ether}();
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _signClaim(AGENT_PK, agent, service, 1 ether, 1, expiry);

        vm.prank(service);
        escrow.claim(agent, 1 ether, 1, expiry, sig);
        assertEq(escrow.balanceOf(agent), 9 ether);
        assertEq(service.balance, 1 ether);
    }

    /* ---------------------------- claimBatch ---------------------------------- */

    function test_claimBatch_three() public {
        vm.prank(agent);
        escrow.deposit{value: 10 ether}();

        uint256 expiry = block.timestamp + 1 hours;
        PaymentEscrowV2.Claim[] memory claims = new PaymentEscrowV2.Claim[](3);
        claims[0] = _mkClaim(0.5 ether, 1, expiry);
        claims[1] = _mkClaim(0.5 ether, 2, expiry);
        claims[2] = _mkClaim(0.5 ether, 3, expiry);

        vm.prank(service);
        escrow.claimBatch(claims);

        assertEq(escrow.balanceOf(agent), 8.5 ether);
        assertEq(service.balance, 1.5 ether);
        assertTrue(escrow.isNonceUsed(agent, service, 1));
        assertTrue(escrow.isNonceUsed(agent, service, 2));
        assertTrue(escrow.isNonceUsed(agent, service, 3));
    }

    function test_claimBatch_empty_reverts() public {
        PaymentEscrowV2.Claim[] memory claims = new PaymentEscrowV2.Claim[](0);
        vm.prank(service);
        vm.expectRevert(PaymentEscrowV2.EmptyBatch.selector);
        escrow.claimBatch(claims);
    }

    function test_claimBatch_atomicity_oneBadRevertsAll() public {
        vm.prank(agent);
        escrow.deposit{value: 10 ether}();

        uint256 expiry = block.timestamp + 1 hours;
        PaymentEscrowV2.Claim[] memory claims = new PaymentEscrowV2.Claim[](3);
        claims[0] = _mkClaim(1 ether, 1, expiry);
        // Tamper claim[1] sig:
        bytes memory badSig = _signClaim(AGENT_PK, agent, service, 1 ether, 2, expiry);
        badSig[0] = bytes1(uint8(badSig[0]) ^ 0xFF);
        claims[1] = PaymentEscrowV2.Claim(agent, 1 ether, 2, expiry, badSig);
        claims[2] = _mkClaim(1 ether, 3, expiry);

        uint256 balBefore = escrow.balanceOf(agent);
        vm.prank(service);
        vm.expectRevert();
        escrow.claimBatch(claims);
        // No state change because of revert
        assertEq(escrow.balanceOf(agent), balBefore);
        assertFalse(escrow.isNonceUsed(agent, service, 1));
        assertFalse(escrow.isNonceUsed(agent, service, 3));
    }

    function test_claimBatch_mixedAgents() public {
        uint256 agent2PK = 0xA2;
        address agent2 = vm.addr(agent2PK);
        vm.deal(agent2, 100 ether);
        vm.prank(agent);
        escrow.deposit{value: 5 ether}();
        vm.prank(agent2);
        escrow.deposit{value: 5 ether}();

        uint256 expiry = block.timestamp + 1 hours;
        PaymentEscrowV2.Claim[] memory claims = new PaymentEscrowV2.Claim[](2);
        claims[0] = _mkClaim(1 ether, 1, expiry);
        bytes memory sig2 = _signClaim(agent2PK, agent2, service, 2 ether, 1, expiry);
        claims[1] = PaymentEscrowV2.Claim(agent2, 2 ether, 1, expiry, sig2);

        vm.prank(service);
        escrow.claimBatch(claims);

        assertEq(escrow.balanceOf(agent), 4 ether);
        assertEq(escrow.balanceOf(agent2), 3 ether);
        assertEq(service.balance, 3 ether);
    }

    /* ---------------------------- session keys -------------------------------- */

    function test_session_signedBy_sessionKey_works() public {
        vm.prank(agent);
        escrow.deposit{value: 10 ether}();
        uint64 sessionExp = uint64(block.timestamp + 1 days);
        vm.prank(agent);
        escrow.authorizeSession(sessionKey, sessionExp);

        // Claim signed by sessionKey (not agent)
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _signClaim(SESSION_PK, agent, service, 1 ether, 99, expiry);

        vm.prank(service);
        escrow.claim(agent, 1 ether, 99, expiry, sig);
        assertEq(escrow.balanceOf(agent), 9 ether);
    }

    function test_session_unauthorized_signer_reverts() public {
        vm.prank(agent);
        escrow.deposit{value: 10 ether}();
        // sessionKey NOT authorized
        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _signClaim(SESSION_PK, agent, service, 1 ether, 99, expiry);

        vm.prank(service);
        vm.expectRevert(PaymentEscrowV2.InvalidSignature.selector);
        escrow.claim(agent, 1 ether, 99, expiry, sig);
    }

    function test_session_expired_reverts() public {
        vm.prank(agent);
        escrow.deposit{value: 10 ether}();
        uint64 sessionExp = uint64(block.timestamp + 1 hours);
        vm.prank(agent);
        escrow.authorizeSession(sessionKey, sessionExp);

        vm.warp(block.timestamp + 2 hours); // past session expiry

        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _signClaim(SESSION_PK, agent, service, 1 ether, 99, expiry);

        vm.prank(service);
        vm.expectRevert(PaymentEscrowV2.SessionExpiredOrUnknown.selector);
        escrow.claim(agent, 1 ether, 99, expiry, sig);
    }

    function test_session_revoke_works() public {
        vm.prank(agent);
        escrow.deposit{value: 10 ether}();
        vm.prank(agent);
        escrow.authorizeSession(sessionKey, uint64(block.timestamp + 1 days));
        vm.prank(agent);
        escrow.revokeSession(sessionKey);

        uint256 expiry = block.timestamp + 1 hours;
        bytes memory sig = _signClaim(SESSION_PK, agent, service, 1 ether, 99, expiry);
        vm.prank(service);
        vm.expectRevert(PaymentEscrowV2.InvalidSignature.selector);
        escrow.claim(agent, 1 ether, 99, expiry, sig);
    }

    /* ----------------------------- replay --------------------------------- */

    function test_claimBatch_replayWithinBatch_reverts() public {
        vm.prank(agent);
        escrow.deposit{value: 10 ether}();
        uint256 expiry = block.timestamp + 1 hours;
        PaymentEscrowV2.Claim[] memory claims = new PaymentEscrowV2.Claim[](2);
        claims[0] = _mkClaim(1 ether, 7, expiry);
        claims[1] = _mkClaim(1 ether, 7, expiry); // same nonce

        vm.prank(service);
        vm.expectRevert(PaymentEscrowV2.NonceAlreadyUsed.selector);
        escrow.claimBatch(claims);
    }

    /* ----------------------------- gas curve ------------------------------ */

    function test_gas_curve_singleVsBatch() public {
        vm.prank(agent);
        escrow.deposit{value: 1000 ether}();
        uint256 expiry = block.timestamp + 1 hours;

        // Single claim
        bytes memory sigA = _signClaim(AGENT_PK, agent, service, 0.001 ether, 1001, expiry);
        vm.prank(service);
        uint256 g1Before = gasleft();
        escrow.claim(agent, 0.001 ether, 1001, expiry, sigA);
        uint256 gasSingle = g1Before - gasleft();
        console.log("Gas per claim (single):", gasSingle);

        // Batch 10
        PaymentEscrowV2.Claim[] memory ten = new PaymentEscrowV2.Claim[](10);
        for (uint256 i; i < 10; i++) {
            ten[i] = _mkClaim(0.001 ether, 2000 + i, expiry);
        }
        vm.prank(service);
        uint256 g10Before = gasleft();
        escrow.claimBatch(ten);
        uint256 gas10 = g10Before - gasleft();
        console.log("Gas for batch=10  (total):", gas10);
        console.log("Gas per claim (batch=10):", gas10 / 10);

        // Batch 50
        PaymentEscrowV2.Claim[] memory fifty = new PaymentEscrowV2.Claim[](50);
        for (uint256 i; i < 50; i++) {
            fifty[i] = _mkClaim(0.001 ether, 3000 + i, expiry);
        }
        vm.prank(service);
        uint256 g50Before = gasleft();
        escrow.claimBatch(fifty);
        uint256 gas50 = g50Before - gasleft();
        console.log("Gas for batch=50  (total):", gas50);
        console.log("Gas per claim (batch=50):", gas50 / 50);

        // Batch 100
        PaymentEscrowV2.Claim[] memory hundred = new PaymentEscrowV2.Claim[](100);
        for (uint256 i; i < 100; i++) {
            hundred[i] = _mkClaim(0.001 ether, 4000 + i, expiry);
        }
        vm.prank(service);
        uint256 g100Before = gasleft();
        escrow.claimBatch(hundred);
        uint256 gas100 = g100Before - gasleft();
        console.log("Gas for batch=100 (total):", gas100);
        console.log("Gas per claim (batch=100):", gas100 / 100);

        // Assert batched is meaningfully cheaper
        assertLt(gas10 / 10, gasSingle, "batch=10 per-claim should be < single");
        assertLt(gas100 / 100, gas10 / 10, "batch=100 per-claim should be < batch=10");
    }

    /* ----------------------------- fuzz ------------------------------------- */

    function testFuzz_batchSize(uint256 n) public {
        n = bound(n, 1, 30);
        vm.prank(agent);
        escrow.deposit{value: 100 ether}();
        uint256 expiry = block.timestamp + 1 hours;
        PaymentEscrowV2.Claim[] memory cs = new PaymentEscrowV2.Claim[](n);
        for (uint256 i; i < n; i++) {
            cs[i] = _mkClaim(0.01 ether, 5000 + i, expiry);
        }
        vm.prank(service);
        escrow.claimBatch(cs);
        assertEq(escrow.balanceOf(agent), 100 ether - 0.01 ether * n);
    }
}
