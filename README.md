# AgentGuard

**An experimental agent payment system with independent AI verification, human arbitration, and Latch-scoped access control for every credential the agent uses.**

AgentGuard demonstrates how a client agent and a worker agent can transact USDC on Arc autonomously, while adding real safeguards around the two weakest points of a naive "agent pays agent" system: the AI judging the work, and the credentials the agent uses to reach that AI.

## What's different from the base project

1. **Independent verification** — The worker executes tasks with one model and a *separate* model independently judges whether the output is genuine, rather than letting a single model grade its own work.
2. **Stale-fact rejection** — Answers about time-sensitive facts (current officeholders, prices, recent events) are rejected unless they include an explicit caveat that the information may be outdated.
3. **Dispute window** — Accepted jobs aren't released instantly. Funds sit in escrow for a short window during which the client can dispute the result and get refunded before the automatic release fires.
4. **Explorer links** — Every settled transaction surfaces a direct link to view it on the Arc block explorer.
5. **Latch-secured access to both OpenAI and Circle** — The agent never holds raw OpenAI or Circle credentials directly in its request path. Instead, both AI calls and USDC transfers go through separate, independently-scoped Latch tokens that enforce policy at the network edge, before the request ever reaches OpenAI or Circle. See "Latch integration status" below for the full breakdown of both policies.

## Why this matters

A payment system that lets an agent spend real USDC needs more than "it usually works." Two failure modes matter most:

