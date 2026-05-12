// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {PaymentEscrowV2} from "../src/PaymentEscrowV2.sol";

/// @title  Deploy PaymentEscrowV2 to any Arc chain (testnet or mainnet)
/// @notice Reads optional MAINNET_CONFIRM env var as a safety latch. Without it,
///         this script refuses to deploy to a chain ID it doesn't recognize.
///         Recognized testnet: 5042002. Mainnet ID will be added when Arc mainnet
///         goes live. For now, treats unknown chain IDs as mainnet candidates and
///         requires explicit confirmation.
contract DeployMainnetScript is Script {
    uint256 internal constant ARC_TESTNET = 5042002;

    function run() external returns (PaymentEscrowV2 escrow) {
        uint256 chainId = block.chainid;

        bool isKnownTestnet = chainId == ARC_TESTNET;
        bool confirmed = vm.envOr("MAINNET_CONFIRM", false);

        if (!isKnownTestnet && !confirmed) {
            console.log("==================================================");
            console.log("REFUSING TO DEPLOY");
            console.log("Chain ID is not the known Arc Testnet (5042002).");
            console.log("If this is intentional (mainnet, etc.), re-run with");
            console.log("MAINNET_CONFIRM=true env var set.");
            console.log("==================================================");
            revert("Chain ID not whitelisted; set MAINNET_CONFIRM=true to override");
        }

        if (confirmed) {
            console.log("==================================================");
            console.log("MAINNET CONFIRM FLAG SET");
            console.log("Deploying to chain ID:");
            console.logUint(chainId);
            console.log("Make sure you have completed the mainnet readiness");
            console.log("checklist at docs/mainnet-deploy-checklist.md");
            console.log("==================================================");
        }

        vm.startBroadcast();
        escrow = new PaymentEscrowV2();
        vm.stopBroadcast();

        console.log("PaymentEscrowV2 deployed");
        console.log("Chain ID:");
        console.logUint(chainId);
        console.log("Address:");
        console.logAddress(address(escrow));
    }
}
