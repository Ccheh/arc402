// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";

/// @title  PaymentEscrow
/// @notice Agent-deposited USDC escrow with off-chain signed claims for API service payments on Arc.
/// @dev    Native USDC is the gas token on Arc. All balances and transfers use native msg.value.
contract PaymentEscrow is EIP712, ReentrancyGuard {
    mapping(address agent => uint256) public balanceOf;
    mapping(bytes32 nonceKey => bool) public usedNonces;

    bytes32 private constant CLAIM_TYPEHASH = keccak256(
        "Claim(address agent,address service,uint256 amount,uint256 nonce,uint256 expiry)"
    );

    event Deposited(address indexed agent, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed agent, uint256 amount, uint256 newBalance);
    event Claimed(
        address indexed agent,
        address indexed service,
        uint256 amount,
        uint256 nonce,
        uint256 expiry
    );

    error InsufficientBalance();
    error ClaimExpired();
    error NonceAlreadyUsed();
    error InvalidSignature();
    error TransferFailed();
    error ZeroAmount();

    constructor() EIP712("Arc402", "1") {}

    /// @notice Deposit native USDC into the caller's escrow balance.
    function deposit() external payable {
        if (msg.value == 0) revert ZeroAmount();
        balanceOf[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value, balanceOf[msg.sender]);
    }

    /// @notice Withdraw native USDC back to the caller.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 bal = balanceOf[msg.sender];
        if (bal < amount) revert InsufficientBalance();
        unchecked { balanceOf[msg.sender] = bal - amount; }
        emit Withdrawn(msg.sender, amount, balanceOf[msg.sender]);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Service pulls a payment using a signed authorization from the agent.
    /// @dev    Service identity is implicit (msg.sender) -- cross-service replay impossible.
    function claim(
        address agent,
        uint256 amount,
        uint256 nonce,
        uint256 expiry,
        bytes calldata signature
    ) external nonReentrant {
        if (block.timestamp > expiry) revert ClaimExpired();
        if (amount == 0) revert ZeroAmount();

        bytes32 key = _nonceKey(agent, msg.sender, nonce);
        if (usedNonces[key]) revert NonceAlreadyUsed();

        bytes32 structHash = keccak256(abi.encode(
            CLAIM_TYPEHASH, agent, msg.sender, amount, nonce, expiry
        ));
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (recovered != agent) revert InvalidSignature();

        uint256 bal = balanceOf[agent];
        if (bal < amount) revert InsufficientBalance();

        usedNonces[key] = true;
        unchecked { balanceOf[agent] = bal - amount; }
        emit Claimed(agent, msg.sender, amount, nonce, expiry);

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _nonceKey(address agent, address service, uint256 nonce)
        internal pure returns (bytes32)
    {
        return keccak256(abi.encode(agent, service, nonce));
    }

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

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
