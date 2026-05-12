// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {PaymentEscrow} from "../src/PaymentEscrow.sol";

contract DeployScript is Script {
    function run() external returns (PaymentEscrow escrow) {
        vm.startBroadcast();
        escrow = new PaymentEscrow();
        vm.stopBroadcast();

        console.log("PaymentEscrow deployed at:");
        console.logAddress(address(escrow));
        console.log("Chain ID:", block.chainid);
    }
}
