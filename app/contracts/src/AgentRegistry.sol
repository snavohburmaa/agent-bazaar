// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentRegistry
/// @notice On-chain discovery and reputation registry for paid AI agents.
///         A hackathon-sized take on the ERC-8004 identity + reputation pattern.
contract AgentRegistry {
    struct Agent {
        address owner;        // controls the listing
        address payTo;        // x402 payout address
        string name;
        string category;      // "news" | "onchain" | "sentiment"
        string endpoint;      // HTTPS URL of the paid endpoint
        uint256 pricePerCall; // USDC base units (6 decimals)
        bool active;
        uint64 jobsRated;
        uint64 ratingSum;
    }

    Agent[] private _agents;

    /// @notice paymentRef => already rated
    mapping(bytes32 => bool) public jobRated;

    event AgentRegistered(uint256 indexed id, address indexed owner, string name, string category, uint256 pricePerCall);
    event AgentUpdated(uint256 indexed id, string endpoint, uint256 pricePerCall, bool active);
    event JobRated(uint256 indexed id, address indexed rater, uint8 score, bytes32 paymentRef);

    error NotOwner();
    error InvalidScore();
    error AlreadyRated();
    error UnknownAgent();
    error InactiveAgent();

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

    /// @notice Record a 1-5 rating for a paid job. One rating per payment reference.
    function rateJob(uint256 id, uint8 score, bytes32 paymentRef) external exists(id) {
        if (score < 1 || score > 5) revert InvalidScore();
        if (jobRated[paymentRef]) revert AlreadyRated();
        Agent storage a = _agents[id];
        if (!a.active) revert InactiveAgent();
        jobRated[paymentRef] = true;
        a.jobsRated += 1;
        a.ratingSum += score;
        emit JobRated(id, msg.sender, score, paymentRef);
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
