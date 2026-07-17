# AgentGuard

**An experimental, security-hardened fork of AgentPay — adding independent AI verification, a dispute window, and Latch-based access control for the AI layer.**

AgentGuard demonstrates how a client agent and a worker agent can transact USDC on Arc autonomously, while adding real safeguards around the two weakest points of a naive "agent pays agent" system: the AI judging the work, and the credentials the agent uses to reach that AI.

## What's different from the base project

1. **Independent verification** — The worker executes tasks with one model and a *separate* model independently judges whether the output is genuine, rather than letting a single model grade its own work.
2. **Stale-fact rejection** — Answers about time-sensitive facts (current officeholders, prices, recent events) are rejected unless they include an explicit caveat that the information may be outdated.
3. **Dispute window** — Accepted jobs aren't released instantly. Funds sit in escrow for a short window during which the client can dispute the result and get refunded before the automatic release fires.
4. **Explorer links** — Every settled transaction surfaces a direct link to view it on the Arc block explorer.
5. **Latch-secured AI access** — The worker agent never holds a raw OpenAI API key. Instead, it calls a scoped Latch token that enforces, at the network edge, before the request ever reaches OpenAI:
   - Endpoint allowlist (`/v1/chat/completions` only)
   - Method restriction (POST only)
   - `max_tokens` capped under 500
   - Model restricted to `gpt-4o-mini` / `gpt-4o`
   - Rate limit: 60 requests/minute
   - Daily spend cap: $5
   - Full request logging for audit

## Why this matters

A payment system that lets an agent spend real USDC needs more than "it usually works." Two failure modes matter most:

- **Verification quality** — a single AI grading its own output can hallucinate or be manipulated. Splitting execution and verification across independent models, and giving the client a dispute window, reduces (though doesn't eliminate) that risk.
- **Credential blast radius** — if the AI credential were ever leaked or misused, an unscoped key has no limit. A Latch-scoped token limits the damage to a small, auditable, rate-limited, spend-capped slice of access.

## Architecture
Client Agent ──escrow──▶ Escrow Wallet ──dispute window (8s)──▶ Worker Agent (release)
│                                     │
└── refund (disputed or rejected) ◀────┘
Worker Agent's AI calls:
task.js ──▶ latchClient.js ──▶ Latch proxy (policy-enforced) ──▶ OpenAI

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

## What's next

- Extend Latch scoping to the Circle/USDC API itself, not just the AI layer — this is the higher-value security target, since it governs the agent's actual spending authority rather than its AI usage.
- Move escrow and dispute logic on-chain into a smart contract.
- Add on-chain, portable agent reputation (ERC-8004-style) instead of local storage.
- Support a real arbitrator (human or independent model) for disputed jobs, instead of an automatic refund.

## Status

Experimental. Built to explore what a security-hardened version of an autonomous agent payment system looks like in practice.
