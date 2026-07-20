require('dotenv').config();
const crypto = require('crypto');
const { callContract } = require('./contractClient');
const { executeTask } = require('./task');
const { recordJob } = require('./reputation');

const DISPUTE_WINDOW_MS = 8000;
const pendingJobs = new Map(); // jobId -> { taskResult, amount, timer, status }

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
async function runEscrowJob(taskInput, amount) {
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

  console.log(`On-chain: creating job ${jobId}, escrowing ${amount} USDC...`);
  const createRes = await callContract({
    walletId: process.env.WALLET_ID,
    abiFunctionSignature: 'createJob(bytes32,address,uint256)',
    abiParameters: [jobId, process.env.WORKER_WALLET_ADDRESS, toUnits(amount)],
  });
  const createTx = await pollTransaction(createRes.data.id);
  if (createTx.state !== 'COMPLETE') {
    return { accepted: false, disputable: false, summary: 'On-chain escrow failed.', taskType: 'error', amount, finalTx: null, stats: null };
  }
  console.log(`Escrow confirmed on-chain: ${createTx.txHash}`);

  console.log('Worker agent executing task...');
  const taskResult = await executeTask(taskInput);
  console.log(`Result: "${taskResult.result}"`);

  if (taskResult.accepted) {
    pendingJobs.set(jobId, { status: 'pending', amount, taskResult });

    const timer = setTimeout(async () => {
      const job = pendingJobs.get(jobId);
      if (!job || job.status !== 'pending') return;
      try {
        const releaseRes = await callContract({
          walletId: process.env.WORKER_WALLET_ID,
          abiFunctionSignature: 'release(bytes32)',
          abiParameters: [jobId],
        });
        job.status = 'released';
        job.finalTx = releaseRes.data;
        await recordJob(true, process.env.WORKER_WALLET_ADDRESS);
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
      walletId: process.env.WALLET_ID,
      abiFunctionSignature: 'dispute(bytes32)',
      abiParameters: [jobId],
    });
    await new Promise(r => setTimeout(r, 3000));
    const resolveRes = await callContract({
      walletId: process.env.ESCROW_WALLET_ID,
      abiFunctionSignature: 'resolve(bytes32,bool)',
      abiParameters: [jobId, false],
    });

    const stats = await recordJob(false, process.env.WORKER_WALLET_ADDRESS);

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
  console.log(`Job ${jobId} disputed on-chain: ${disputeRes.data.id}`);
  return { ok: true, status: 'awaiting_arbitration' };
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

  console.log(`On-chain arbitration on job ${jobId}: ${job.status} (${resolveRes.data.id})`);
  return { ok: true, status: job.status, finalTx: resolveRes.data };
}

function getJobStatus(jobId) {
  const job = pendingJobs.get(jobId);
  if (!job) return { status: 'unknown' };
  return { status: job.status, finalTx: job.finalTx || null };
}

module.exports = { runEscrowJob, disputeJob, getJobStatus, listPendingArbitration, resolveArbitration, calculatePrice };
