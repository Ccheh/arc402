// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";

/// @title  PaymentEscrowV2
/// @notice Streaming USDC micropayments for AI agents on Arc. V2 adds:
///         (1) batched on-chain settlement via `claimBatch`,
///         (2) third-party deposit via `depositFor` (sponsorship pattern),
///         (3) protocol-level session keys via `authorizeSession` -- a delegated
///             key can sign claims on behalf of the agent without holding funds.
/// @dev    Backward-incompatible with V1 only in EIP-712 domain version ("2"),
///         so claims signed for V1 cannot be replayed against V2 (and vice versa).
contract PaymentEscrowV2 is EIP712, ReentrancyGuard {
    mapping(address agent => uint256) public balanceOf;
    mapping(bytes32 nonceKey => bool) public usedNonces;

    /// @dev sessionKey => agent it acts for. Zero address means no active delegation.
    mapping(address sessionKey => address) public sessionOf;

    /// @dev When the session was authorized (block.timestamp). Used to invalidate stale sessions.
    mapping(address sessionKey => uint64) public sessionAuthorizedAt;

    /// @dev session key authorization expiry per (agent, sessionKey).
    mapping(bytes32 => uint64) public sessionExpiry;

    bytes32 private constant CLAIM_TYPEHASH = keccak256(
        "Claim(address agent,address service,uint256 amount,uint256 nonce,uint256 expiry)"
    );

    bytes32 private constant SESSION_AUTH_TYPEHASH = keccak256(
        "SessionAuth(address agent,address sessionKey,uint64 expiry,uint256 nonce)"
    );

    event Deposited(address indexed agent, address indexed funder, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed agent, uint256 amount, uint256 newBalance);
    event Claimed(
        address indexed agent,
        address indexed service,
        uint256 amount,
        uint256 nonce,
        uint256 expiry,
        address signer
    );
    event SessionAuthorized(address indexed agent, address indexed sessionKey, uint64 expiry);
    event SessionRevoked(address indexed agent, address indexed sessionKey);
    event BatchSettled(address indexed service, uint256 count, uint256 total);

    error InsufficientBalance();
    error ClaimExpired();
    error NonceAlreadyUsed();
    error InvalidSignature();
    error TransferFailed();
    error ZeroAmount();
    error EmptyBatch();
    error SessionExpiredOrUnknown();

    struct Claim {
        address agent;
        uint256 amount;
        uint256 nonce;
        uint256 expiry;
        bytes signature;
    }

    constructor() EIP712("Arc402", "2") {}

    /* -------------------------- deposit / withdraw ---------------------------- */

    function deposit() external payable {
        if (msg.value == 0) revert ZeroAmount();
        balanceOf[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.sender, msg.value, balanceOf[msg.sender]);
    }

    /// @notice Fund another agent's escrow balance (sponsorship pattern).
    /// @dev    Useful for "I gas-up the agent so it can use paid APIs."
    function depositFor(address agent) external payable {
        if (msg.value == 0) revert ZeroAmount();
        if (agent == address(0)) revert InvalidSignature();
        balanceOf[agent] += msg.value;
        emit Deposited(agent, msg.sender, msg.value, balanceOf[agent]);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 bal = balanceOf[msg.sender];
        if (bal < amount) revert InsufficientBalance();
        unchecked { balanceOf[msg.sender] = bal - amount; }
        emit Withdrawn(msg.sender, amount, balanceOf[msg.sender]);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /* ---------------------------- session keys -------------------------------- */

    /// @notice Authorize a delegated session key to sign claims on behalf of msg.sender.
    /// @dev    Agent calls this directly; session key holder cannot self-authorize.
    function authorizeSession(address sessionKey, uint64 expiry) external {
        if (sessionKey == address(0)) revert InvalidSignature();
        sessionOf[sessionKey] = msg.sender;
        sessionAuthorizedAt[sessionKey] = uint64(block.timestamp);
        sessionExpiry[_sessionKey(msg.sender, sessionKey)] = expiry;
        emit SessionAuthorized(msg.sender, sessionKey, expiry);
    }

    function revokeSession(address sessionKey) external {
        if (sessionOf[sessionKey] != msg.sender) revert InvalidSignature();
        delete sessionOf[sessionKey];
        delete sessionAuthorizedAt[sessionKey];
        delete sessionExpiry[_sessionKey(msg.sender, sessionKey)];
        emit SessionRevoked(msg.sender, sessionKey);
    }

    function _sessionKey(address agent, address sessionKey) internal pure returns (bytes32) {
        return keccak256(abi.encode(agent, sessionKey));
    }

    /* ---------------------------- claim (single) ------------------------------ */

    function claim(
        address agent,
        uint256 amount,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external nonReentrant {
        uint256 total = _processClaim(agent, msg.sender, amount, nonce, expiry, signature);
        if (total > 0) {
            (bool ok,) = msg.sender.call{value: total}("");
            if (!ok) revert TransferFailed();
        }
    }

    /* ---------------------------- claimBatch (V2) ----------------------------- */

    /// @notice Settle multiple signed claims in one transaction.
    /// @dev    Service identity is msg.sender for every claim. Claims with mixed
    ///         agents are fine. Failure of any one claim reverts the whole batch
    ///         (atomic). Use offline filtering if you want partial-success semantics.
    function claimBatch(Claim[] calldata claims) external nonReentrant {
        uint256 len = claims.length;
        if (len == 0) revert EmptyBatch();

        uint256 total;
        for (uint256 i; i < len;) {
            Claim calldata c = claims[i];
            total += _processClaim(c.agent, msg.sender, c.amount, c.nonce, c.expiry, c.signature);
            unchecked { ++i; }
        }

        emit BatchSettled(msg.sender, len, total);

        if (total > 0) {
            (bool ok,) = msg.sender.call{value: total}("");
            if (!ok) revert TransferFailed();
        }
    }

    /* --------------------------- internal core -------------------------------- */

    function _processClaim(
        address agent,
        address service,
        uint256 amount,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    ) internal returns (uint256) {
        if (block.timestamp > expiry) revert ClaimExpired();
        if (amount == 0) revert ZeroAmount();

        bytes32 key = _nonceKey(agent, service, nonce);
        if (usedNonces[key]) revert NonceAlreadyUsed();

        bytes32 structHash = keccak256(abi.encode(
            CLAIM_TYPEHASH, agent, service, amount, nonce, expiry
        ));
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), signature);

        // Accept either: signature directly by `agent`, OR by an authorized session key for `agent`.
        if (recovered != agent) {
            address delegator = sessionOf[recovered];
            if (delegator != agent) revert InvalidSignature();
            uint64 exp = sessionExpiry[_sessionKey(agent, recovered)];
            if (exp == 0 || block.timestamp > exp) revert SessionExpiredOrUnknown();
        }

        uint256 bal = balanceOf[agent];
        if (bal < amount) revert InsufficientBalance();

        usedNonces[key] = true;
        unchecked { balanceOf[agent] = bal - amount; }
        emit Claimed(agent, service, amount, nonce, expiry, recovered);
        return amount;
    }

    function _nonceKey(address agent, address service, uint256 nonce)
        internal pure returns (bytes32)
    {
        return keccak256(abi.encode(agent, service, nonce));
    }

    /* ------------------------------ views ------------------------------------- */

    function nonceKey(address agent, address service, uint256 nonce)
        external pure returns (bytes32)
    {
        return _nonceKey(agent, service, nonce);
    }

    function isNonceUsed(address agent, address service, uint256 nonce)
        external view returns (bool)
    {
        return usedNonces[_nonceKey(agent, service, nonce)];
    }

    function sessionValid(address agent, address sessionKey) external view returns (bool) {
        if (sessionOf[sessionKey] != agent) return false;
        uint64 exp = sessionExpiry[_sessionKey(agent, sessionKey)];
        return exp != 0 && block.timestamp <= exp;
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
