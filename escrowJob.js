require('dotenv').config();
const { latchCreateTransaction } = require('./latchCircleClient');
const { executeTask } = require('./task');
const { recordJob } = require('./reputation');

const USDC_TOKEN_ID = 'ef87c8c3-85de-598a-af50-c5135eecfa74';
const DISPUTE_WINDOW_MS = 8000;
const pendingJobs = new Map();

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

async function transferUSDC(fromWalletId, toAddress, amount) {
  const response = await latchCreateTransaction({
    walletId: fromWalletId,
    tokenId: USDC_TOKEN_ID,
    destinationAddress: toAddress,
    amount,
  });
  return { id: response.data.id, state: response.data.state };
}

async function runEscrowJob(taskInput, amount) {
  if (!amount) amount = calculatePrice(taskInput);

  const spendCheck = checkAndRecordDailySpend(amount);
  if (!spendCheck.allowed) {
    console.log(`Daily USDC limit reached ($${DAILY_USDC_LIMIT}/day). Remaining: $${spendCheck.remaining}`);
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

  const log = [];

  log.push(`Escrowing ${amount} USDC from client (via Latch)...`);
  const escrowTx = await transferUSDC(
    process.env.WALLET_ID,
    process.env.ESCROW_WALLET_ADDRESS,
    amount
  );
  log.push(`Escrow transaction: ${escrowTx.id} (${escrowTx.state})`);

  log.push(`Worker agent executing task...`);
  const taskResult = await executeTask(taskInput);
  log.push(`Result: "${taskResult.result}"`);

  const jobId = escrowTx.id;

  if (taskResult.accepted) {
    log.push(`Task accepted — entering ${DISPUTE_WINDOW_MS / 1000}s dispute window before release...`);

    pendingJobs.set(jobId, { status: 'pending', amount, taskResult });

    const timer = setTimeout(async () => {
      const job = pendingJobs.get(jobId);
      if (!job || job.status !== 'pending') return;

      try {
        const finalTx = await transferUSDC(
          process.env.ESCROW_WALLET_ID,
          process.env.WORKER_WALLET_ADDRESS,
          amount
        );
        job.status = 'released';
        job.finalTx = finalTx;
        await recordJob(true, process.env.WORKER_WALLET_ADDRESS);
        console.log(`Auto-released job ${jobId} (via Latch): ${finalTx.id} (${finalTx.state})`);
      } catch (err) {
        console.error(`Auto-release failed for job ${jobId}:`, err.message);
      }
    }, DISPUTE_WINDOW_MS);

    pendingJobs.get(jobId).timer = timer;

    log.forEach(line => console.log(line));

    return {
      accepted: true,
      disputable: true,
      jobId,
      summary: taskResult.result,
      taskType: taskResult.taskType,
      amount,
      escrowTx,
      disputeWindowMs: DISPUTE_WINDOW_MS,
      stats: undefined,
    };
  } else {
    log.push(`Task rejected — refunding client (via Latch)...`);
    const finalTx = await transferUSDC(
      process.env.ESCROW_WALLET_ID,
      process.env.WALLET_ADDRESS,
      amount
    );
    log.push(`Refund transaction: ${finalTx.id} (${finalTx.state})`);

    const stats = await recordJob(false, process.env.WORKER_WALLET_ADDRESS);
    log.push(`Worker stats: ${stats.accepted}/${stats.totalJobs} accepted (${stats.acceptanceRate}%)`);
    log.forEach(line => console.log(line));

    return {
      accepted: false,
      disputable: false,
      summary: taskResult.result,
      taskType: taskResult.taskType,
      amount,
      finalTx,
      stats,
    };
  }
}

// A dispute no longer auto-refunds. It freezes the job and queues it for
// human arbitration instead — funds stay in escrow until an admin decides.
async function disputeJob(jobId) {
  const job = pendingJobs.get(jobId);
  if (!job) return { ok: false, error: 'Job not found or already resolved' };
  if (job.status !== 'pending') return { ok: false, error: `Job already ${job.status}` };

  clearTimeout(job.timer);
  job.status = 'awaiting_arbitration';
  console.log(`Job ${jobId} disputed — frozen in escrow, awaiting human arbitration.`);
  return { ok: true, status: 'awaiting_arbitration' };
}

// Returns every job currently frozen and waiting for an admin decision.
function listPendingArbitration() {
  const list = [];
  for (const [jobId, job] of pendingJobs.entries()) {
    if (job.status === 'awaiting_arbitration') {
      list.push({
        jobId,
        amount: job.amount,
        taskType: job.taskResult && job.taskResult.taskType,
        result: job.taskResult && job.taskResult.result,
      });
    }
  }
  return list;
}

// Human arbitrator's decision: either release to the worker, or refund the client.
async function resolveArbitration(jobId, decision) {
  const job = pendingJobs.get(jobId);
  if (!job) return { ok: false, error: 'Job not found or already resolved' };
  if (job.status !== 'awaiting_arbitration') return { ok: false, error: `Job is not awaiting arbitration (status: ${job.status})` };

  if (decision === 'release') {
    const finalTx = await transferUSDC(
      process.env.ESCROW_WALLET_ID,
      process.env.WORKER_WALLET_ADDRESS,
      job.amount
    );
    job.status = 'released';
    job.finalTx = finalTx;
    await recordJob(true, process.env.WORKER_WALLET_ADDRESS);
    console.log(`Arbitration on job ${jobId}: RELEASED to worker (via Latch): ${finalTx.id}`);
    return { ok: true, status: 'released', finalTx };
  } else if (decision === 'refund') {
    const finalTx = await transferUSDC(
      process.env.ESCROW_WALLET_ID,
      process.env.WALLET_ADDRESS,
      job.amount
    );
    job.status = 'refunded';
    job.finalTx = finalTx;
    await recordJob(false, process.env.WORKER_WALLET_ADDRESS);
    console.log(`Arbitration on job ${jobId}: REFUNDED to client (via Latch): ${finalTx.id}`);
    return { ok: true, status: 'refunded', finalTx };
  } else {
    return { ok: false, error: 'decision must be "release" or "refund"' };
  }
}

function getJobStatus(jobId) {
  const job = pendingJobs.get(jobId);
  if (!job) return { status: 'unknown' };
  return { status: job.status, finalTx: job.finalTx || null };
}

module.exports = { runEscrowJob, disputeJob, getJobStatus, listPendingArbitration, resolveArbitration, calculatePrice };

if (require.main === module) {
  const sampleText = "Arc is a Layer-1 blockchain built by Circle specifically for stablecoin finance.";
  runEscrowJob(sampleText).then(r => console.log('\nFinal result:', r));
}
