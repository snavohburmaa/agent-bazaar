// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";

contract Deploy is Script {
    function run() external {
        string memory raw = vm.envString("PRIVATE_KEY");
        bytes memory b = bytes(raw);
        require(b.length >= 64, "PRIVATE_KEY is empty or too short. Fill it in .env");
        if (!(b.length >= 2 && b[0] == "0" && (b[1] == "x" || b[1] == "X"))) {
            raw = string.concat("0x", raw);
        }
        uint256 pk = vm.parseUint(raw);
        vm.startBroadcast(pk);
        AgentRegistry reg = new AgentRegistry();
        vm.stopBroadcast();
        console.log("AgentRegistry deployed at:", address(reg));
        console.log("Now put this into .env as REGISTRY_ADDRESS");
    }
}
