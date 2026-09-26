// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";

contract AgentRegistryTest is Test {
    AgentRegistry reg;
    address provider = address(0xBEEF);
    address payTo = address(0xCAFE);
    address orchestrator = address(0xABCD);
    address stranger = address(0x5713);

    function setUp() public {
        reg = new AgentRegistry();
        vm.deal(orchestrator, 10 ether);
        vm.deal(stranger, 10 ether);
    }

    function _register() internal returns (uint256) {
        vm.prank(provider);
        return reg.registerAgent("News Analyst", "news", "http://localhost:4001/analyze", payTo, 0.002 ether);
    }

    function _pay(address who, uint256 id, uint256 value) internal returns (bytes32) {
        vm.prank(who);
        return reg.payAgent{value: value}(id);
    }

    function testRegisterStoresListing() public {
        uint256 id = _register();
        assertEq(id, 0);
        assertEq(reg.agentCount(), 1);
        AgentRegistry.Agent memory a = reg.getAgent(0);
        assertEq(a.owner, provider);
        assertEq(a.payTo, payTo);
        assertEq(a.pricePerCall, 0.002 ether);
        assertTrue(a.active);
    }

    function testOnlyOwnerCanUpdate() public {
        uint256 id = _register();
        vm.prank(orchestrator);
        vm.expectRevert(AgentRegistry.NotOwner.selector);
        reg.updateAgent(id, "x", 1, false);
        vm.prank(provider);
        reg.updateAgent(id, "http://new", 3, false);
        assertFalse(reg.getAgent(id).active);
    }

    function testPayForwardsFundsAndRecordsPayment() public {
        uint256 id = _register();
        uint256 before = payTo.balance;
        bytes32 ref = _pay(orchestrator, id, 0.002 ether);
        assertEq(payTo.balance - before, 0.002 ether);
        (address payer, uint256 agentId, uint256 amount, bool rated) = reg.payments(ref);
        assertEq(payer, orchestrator);
        assertEq(agentId, id);
        assertEq(amount, 0.002 ether);
        assertFalse(rated);
    }

    function testUnderpaymentReverts() public {
        uint256 id = _register();
        vm.prank(orchestrator);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.Underpaid.selector, 0.002 ether, 0.001 ether));
        reg.payAgent{value: 0.001 ether}(id);
    }

    function testCannotPayInactiveAgent() public {
        uint256 id = _register();
        vm.prank(provider);
        reg.updateAgent(id, "http://x", 0.002 ether, false);
        vm.prank(orchestrator);
        vm.expectRevert(AgentRegistry.InactiveAgent.selector);
        reg.payAgent{value: 0.002 ether}(id);
    }

    function testPayerCanRateOnce() public {
        uint256 id = _register();
        bytes32 ref = _pay(orchestrator, id, 0.002 ether);
        vm.prank(orchestrator);
        reg.rateJob(ref, 4);
        assertEq(reg.averageRatingX100(id), 400);
        vm.prank(orchestrator);
        vm.expectRevert(AgentRegistry.AlreadyRated.selector);
        reg.rateJob(ref, 5);
    }

    function testOnlyPayerCanRate() public {
        uint256 id = _register();
        bytes32 ref = _pay(orchestrator, id, 0.002 ether);
        vm.prank(stranger);
        vm.expectRevert(AgentRegistry.NotPayer.selector);
        reg.rateJob(ref, 5);
        vm.prank(provider);
        vm.expectRevert(AgentRegistry.NotPayer.selector);
        reg.rateJob(ref, 5);
    }

    function testCannotRateFabricatedReference() public {
        _register();
        vm.prank(orchestrator);
        vm.expectRevert(AgentRegistry.UnknownPayment.selector);
        reg.rateJob(keccak256("made up"), 5);
    }

    function testScoreBounds() public {
        uint256 id = _register();
        bytes32 ref = _pay(orchestrator, id, 0.002 ether);
        vm.startPrank(orchestrator);
        vm.expectRevert(AgentRegistry.InvalidScore.selector);
        reg.rateJob(ref, 0);
        vm.expectRevert(AgentRegistry.InvalidScore.selector);
        reg.rateJob(ref, 6);
        vm.stopPrank();
    }

    function testAverageAcrossPayments() public {
        uint256 id = _register();
        bytes32 r1 = _pay(orchestrator, id, 0.002 ether);
        bytes32 r2 = _pay(orchestrator, id, 0.002 ether);
        assertTrue(r1 != r2);
        vm.startPrank(orchestrator);
        reg.rateJob(r1, 5);
        reg.rateJob(r2, 4);
        vm.stopPrank();
        assertEq(reg.averageRatingX100(id), 450);
        assertEq(reg.getAgent(id).jobsRated, 2);
    }

    function testUnknownAgentReverts() public {
        vm.expectRevert(AgentRegistry.UnknownAgent.selector);
        reg.getAgent(3);
    }
}
