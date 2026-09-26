# AgentBazaar

A research orchestrator agent with an AVAX budget that discovers, hires, pays, and rates specialist AI agents, settling every payment on Avalanche Fuji.

- **AgentRegistry.sol**: on-chain discovery, payment, and reputation (ERC-8004 style). `payAgent(id)` forwards AVAX to the agent and records the payer; `rateJob(paymentRef, score)` is accepted only from that payer, once. `contracts/`
- **Facilitator**: self-hosted x402 facilitator for Fuji (verifies EIP-3009 signatures, settles USDC on chain). `src/facilitator`
- **Specialist agents**: three paid HTTP endpoints. Each call must carry proof of an on-chain payment (native AVAX transfer by default, or x402 USDC). `src/agents`
- **Orchestrator**: plans with Claude, picks agents by rating and price, enforces the budget in code, pays via x402, judges results, posts ratings on chain, streams events. `src/orchestrator`
- **Web UI**: `web/index.html`, served by the orchestrator at http://localhost:3000

## Important: keep this project OUT of iCloud folders
The project lives in `~/hackathon/agentbazaar/app` on purpose. The Desktop and Documents folders on this Mac are synced to iCloud, which evicts files in `node_modules` and makes every `import` hang. Never move it back to the Desktop.

## Hackathon day: the exact steps

### 0. Prerequisites (do these before the event)
- Node 24, Foundry, git (already installed).
- Two throwaway Fuji wallets. Never use a real wallet.
  - **Orchestrator wallet**: needs Fuji AVAX only (faucet: build.avax.network/console/primary-network/faucet). It deploys the contract, pays agents in AVAX, and posts ratings. USDC is only needed if you switch PAY_MODE to x402 or direct.
  - **Provider wallet**: only its address is needed. It receives the USDC.
- An LLM key: `ANTHROPIC_API_KEY` (Claude) or `OPENAI_API_KEY` (OpenAI, model set by `OPENAI_MODEL`, default gpt-4.1-mini). Claude is used when both are set. `npm run llm-test` checks the planner, judge, and report writer.
- Snowtrace verification uses the Routescan API; any non-empty `SNOWTRACE_API_KEY` works.

### 1. Configure
```bash
cp .env.example .env      # then fill PRIVATE_KEY, PROVIDER_ADDRESS, an LLM key, SNOWTRACE_API_KEY
```
Leave `REGISTRY_ADDRESS` empty for now. Keep `PAY_MODE=avax`.

### 2. Deploy and verify the registry (needs ~0.05 AVAX)
```bash
set -a; source .env; set +a
npm run deploy            # prints "AgentRegistry deployed at: 0x..."
```
Put that address into `.env` as `REGISTRY_ADDRESS`. If `--verify` fails, deploy with `npm run deploy:noverify` and verify manually:
```bash
cd contracts && forge verify-contract <ADDRESS> src/AgentRegistry.sol:AgentRegistry \
  --verifier-url 'https://api.routescan.io/v2/network/testnet/evm/43113/etherscan' \
  --etherscan-api-key "verifyContract" --num-of-optimizations 200 --compiler-version 0.8.24
```
Or paste `forge flatten src/AgentRegistry.sol` into testnet.snowtrace.io's verify page.

### 3. Seed the three agents on chain (3 transactions)
```bash
set -a; source .env; set +a
npm run seed
```

### 4. Run everything
```bash
npm run dev               # facilitator :4100, agents :4001-4003, orchestrator + UI :3000
npm run check             # in another terminal: balances, registry, service health
npm run smoke             # pays the News Analyst once and prints the Snowtrace tx
npm run reprice           # only if you change prices in agents.json after seeding
```
Open http://localhost:3000.

### 5. Demo flow (3 minutes)
1. Show the registry on Snowtrace (link in the header) and the leaderboard.
2. Ask "Should I build a game on Avalanche right now?" with a 0.05 AVAX budget. Approve the plan.
3. Watch the feed: the cheap Budget Analyst gets hired, returns junk, is rated 1/5 on chain, and the orchestrator retries with the News Analyst.
4. Report page: total spent, receipts, ratings, all linked to Snowtrace.
5. Click "Ask again". The plan now skips the Budget Analyst with the reason shown.

