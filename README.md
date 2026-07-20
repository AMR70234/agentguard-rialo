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

## Human arbitration, made instant and reviewable

Disputing a job used to trigger an automatic refund by default — trusting the client's claim without question. That's been replaced with a real decision process:

- **Dispute button in the UI.** After a job is accepted, the frontend shows an 8-second countdown with a "Dispute this result" button. Clients no longer need to call the API manually.
- **AI arbitrator resolves most disputes instantly.** An independent model reviews the disputed job the moment it's raised and decides `release` or `refund` — the system doesn't wait on a human for every case.
- **Majority voting for consistency.** A single LLM call can occasionally flip its verdict on the exact same input — a known property of language models, not a bug. To reduce this, the arbitrator is called independently three times per dispute, and the majority verdict wins. If the vote ties, the job falls back to manual review instead of guessing.
- **The arbitration prompt was explicitly tuned and tested** against both failure modes: too lenient (approving vague or cut-off answers) and too strict (rejecting short-but-correct ones). Verified with side-by-side test cases for each.
- **`/admin.html` — a password-protected dashboard** for the rare case the AI can't reach a majority decision. It lists every job awaiting arbitration and lets an admin resolve it with one click, authenticated with the same secret that protects the underlying `/admin/*` API.

## Domain knowledge: Arc and Rialo, kept current

The QA task handler's background knowledge is sourced from each project's official site/docs, not generic training data, and was expanded today:

- **Arc:** clarified it's built by Circle Technology Services, LLC — not an independent startup with named founders. Added current testnet stats (240M+ transactions, ~1.5M wallets), the mainnet timeline (summer 2026, still an "exploration phase"), the ARC token's supply structure, and institutional partners (Goldman Sachs, Mastercard, Visa).
- **Rialo:** background on SCALE (Rialo's own on-chain agent-payment framework), the founding team, funding, and Latch.

## Frontend transparency banners

The homepage shows three banners explaining *what* protects each job, not just that it's "protected":
- **Protected by Latch** — no raw credentials to OpenAI or Circle.
- **On-chain escrow** — funds are held by the deployed smart contract, with a direct link to view it on Arc Explorer.
- **Independent verification** — the result is graded by a different model than the one that produced it.

## Known limitations

- **Unaudited contract** — `AgentEscrow.sol` has not been professionally reviewed; not intended for real funds yet.
- **Fixed arbitrator** — the arbitrator wallet is set at deploy time and cannot be changed without redeploying the contract.
- **Shared daily limit** — the spend cap is global across all visitors, not per-user or per-session.
- **Single worker agent** — wallet-linked reputation is ready, but there is only one worker to track today.

## What's next

- Add per-user or per-session daily spend tracking, so a shared demo cannot be exhausted by the first few visitors.
- Get the smart contract professionally audited before it ever touches real funds.
- Add a safe way to rotate the arbitrator address without a full contract redeploy.
- Support multiple worker agents competing for jobs, chosen by price and wallet-tracked reputation.

## Status

Experimental. Built to explore what a security-hardened version of an autonomous agent payment system looks like in practice.
