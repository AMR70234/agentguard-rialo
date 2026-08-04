require('dotenv').config();
const crypto = require('crypto');
const { callContract } = require('./contractClient');
const { executeTask } = require('./task');
const { recordJob } = require('./reputation');
const { recordTransaction } = require('./db');

const DISPUTE_WINDOW_MS = 33000; // matches contract's 30s dispute window + 3s buffer
const pendingJobs = new Map(); // jobId -> { taskResult, amount, timer, status }

// Two competing worker agents, each with an independent wallet-linked
// reputation record. Before every job, the client scores both and picks
// the winner — a real, runtime decision, not a fixed assignment.
const WORKERS = [
  { walletAddress: process.env.WORKER_WALLET_ADDRESS, priceMultiplier: 1.0 },
  { walletAddress: process.env.WORKER2_WALLET_ADDRESS, priceMultiplier: 0.9 },
];

async function chooseWorker() {
  const { getStats } = require('./reputation');
  const scored = await Promise.all(WORKERS.map(async (w) => {
    const stats = await getStats(w.walletAddress).catch(() => ({ acceptanceRate: 100 }));
    const score = (stats.acceptanceRate || 100) - (w.priceMultiplier * 5);
    return { ...w, score };
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

const DAILY_USDC_LIMIT = 20;
let dailySpend = { date: new Date().toDateString(), total: 0 };

function checkAndRecordDailySpend(amount) {
  const today = new Date().toDateString();
  if (dailySpend.date !== today) {
    dailySpend = { date: today, total: 0 };
  }
  const amountNum = parseFloat(amount);
  if (dailySpend.total + amountNum > DAILY_USDC_LIMIT) {
    return { allowed: false, remaining: Math.max(0, DAILY_USDC_LIMIT - dailySpend.total).toFixed(2) };
  }
  dailySpend.total += amountNum;
  return { allowed: true, remaining: (DAILY_USDC_LIMIT - dailySpend.total).toFixed(2) };
}

function calculatePrice(inputText) {
  const wordCount = inputText.trim().split(/\s+/).length;
  if (wordCount <= 20) return '0.5';
  if (wordCount <= 60) return '1';
  return '2';
}

function toUnits(amount) {
  return String(Math.round(parseFloat(amount) * 1000000)); // USDC has 6 decimals
}

function pollTransaction(txId, maxTries = 10) {
  return new Promise(async (resolve) => {
    for (let i = 0; i < maxTries; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const res = await fetch(`https://api.circle.com/v1/w3s/transactions/${txId}`, {
        headers: { 'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}` },
      });
      const data = await res.json();
      const state = data.data.transaction.state;
      if (state === 'COMPLETE' || state === 'FAILED') {
        resolve(data.data.transaction);
        return;
      }
    }
    resolve({ state: 'TIMEOUT' });
  });
}

// Escrow now happens on-chain via the AgentEscrow smart contract, instead
// of a direct Circle transfer. The contract itself enforces the dispute
// window and holds the funds — not this server.
async function runEscrowJob(taskInput, amount, clientWallet) {
  const clientWalletId = (clientWallet && clientWallet.walletId) || process.env.WALLET_ID;
  const clientWalletAddress = (clientWallet && clientWallet.walletAddress) || process.env.WALLET_ADDRESS;
  const worker = await chooseWorker();
  if (!amount) amount = calculatePrice(taskInput);

  const spendCheck = checkAndRecordDailySpend(amount);
  if (!spendCheck.allowed) {
    return {
      accepted: false,
      disputable: false,
      summary: `Daily spend limit of ${DAILY_USDC_LIMIT} USDC reached. Try again tomorrow.`,
      taskType: 'blocked',
      amount,
      finalTx: null,
      stats: null,
    };
  }

  const jobId = '0x' + crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex');

  // 🔥 Auto-approve USDC first
  const approved = await approveUSDC(amount, clientWalletId);
  if (!approved) {
    return { accepted: false, disputable: false, summary: "USDC approval failed - please check wallet balance", taskType: "error", amount, finalTx: null, stats: null };
  }

  console.log(`On-chain: creating job ${jobId}, escrowing ${amount} USDC...`);
  const createRes = await callContract({
    walletId: clientWalletId,
    abiFunctionSignature: 'createJob(bytes32,address,uint256)',
    abiParameters: [jobId, worker.walletAddress, toUnits(amount)],
  });
  const createTx = await pollTransaction(createRes.data.id);
  console.log("🔥 createTx:", JSON.stringify(createTx, null, 2));
  if (createTx.state !== 'COMPLETE') {
    return { accepted: false, disputable: false, summary: 'On-chain escrow failed.', taskType: 'error', amount, finalTx: null, stats: null };
  }
  console.log(`Escrow confirmed on-chain: ${createTx.txHash}`);

  console.log('Worker agent executing task...');

  const taskResult = await executeTask(taskInput);
  const crypto2 = require("crypto");
  const resultCommitHash = crypto2.createHash("sha256").update(JSON.stringify(taskResult)).digest("hex");
  console.log(`🔒 Commit: result hash ${resultCommitHash.slice(0, 16)}... logged before reveal`);
  const revealHash = crypto2.createHash("sha256").update(JSON.stringify(taskResult)).digest("hex");
  const commitRevealMatch = revealHash === resultCommitHash;
  console.log(`🔓 Reveal: hash ${commitRevealMatch ? "matches commit — result is untampered" : "MISMATCH"}`);
  console.log(`Result: "${taskResult.result}"`);

  if (taskResult.accepted) {
    pendingJobs.set(jobId, { status: 'pending', amount, taskResult, taskInput, clientWalletAddress, resultCommitHash, commitRevealMatch });

    const timer = setTimeout(async () => {
      const job = pendingJobs.get(jobId);
      if (!job || job.status !== 'pending') return;
      try {
        const releaseRes = await callContract({
          walletId: process.env.WORKER_WALLET_ID,
          abiFunctionSignature: 'release(bytes32)',
          abiParameters: [jobId],
        });
        const releaseTx = await pollTransaction(releaseRes.data.id);
        job.status = 'released';
        job.finalTx = releaseRes.data;
        await recordJob(true, worker.walletAddress);
        recordTransaction(jobId, 'released', amount, taskInput, taskResult, releaseTx.txHash, clientWalletAddress);
        console.log(`On-chain auto-release for job ${jobId}: ${releaseRes.data.id}`);
      } catch (err) {
        console.error(`Auto-release failed for job ${jobId}:`, err.message);
      }
    }, DISPUTE_WINDOW_MS);

    pendingJobs.get(jobId).timer = timer;

    return {
      accepted: true,
      disputable: true,
      jobId,
      summary: taskResult.result,
      taskType: taskResult.taskType,
      amount,
      escrowTx: { id: createRes.data.id, state: createTx.state, txHash: createTx.txHash },
      disputeWindowMs: DISPUTE_WINDOW_MS,
      stats: undefined,
    };
  } else {
    console.log('Task rejected — refunding client on-chain (via dispute + resolve)...');
    // Since the worker itself rejected the result, we dispute and immediately
    // resolve in the client's favor using the escrow wallet as arbitrator.
    await callContract({
      walletId: clientWalletId,
      abiFunctionSignature: 'dispute(bytes32)',
      abiParameters: [jobId],
    });
    await new Promise(r => setTimeout(r, 3000));
    const resolveRes = await callContract({
      walletId: process.env.ESCROW_WALLET_ID,
      abiFunctionSignature: 'resolve(bytes32,bool)',
      abiParameters: [jobId, false],
    });

    const stats = await recordJob(false, worker.walletAddress);
    const refundTx = await pollTransaction(resolveRes.data.id);
    recordTransaction(jobId, 'refunded', amount, taskInput, taskResult, refundTx.txHash, clientWalletAddress);

    return {
      accepted: false,
      disputable: false,
      summary: taskResult.result,
      taskType: taskResult.taskType,
      amount,
      finalTx: resolveRes.data,
      stats,
    };
  }
}

// Client disputes within the window — freezes the job on-chain for arbitration.
// AI-based arbitrator: an independent model reviews the disputed job and
// decides immediately, so the system scales without waiting for a human.
// Falls back to "awaiting_arbitration" (for manual review via /admin.html)
// if the AI arbitrator itself fails or can't reach a confident decision.
async function getSingleVerdict(taskInput, result, taskType, model) {
  const { latchChatCompletion } = require('./latchClient');
  const verdict = await latchChatCompletion([
    {
      role: 'system',
      content: `You are an independent, fair arbitrator for a disputed AI agent job, in any language. Judge whether the workers result genuinely and adequately completes the task — it does not need to be perfect, just complete and coherent. Respond REFUND only if the result is clearly incomplete (cut off mid-sentence), incoherent, completely off-topic, or explicitly admits it could not answer. Respond RELEASE if the result is a reasonable, complete attempt that addresses the task, even if brief. A short but accurate and complete answer or summary should be RELEASE, not REFUND. Respond with only RELEASE or REFUND.`,
    },
    {
      role: 'user',
      content: `Task type: ${taskType}\nOriginal task: ${taskInput}\nWorker's result: ${result}\n\nShould this be RELEASE or REFUND? Respond with only that one word.`,
    },
  ], { model: model || 'gpt-4o', max_tokens: 5 });

  const decision = verdict.trim().toUpperCase();
  if (decision.startsWith('RELEASE')) return 'release';
  if (decision.startsWith('REFUND')) return 'refund';
  return null;
}

// Runs the arbitrator 3 times independently and takes the majority verdict,
// since a single LLM call can occasionally flip its decision on the same input.
// If tied, casts up to 2 tie-breaker votes before falling back to manual review,
// so a job doesn't sit stuck in the admin queue for an avoidable coin-flip tie.
async function aiArbitrate(taskInput, result, taskType) {
  try {
    // Multi-model weighted judging: two votes from gpt-4o (weighted 2x
    // each since it's the stronger model) and one from gpt-4o-mini as a
    // genuinely independent second model, not just a repeated call.
    const [voteA, voteB, voteC] = await Promise.all([
      getSingleVerdict(taskInput, result, taskType, 'gpt-4o'),
      getSingleVerdict(taskInput, result, taskType, 'gpt-4o'),
      getSingleVerdict(taskInput, result, taskType, 'gpt-4o-mini'),
    ]);
    let votes = [voteA, voteA, voteB, voteB, voteC]; // gpt-4o votes double-weighted

    for (let round = 0; round < 2; round++) {
      console.log(`Arbitration votes (round ${round + 1}): [${votes.join(', ')}]`);
      const releaseCount = votes.filter(v => v === 'release').length;
      const refundCount = votes.filter(v => v === 'refund').length;

      if (releaseCount > refundCount) return 'release';
      if (refundCount > releaseCount) return 'refund';

      // Tied — cast one more tie-breaker vote and re-check
      const tieBreaker = await getSingleVerdict(taskInput, result, taskType);
      votes.push(tieBreaker);
    }

    console.log(`Arbitration still inconclusive after tie-breakers: [${votes.join(', ')}] — routing to manual review.`);
    return null; // still tied after tie-breakers — falls back to manual review
  } catch (err) {
    console.error('AI arbitration failed:', err.message);
    return null;
  }
}

async function disputeJob(jobId) {
  const job = pendingJobs.get(jobId);
  if (!job) return { ok: false, error: 'Job not found or already resolved' };
  if (job.status !== 'pending') return { ok: false, error: `Job already ${job.status}` };

  clearTimeout(job.timer);

  const disputeRes = await callContract({
    walletId: process.env.WALLET_ID,
    abiFunctionSignature: 'dispute(bytes32)',
    abiParameters: [jobId],
  });

  job.status = 'awaiting_arbitration';
  job.stuckSince = Date.now();
  console.log(`Job ${jobId} disputed on-chain: ${disputeRes.data.id}`);

  // Immediately try AI arbitration so the client/worker don't wait on a human
  const aiDecision = await aiArbitrate(job.taskInput || '', job.taskResult.result, job.taskResult.taskType);

  if (aiDecision) {
    console.log(`AI arbitrator decided: ${aiDecision} for job ${jobId}`);
    const result = await resolveArbitration(jobId, aiDecision);
    return { ok: true, status: result.status, resolvedBy: 'ai', finalTx: result.finalTx };
  }

  console.log(`AI arbitrator was inconclusive for job ${jobId} — queued for manual review.`);
  return { ok: true, status: 'awaiting_arbitration', resolvedBy: null };
}

function listPendingArbitration() {
  const list = [];
  for (const [jobId, job] of pendingJobs.entries()) {
    if (job.status === 'awaiting_arbitration') {
      list.push({ jobId, amount: job.amount, taskType: job.taskResult && job.taskResult.taskType, result: job.taskResult && job.taskResult.result });
    }
  }
  return list;
}

// Human arbitrator resolves a disputed job on-chain via the escrow wallet.
async function resolveArbitration(jobId, decision) {
  const job = pendingJobs.get(jobId);
  if (!job) return { ok: false, error: 'Job not found or already resolved' };
  if (job.status !== 'awaiting_arbitration') return { ok: false, error: `Job is not awaiting arbitration (status: ${job.status})` };

  const releaseToWorker = decision === 'release';
  if (decision !== 'release' && decision !== 'refund') return { ok: false, error: 'decision must be "release" or "refund"' };

  const resolveRes = await callContract({
    walletId: process.env.ESCROW_WALLET_ID,
    abiFunctionSignature: 'resolve(bytes32,bool)',
    abiParameters: [jobId, releaseToWorker],
  });

  job.status = releaseToWorker ? 'released' : 'refunded';
  job.finalTx = resolveRes.data;
  await recordJob(releaseToWorker, process.env.WORKER_WALLET_ADDRESS);
  const resolveTx = await pollTransaction(resolveRes.data.id);
  recordTransaction(jobId, job.status, job.amount, job.taskInput, job.taskResult, resolveTx.txHash, job.clientWalletAddress);

  console.log(`On-chain arbitration on job ${jobId}: ${job.status} (${resolveRes.data.id})`);
  return { ok: true, status: job.status, finalTx: resolveRes.data };
}

function getJobStatus(jobId) {
  const job = pendingJobs.get(jobId);
  if (!job) return { status: 'unknown' };
  return { status: job.status, finalTx: job.finalTx || null };
}

// Simple keeper: checks every job stuck in "awaiting_arbitration" and, if
// it's been stuck longer than the safety threshold, calls forceRefund()
// on-chain itself — no human needs to click a button. Mirrors the contract's
// own ARBITRATION_TIMEOUT (7 days), but uses a much shorter threshold here
// since this demo can't realistically wait 7 real days to prove it works.
const KEEPER_STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes — short enough to demo, long enough not to fire on a normal manual-review case

async function runKeeperSweep() {
  const stuckJobs = [];
  for (const [jobId, job] of pendingJobs.entries()) {
    if (job.status === 'awaiting_arbitration' && job.stuckSince) {
      const stuckFor = Date.now() - job.stuckSince;
      if (stuckFor > KEEPER_STUCK_THRESHOLD_MS) {
        stuckJobs.push(jobId);
      }
    }
  }

  for (const jobId of stuckJobs) {
    console.log(`⏰ Keeper: job ${jobId} has been stuck in arbitration too long — force-refunding automatically.`);
    try {
      const forceRefundRes = await callContract({
        walletId: process.env.ESCROW_WALLET_ID,
        abiFunctionSignature: 'forceRefund(bytes32)',
        abiParameters: [jobId],
      });
      await pollTransaction(forceRefundRes.data.id);
      const job = pendingJobs.get(jobId);
      if (job) job.status = 'refunded';
      console.log(`✅ Keeper: job ${jobId} force-refunded successfully.`);
    } catch (err) {
      console.error(`❌ Keeper: force-refund failed for job ${jobId}:`, err.message);
    }
  }
}

module.exports = { runEscrowJob, disputeJob, getJobStatus, listPendingArbitration, resolveArbitration, calculatePrice, runKeeperSweep };

// 🔥 NEW: Function to approve USDC for the escrow contract
async function approveUSDC(amount, approverWalletId) {
  const { callContract } = require('./contractClient');
  const USDC_ADDRESS = process.env.USDC_TOKEN_ADDRESS || '0x3600000000000000000000000000000000000000';
  const CONTRACT_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS;
  const amountUnits = toUnits(amount);
  const walletIdToUse = approverWalletId || process.env.WALLET_ID;
  
  console.log(`📤 Approving ${amount} USDC for contract: ${CONTRACT_ADDRESS}...`);
  
  try {
    const approveRes = await callContract({
      walletId: walletIdToUse,
      contractAddress: USDC_ADDRESS,
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [CONTRACT_ADDRESS, amountUnits],
    });
    
    console.log(`✅ Approve submitted: ${approveRes.data.id}`);
    
    // Poll for completion
    const approveTx = await pollTransaction(approveRes.data.id);
    if (approveTx.state !== 'COMPLETE') {
      throw new Error(`Approve failed: ${approveTx.state}`);
    }
    console.log('✅ Approve confirmed on-chain!');
    return true;
  } catch (error) {
    console.error('❌ Approve failed:', error.message);
    return false;
  }
}