- **Verification quality** — a single AI grading its own output can hallucinate or be manipulated. Splitting execution and verification across independent models, and giving the client a dispute window, reduces (though doesn't eliminate) that risk.
- **Credential blast radius** — if the AI credential were ever leaked or misused, an unscoped key has no limit. A Latch-scoped token limits the damage to a small, auditable, rate-limited, spend-capped slice of access.

## Architecture
Client Agent ──escrow (via Latch-Circle)──▶ Escrow Wallet
                                                    │
                                          dispute window (8s)
                                                    │
                        ┌───────────────────────────┴───────────────────────────┐
                        ▼                                                       ▼
        release (via Latch-Circle)                              refund (via Latch-Circle)
        ──▶ Worker Agent                                          ──▶ Client Agent
                                                                  (disputed or rejected)

Worker Agent's AI calls:
  task.js ──▶ latchClient.js ──▶ Latch proxy (AgentGuard policy) ──▶ OpenAI

All USDC transfers:
  escrowJob.js ──▶ latchCircleClient.js ──▶ Latch proxy (AgentGuard-Circle policy) ──▶ Circle

## Tech stack

| Layer | Technology |
|---|---|
| Wallets & settlement | Circle Developer-Controlled Wallets SDK |
| Blockchain | Arc Testnet |
| Task execution | OpenAI (gpt-4o-mini), verification via gpt-4o |
| Access control | Latch (scoped tokens, policy-enforced proxy) |
| Backend | Node.js, Express |
| Frontend | HTML/CSS/JS (no framework) |

## Project structure
agentguard-project/
├── circleClient.js     # Circle SDK client
├── latchClient.js       # Sends AI calls through the Latch policy proxy instead of OpenAI directly
├── task.js             # Classification, execution, and independent verification
├── escrowJob.js         # Escrow → execute → dispute window → release/refund
├── reputation.js        # Worker job history and acceptance rate
├── server.js            # Express API: /run-job, /dispute, /job-status, /balances, /tx/:id
├── public/
│   └── index.html      # Frontend
└── .env                 # Circle, OpenAI/Latch, and wallet credentials (not committed)

## Running it locally

```bash
npm install
node server.js
```

Then open `http://localhost:3002`.

Required environment variables (`.env`):
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
WALLET_ID=
WALLET_ADDRESS=
ESCROW_WALLET_ID=
ESCROW_WALLET_ADDRESS=
WORKER_WALLET_ID=
WORKER_WALLET_ADDRESS=
LATCH_URL=
LATCH_TOKEN=
LATCH_ID=

## Recent additions

**Persistent, wallet-linked reputation.** Worker reputation is no longer a single global counter that resets on every redeploy. It's now keyed by the worker's wallet address and stored externally (via JSONBin), so it survives Render restarts and, if the project ever supports multiple worker agents, each one accumulates its own independent track record instead of sharing one pool.

**Rialo/SCALE domain knowledge.** The QA task handler now has accurate background on Rialo, Subzero Labs, Latch, and SCALE (Simple Contracts for Agent Labor Execution) — Rialo's own on-chain framework for paying AI agents, which uses escrow, a judge agent, and automatic refunds on missed deadlines. Notably, AgentGuard's escrow → verify → release/refund flow independently converges on a similar pattern to SCALE, built off-chain on Arc/Circle instead.

## Latch integration status

**Both OpenAI and Circle/USDC access are fully integrated and live.**

**OpenAI (`AgentGuard` latch):** Every AI call in this project (`task.js`) goes through a Latch-scoped token instead of a raw OpenAI API key. The policy enforces: endpoint allowlist (`/v1/chat/completions` only), POST-only, `max_tokens` under 500, model restricted to `gpt-4o-mini`/`gpt-4o`, a 60 req/min rate limit, and a $5/day spend cap. Verified end-to-end — the policy blocks non-conforming requests, and every call is logged in Latch's activity feed.

**Circle/USDC (`AgentGuard-Circle` latch):** Every USDC transfer in this project (`escrowJob.js`, via `latchCircleClient.js`) goes through a second, independently-scoped Latch token instead of calling Circle directly. The policy enforces: endpoint allowlist (`/v1/w3s/developer/transactions/transfer` only), POST-only, a max transfer amount of 10 USDC per transaction, a 2 req/min rate limit, and a 20 USDC/day spend cap. Verified end-to-end on Arc Testnet — escrow, release, and refund transactions all settle through the Latch proxy.

**How the Circle integration works:** Circle's transfer endpoint requires an `entitySecretCiphertext` — a value encrypted client-side, per request, using the entity's public key. This is still generated locally using Circle's official SDK (`generateEntitySecretCiphertext`), exactly as Circle requires. The *fully-formed request* (including that ciphertext) is then sent through the Latch proxy rather than directly to Circle, so Latch can enforce the transfer-amount, rate, and spend policies before the request ever reaches Circle's servers.

**A note on the max-amount filter:** Latch's payload filters compare values using their native JSON type. Circle's API requires the transfer amount to be sent as a string (e.g. `"0.5"`), but Latch's numeric comparison operators (`less_than_or_equal`, etc.) expect a number, not a numeric string — so a straightforward numeric rule always denied valid requests. The workaround: the max-amount rule uses a `matches` (regex) filter instead, validating the string's *shape* (`^([0-9]|10)(\.[0-9]+)?$`) rather than doing a numeric comparison. This achieves the same effect (reject any transfer request above 10) without requiring Latch to coerce string to number.

**Bottom line:** both the AI layer and the USDC layer are now protected by independent, scoped credentials — enforced outside the application code, not just inside it.

## On-chain escrow (smart contract)

Escrow logic now runs on an actual smart contract deployed on Arc Testnet, instead of being managed entirely by the application server.

**Contract:** `AgentEscrow.sol` — an experimental, unaudited Solidity contract deployed via Circle's Smart Contract Platform. It implements the same flow as the original off-chain design:

- `createJob(jobId, worker, amount)` — client escrows USDC into the contract itself (via `transferFrom`, requiring a prior `approve`)
- `dispute(jobId)` — client freezes the job for arbitration within the dispute window
- `release(jobId)` — anyone can trigger release once the window has passed with no dispute
- `resolve(jobId, releaseToWorker)` — only the designated arbitrator wallet can resolve a disputed job

**Deployed address:** `0x2460d5713367a3a5befca87363b221d47045d580` (Arc Testnet)

**Why this matters:** previously, if the server hosting this app went down or was compromised, funds sitting in an intermediate escrow wallet had no guaranteed resolution path — everything depended on this server's own logic staying correct and available. Now, the escrow, dispute window, and arbitration rules are enforced by the contract itself, independent of server uptime. The arbitrator is a separate wallet (the escrow wallet) from the client, so a client can't dispute and then "arbitrate" their own claim.

**What's still true:** this is an experimental, unaudited contract built as a learning exercise — not reviewed by a professional smart contract auditor, and not intended for production use with real funds. Circle's Developer-Controlled Wallets still sign every on-chain call; deploying via Circle's Smart Contract Platform meant no separate private key was needed.

## What's next

- Add per-user or per-session daily spend tracking (currently the daily cap is shared globally across all usage — see "Known limitation" above).
- Move escrow and dispute logic on-chain into a smart contract.
- Add on-chain, portable agent reputation (ERC-8004-style) instead of local storage.
- Support a real arbitrator (human or independent model) for disputed jobs, instead of an automatic refund.

## Status

Experimental. Built to explore what a security-hardened version of an autonomous agent payment system looks like in practice.
