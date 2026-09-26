// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";

contract AgentRegistryTest is Test {
    AgentRegistry reg;
    address provider = address(0xBEEF);
    address payTo = address(0xCAFE);
    address orchestrator = address(0xABCD);

    function setUp() public {
        reg = new AgentRegistry();
    }

    function _register() internal returns (uint256) {
        vm.prank(provider);
        return reg.registerAgent("News Analyst", "news", "http://localhost:4001/analyze", payTo, 20000);
    }

    function testRegisterStoresListing() public {
        uint256 id = _register();
        assertEq(id, 0);
        assertEq(reg.agentCount(), 1);
        AgentRegistry.Agent memory a = reg.getAgent(0);
        assertEq(a.owner, provider);
        assertEq(a.payTo, payTo);
        assertEq(a.name, "News Analyst");
        assertEq(a.category, "news");
        assertEq(a.pricePerCall, 20000);
        assertTrue(a.active);
    }

    function testOnlyOwnerCanUpdate() public {
        uint256 id = _register();
        vm.prank(orchestrator);
        vm.expectRevert(AgentRegistry.NotOwner.selector);
        reg.updateAgent(id, "x", 1, false);

        vm.prank(provider);
        reg.updateAgent(id, "http://new", 30000, false);
        AgentRegistry.Agent memory a = reg.getAgent(id);
        assertEq(a.endpoint, "http://new");
        assertEq(a.pricePerCall, 30000);
        assertFalse(a.active);
    }

    function testRateJobAndAverage() public {
        uint256 id = _register();
        vm.startPrank(orchestrator);
        reg.rateJob(id, 5, keccak256("tx1"));
        reg.rateJob(id, 4, keccak256("tx2"));
        vm.stopPrank();
        assertEq(reg.averageRatingX100(id), 450);
        AgentRegistry.Agent memory a = reg.getAgent(id);
        assertEq(a.jobsRated, 2);
        assertEq(a.ratingSum, 9);
    }

    function testCannotRateSamePaymentTwice() public {
        uint256 id = _register();
        bytes32 ref = keccak256("tx1");
        reg.rateJob(id, 5, ref);
        vm.expectRevert(AgentRegistry.AlreadyRated.selector);
        reg.rateJob(id, 1, ref);
    }

    function testScoreBounds() public {
        uint256 id = _register();
        vm.expectRevert(AgentRegistry.InvalidScore.selector);
        reg.rateJob(id, 0, keccak256("a"));
        vm.expectRevert(AgentRegistry.InvalidScore.selector);
        reg.rateJob(id, 6, keccak256("b"));
    }

    function testUnknownAgentReverts() public {
        vm.expectRevert(AgentRegistry.UnknownAgent.selector);
        reg.getAgent(3);
    }

    function testUnratedAverageIsZero() public {
        uint256 id = _register();
        assertEq(reg.averageRatingX100(id), 0);
    }

    function testGetAgentsReturnsAll() public {
        _register();
        _register();
        assertEq(reg.getAgents().length, 2);
    }
}