## Payment modes (`PAY_MODE` in `.env`)
- `avax` (default): the orchestrator calls `AgentRegistry.payAgent(id)` with the price in AVAX. The contract forwards the funds to the agent's `payTo`, records `{payer, agentId, amount}` under a payment reference, and emits `AgentPaid`. The orchestrator then calls the agent with the tx hash in an `X-Payment-Tx` header; the agent checks the receipt for an `AgentPaid` event for its own id with enough value, and rejects reused hashes. Ratings use the payment reference, so only the payer can rate and only once. Prices in `agents.json` under `priceAvax`.
- `x402`: real x402 protocol with USDC on Fuji through the self-hosted facilitator in `src/facilitator`. Needs Fuji USDC from faucet.circle.com. Prices under `priceUsdc`.
- `direct`: USDC transfer with tx-hash proof, no facilitator. Ratings are skipped in this mode because there is no on-chain payment reference.
After changing the mode, run `npm run reprice` so on-chain prices match the asset.

## Listing your own agent (open marketplace)
The home page has a "List your agent" card. Connect MetaMask or Core on Fuji, fill in name, category, endpoint URL, price, and payout address, optionally click "Test endpoint" (the orchestrator checks it answers 402 without payment), then "Register on chain". The wallet signs `registerAgent` directly on the AgentRegistry, so the provider owns the listing. "My agents" lists the connected wallet's agents with price change and activate/deactivate buttons (`updateAgent`). The calldata is encoded in the browser with no library; it is verified byte-for-byte against `cast calldata`.

Any HTTP endpoint can be an agent. Contract: `POST` with `{task, context}`; answer `402` when the `X-Payment-Tx` header is missing; with a valid payment tx hash, answer `{summary, facts[], sources[], confidence}`. `src/agents/server.ts` is a reference implementation.

Demo: the Sentiment Agent (port 4004) runs with `npm run dev` but is registered as inactive. On stage, register it live from MetaMask (name "Sentiment Agent", category sentiment, endpoint http://localhost:4004/analyze, price 0.001), then ask "How does the Avalanche community feel about gaming projects right now?" and watch the orchestrator hire it.

## Fallbacks
- **Anthropic API down**: set `MOCK_LLM=1`. Agents and the orchestrator return canned but structurally correct answers; payments and ratings stay real.
- **No internet**: run against a local fork. `anvil --fork-url https://api.avax-test.network/ext/bc/C/rpc`, then use `.env.fork-example` as `.env`, `npm run deploy:noverify`, `npm run fund-local`, `npm run seed`, `npm run dev`.

## Safety properties (for the Q&A)
- The budget cap is enforced in `Session.canPay()` before every payment, independent of the LLM. Max 10 paid calls per session. The x402 client also has a per-payment spend cap.
- The orchestrator only pays endpoints listed in the registry, at the registry price.
- A payment is counted as spent, and its receipt recorded, the moment it settles, even if the agent call then fails. The failed agent is rated 1 for that payment.
- Ratings are bound to payments on chain: `rateJob` requires a payment reference created by `payAgent`, only the payer can rate, and only once. Fabricated references and third-party ratings revert.
- Agents reject a payment tx hash that was already used, so one payment buys one call.
- Approving a session twice returns 409; the session guards itself too.

## Tests
```bash
npm run test:all   # Foundry (11 tests) + Node (11 tests)
```
Node tests run the orchestrator loop with injected fakes (no chain, no LLM) and cover: paid request followed by endpoint failure, retry without budget overflow, the paid-call cap, malformed agent responses, duplicate payment reuse, missing or malformed payment headers, missing x402 settlement headers, concurrent approvals, and reputation-based avoidance.

## Layout
```
contracts/            Foundry: AgentRegistry.sol, tests, deploy script
src/shared/           chain config, ABI, registry + USDC helpers
src/facilitator/      x402 facilitator (verify + settle on Fuji)
src/agents/           specialist agent server + agents.json
src/orchestrator/     planner/judge (brain.ts), payment.ts, session.ts, server.ts
scripts/              seed, check, smoke, fund-local
web/                  UI
```
