export const registryAbi = [
  { type: "function", name: "registerAgent", stateMutability: "nonpayable",
    inputs: [{ name: "name", type: "string" }, { name: "category", type: "string" }, { name: "endpoint", type: "string" }, { name: "payTo", type: "address" }, { name: "pricePerCall", type: "uint256" }],
    outputs: [{ name: "id", type: "uint256" }] },
  { type: "function", name: "updateAgent", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }, { name: "endpoint", type: "string" }, { name: "pricePerCall", type: "uint256" }, { name: "active", type: "bool" }], outputs: [] },
  { type: "function", name: "rateJob", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }, { name: "score", type: "uint8" }, { name: "paymentRef", type: "bytes32" }], outputs: [] },
  { type: "function", name: "getAgent", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: [
      { name: "owner", type: "address" }, { name: "payTo", type: "address" }, { name: "name", type: "string" }, { name: "category", type: "string" },
      { name: "endpoint", type: "string" }, { name: "pricePerCall", type: "uint256" }, { name: "active", type: "bool" }, { name: "jobsRated", type: "uint64" }, { name: "ratingSum", type: "uint64" }] }] },
  { type: "function", name: "getAgents", stateMutability: "view", inputs: [],
    outputs: [{ name: "", type: "tuple[]", components: [
      { name: "owner", type: "address" }, { name: "payTo", type: "address" }, { name: "name", type: "string" }, { name: "category", type: "string" },
      { name: "endpoint", type: "string" }, { name: "pricePerCall", type: "uint256" }, { name: "active", type: "bool" }, { name: "jobsRated", type: "uint64" }, { name: "ratingSum", type: "uint64" }] }] },
  { type: "function", name: "agentCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "averageRatingX100", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "jobRated", stateMutability: "view", inputs: [{ name: "", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  { type: "event", name: "AgentRegistered", inputs: [{ indexed: true, name: "id", type: "uint256" }, { indexed: true, name: "owner", type: "address" }, { indexed: false, name: "name", type: "string" }, { indexed: false, name: "category", type: "string" }, { indexed: false, name: "pricePerCall", type: "uint256" }] },
  { type: "event", name: "JobRated", inputs: [{ indexed: true, name: "id", type: "uint256" }, { indexed: true, name: "rater", type: "address" }, { indexed: false, name: "score", type: "uint8" }, { indexed: false, name: "paymentRef", type: "bytes32" }] },
] as const;

export const erc20Abi = [
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "event", name: "Transfer", inputs: [{ indexed: true, name: "from", type: "address" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "value", type: "uint256" }] },
] as const;
