# AgentPay

**Autonomous agent-to-agent settlement on Arc, powered by USDC — with real escrow, automatic task classification, and on-chain reputation.**

AgentPay is a working prototype for the *Agentic Economy* track of the Programmable Money Hackathon. It demonstrates a client agent and a worker agent transacting value with no human in the loop: the client escrows a fee, the worker classifies and completes the task, and payment in USDC settles — or refunds — on Arc the instant the result is verified.

## The problem

Autonomous agents are increasingly able to act on behalf of users — managing resources, completing tasks, and coordinating with other agents. But most "agent economies" today still route payment through a human: an invoice, an approval step, a manual transfer. That breaks the promise of autonomy and doesn't scale to machine-speed, usage-based commerce. And a simple "pay on completion" model doesn't protect either side: the client has no guarantee of quality, and the worker has no guarantee of payment.

## What AgentPay does

1. A **client agent** submits any task — a passage, a review, a question — with no need to specify what kind of task it is.
2. The **worker agent autonomously classifies** the task (summarization, sentiment analysis, or question-answering) and prices the fee dynamically based on task length.
3. The fee is **escrowed** in a dedicated smart contract wallet — held in trust, not sent directly to the worker.
4. The **worker agent executes** the task using an LLM (gpt-4o-mini).
5. The result is **verified against type-specific acceptance rules** — for example, a summary must be genuinely shorter than the source, and a question answer is rejected if the model admits it doesn't actually know (no vague "check another source" non-answers get paid).
6. If accepted, the **escrow releases** the fee to the worker on **Arc**, Circle's stablecoin-native L1, in seconds. If rejected, the **escrow refunds** the client automatically.
7. Every completed job updates the worker's **on-chain-adjacent reputation record** — total jobs, accepted, and acceptance rate — visible to anyone deciding whether to trust this worker.

Every step is real: real wallets, a real LLM call, real escrow, and real on-chain USDC transfers — not a simulation.

## Why Arc + USDC

- **USDC as native gas** means the agents never need to hold or manage a separate volatile asset just to pay network fees.
- **Sub-second finality** makes agent-to-agent payment practical at the speed agents actually operate — no waiting on confirmation blocks before escrow can release or refund.
- **Circle's Developer-Controlled Wallets SDK** lets each agent — client, escrow, and worker — hold and control its own wallet programmatically, which is what makes autonomous multi-party settlement possible in the first place.

## Architecture
┌─────────────┐        POST /run-job        ┌──────────────┐
│   Frontend   │ ───────────────────────────▶│   Backend     │
│ (index.html) │◀─────────────────────────── │ (Express API) │
└─────────────┘        JSON response          └──────┬───────┘
│
┌──────────────────────────────┼──────────────────────────────┐
▼                              ▼                              ▼
┌───────────────┐            ┌──────────────────┐            ┌────────────────┐
│   task.js      │            │  escrowJob.js     │            │  reputation.js  │
│ classify +     │◀───────────│  orchestrates     │───────────▶│  tracks accept/  │
│ execute + rule │            │  the full flow    │            │  reject history  │
└───────────────┘            └─────────┬─────────┘            └────────────────┘
│
▼
┌───────────────────────────┐
│      Arc Testnet           │
│  Client ──▶ Escrow          │
│  Escrow ──▶ Worker (accept) │
│  Escrow ──▶ Client (refund) │
└───────────────────────────┘

## The escrow flow in detail
Client Agent  ──1. escrow fee──▶  Escrow Wallet
│
2. worker executes task
│
┌──────────────┴──────────────┐
▼                              ▼
accepted                        rejected
│                              │
3a. release to Worker           3b. refund to Client

## Task classification & acceptance rules

| Task type | How it's detected | Acceptance rule |
|---|---|---|
| **Summarize** | Long descriptive passage | Summary must be genuinely shorter than the source and non-empty |
| **Sentiment** | Opinion/review text | Must return a valid Positive/Negative/Neutral classification with a reason |
| **Q&A** | A direct question | Must give a real answer — rejected if the model admits it can't answer (no real-time data, no specific info, etc.) |

The client never tells the worker which type of task it's submitting — the worker agent decides that itself, autonomously.

## Dynamic pricing

Fees aren't fixed. The worker prices each job based on task length:

| Task length | Fee |
|---|---|
| ≤ 20 words | 0.5 USDC |
| 21–60 words | 1 USDC |
| 60+ words | 2 USDC |

## Tech stack

| Layer | Technology |
|---|---|
| Wallets & settlement | Circle Developer-Controlled Wallets SDK |
| Blockchain | Arc Testnet |
| Task execution | OpenAI (gpt-4o-mini) |
| Backend | Node.js, Express |
| Frontend | HTML/CSS/JS (no framework) |

## Project structure
agentic-hackathon-project/
├── circleClient.js     # Shared Circle SDK client (API key + entity secret)
├── task.js             # Autonomous classification + type-specific execution & acceptance rules
├── escrowJob.js         # Orchestrates the full escrow → execute → release/refund flow
├── reputation.js        # Tracks worker job history and acceptance rate
├── server.js            # Express API: /run-job, /balances, /reputation
├── public/
│   └── index.html      # Frontend: task input, live settlement log, 3-wallet balances, reputation, history
└── .env                 # API keys and wallet IDs (not committed)

## Running it locally

```bash
npm install
node server.js
```

Then open `http://localhost:3001`.

Required environment variables (`.env`):
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
WALLET_ID=
WALLET_ADDRESS=
ESCROW_WALLET_ID=
ESCROW_WALLET_ADDRESS=
WORKER_WALLET_ID=
WORKER_WALLET_ADDRESS=
OPENAI_API_KEY=

## What's next

- Move escrow logic from an off-chain orchestration script into an actual on-chain smart contract, closer to the ERC-8183 job/escrow standard (post → escrow → deliver → evaluate → settle entirely on-chain).
- Add on-chain agent identity (ERC-8004), so a worker agent's reputation is portable and verifiable across applications, not stored in a local file.
- Support multiple worker agents competing for the same job, with the client agent choosing based on price and reputation.
- Persist reputation data in a hosted store so it survives redeploys, instead of local JSON.

## Live demo

- **App:** https://agentpay-arc-97rj.onrender.com
- **Repo:** https://github.com/AMR70234/agentpay-arc

## Team

Built for the Programmable Money Hackathon (Arc × Encode Club), Agentic Economy track.
