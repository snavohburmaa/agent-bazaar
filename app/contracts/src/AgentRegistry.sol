// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentRegistry
/// @notice On-chain discovery, payment, and reputation registry for paid AI agents.
///         A hackathon-sized take on the ERC-8004 identity + reputation pattern.
///         Payments go through payAgent(), which records who paid for what, so a rating
///         can only be posted by the address that actually paid, exactly once per payment.
contract AgentRegistry {
    struct Agent {
        address owner;        // controls the listing
        address payTo;        // payout address
        string name;
        string category;      // "news" | "onchain" | "sentiment" | ...
        string endpoint;      // HTTPS URL of the paid endpoint
        uint256 pricePerCall; // native wei
        bool active;
        uint64 jobsRated;
        uint64 ratingSum;
    }

    struct Payment {
        address payer;
        uint256 agentId;
        uint256 amount;
        bool rated;
    }

    Agent[] private _agents;
    uint256 private _paymentNonce;

    /// @notice paymentRef => payment record
    mapping(bytes32 => Payment) public payments;

    event AgentRegistered(uint256 indexed id, address indexed owner, string name, string category, uint256 pricePerCall);
    event AgentUpdated(uint256 indexed id, string endpoint, uint256 pricePerCall, bool active);
    event AgentPaid(uint256 indexed id, address indexed payer, bytes32 indexed paymentRef, uint256 amount);
    event JobRated(uint256 indexed id, address indexed rater, uint8 score, bytes32 paymentRef);

    error NotOwner();
    error InvalidScore();
    error AlreadyRated();
    error UnknownAgent();
    error InactiveAgent();
    error Underpaid(uint256 required, uint256 sent);
    error UnknownPayment();
    error NotPayer();
    error PayoutFailed();

    modifier exists(uint256 id) {
        if (id >= _agents.length) revert UnknownAgent();
        _;
    }

    function registerAgent(
        string calldata name,
        string calldata category,
        string calldata endpoint,
        address payTo,
        uint256 pricePerCall
    ) external returns (uint256 id) {
        id = _agents.length;
        _agents.push(
            Agent({
                owner: msg.sender,
                payTo: payTo,
                name: name,
                category: category,
                endpoint: endpoint,
                pricePerCall: pricePerCall,
                active: true,
                jobsRated: 0,
                ratingSum: 0
            })
        );
        emit AgentRegistered(id, msg.sender, name, category, pricePerCall);
    }

    function updateAgent(uint256 id, string calldata endpoint, uint256 pricePerCall, bool active)
        external
        exists(id)
    {
        Agent storage a = _agents[id];
        if (a.owner != msg.sender) revert NotOwner();
        a.endpoint = endpoint;
        a.pricePerCall = pricePerCall;
        a.active = active;
        emit AgentUpdated(id, endpoint, pricePerCall, active);
    }

    /// @notice Pay an agent for one call. Forwards the funds to the agent's payTo and
    ///         records a payment reference that the payer can later rate exactly once.
    function payAgent(uint256 id) external payable exists(id) returns (bytes32 paymentRef) {
        Agent storage a = _agents[id];
        if (!a.active) revert InactiveAgent();
        if (msg.value < a.pricePerCall) revert Underpaid(a.pricePerCall, msg.value);
        paymentRef = keccak256(abi.encode(block.chainid, address(this), id, msg.sender, _paymentNonce++));
        payments[paymentRef] = Payment({payer: msg.sender, agentId: id, amount: msg.value, rated: false});
        (bool ok,) = a.payTo.call{value: msg.value}("");
        if (!ok) revert PayoutFailed();
        emit AgentPaid(id, msg.sender, paymentRef, msg.value);
    }

    /// @notice Rate a paid job. Only the payer may rate, and only once per payment.
    function rateJob(bytes32 paymentRef, uint8 score) external {
        if (score < 1 || score > 5) revert InvalidScore();
        Payment storage p = payments[paymentRef];
        if (p.payer == address(0)) revert UnknownPayment();
        if (p.payer != msg.sender) revert NotPayer();
        if (p.rated) revert AlreadyRated();
        p.rated = true;
        Agent storage a = _agents[p.agentId];
        a.jobsRated += 1;
        a.ratingSum += score;
        emit JobRated(p.agentId, msg.sender, score, paymentRef);
    }

    function getAgent(uint256 id) external view exists(id) returns (Agent memory) {
        return _agents[id];
    }

    function getAgents() external view returns (Agent[] memory) {
        return _agents;
    }

    function agentCount() external view returns (uint256) {
        return _agents.length;
    }

    /// @notice Average rating times 100 (437 = 4.37). Zero when unrated.
    function averageRatingX100(uint256 id) external view exists(id) returns (uint256) {
        Agent storage a = _agents[id];
        if (a.jobsRated == 0) return 0;
        return (uint256(a.ratingSum) * 100) / a.jobsRated;
    }
}
