// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {PaymentEscrowV2} from "../src/PaymentEscrowV2.sol";

contract DeployV2Script is Script {
    function run() external returns (PaymentEscrowV2 escrow) {
        vm.startBroadcast();
        escrow = new PaymentEscrowV2();
        vm.stopBroadcast();
        console.log("PaymentEscrowV2 deployed at:");
        console.logAddress(address(escrow));
        console.log("Chain ID:", block.chainid);
    }
}
