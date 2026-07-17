require('dotenv').config();
const client = require('./circleClient');
const { executeTask } = require('./task');
const { recordJob } = require('./reputation');

const USDC_TOKEN_ID = 'ef87c8c3-85de-598a-af50-c5135eecfa74';
const DISPUTE_WINDOW_MS = 8000; // 8 seconds to dispute before auto-release

// In-memory store of pending jobs awaiting the dispute window
const pendingJobs = new Map();

function calculatePrice(inputText) {
  const wordCount = inputText.trim().split(/\s+/).length;
  if (wordCount <= 20) return '0.5';
  if (wordCount <= 60) return '1';
  return '2';
}

async function transferUSDC(fromWalletId, toAddress, amount) {
  const response = await client.createTransaction({
    walletId: fromWalletId,
    tokenId: USDC_TOKEN_ID,
    destinationAddress: toAddress,
    amount: [String(amount)],
    fee: {
      type: 'level',
      config: { feeLevel: 'MEDIUM' },
    },
  });
  return response.data;
}

// Step 1: escrow the fee and execute the task. If accepted, DO NOT release yet —
// schedule an automatic release after the dispute window, unless disputed first.
async function runEscrowJob(taskInput, amount) {
  if (!amount) amount = calculatePrice(taskInput);
  const log = [];

  log.push(`💰 Escrowing ${amount} USDC from client...`);
  const escrowTx = await transferUSDC(
    process.env.WALLET_ID,
    process.env.ESCROW_WALLET_ADDRESS,
    amount
  );
  log.push(`✅ Escrow transaction: ${escrowTx.id} (${escrowTx.state})`);

  log.push(`🤖 Worker agent executing task...`);
  const taskResult = await executeTask(taskInput);
  log.push(`📄 Result: "${taskResult.result}"`);

  const jobId = escrowTx.id;

  if (taskResult.accepted) {
    log.push(`✅ Task accepted — entering ${DISPUTE_WINDOW_MS / 1000}s dispute window before release...`);

    pendingJobs.set(jobId, {
      status: 'pending',
      amount,
      taskResult,
    });

    // Schedule auto-release after the dispute window, unless disputed
    const timer = setTimeout(async () => {
      const job = pendingJobs.get(jobId);
      if (!job || job.status !== 'pending') return; // already disputed or resolved

      try {
        const finalTx = await transferUSDC(
          process.env.ESCROW_WALLET_ID,
          process.env.WORKER_WALLET_ADDRESS,
          amount
        );
        job.status = 'released';
        job.finalTx = finalTx;
        recordJob(true);
        console.log(`✅ Auto-released job ${jobId}: ${finalTx.id} (${finalTx.state})`);
      } catch (err) {
        console.error(`❌ Auto-release failed for job ${jobId}:`, err.message);
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
      stats: recordJob.getStatsOnly ? null : undefined,
    };
  } else {
    log.push(`❌ Task rejected — refunding client...`);
    const finalTx = await transferUSDC(
      process.env.ESCROW_WALLET_ID,
      process.env.WALLET_ADDRESS,
      amount
    );
    log.push(`✅ Refund transaction: ${finalTx.id} (${finalTx.state})`);

    const stats = recordJob(false);
    log.push(`📊 Worker stats: ${stats.accepted}/${stats.totalJobs} accepted (${stats.acceptanceRate}%)`);
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

// Called when the client disputes a pending job BEFORE the auto-release timer fires.
async function disputeJob(jobId) {
  const job = pendingJobs.get(jobId);
  if (!job) return { ok: false, error: 'Job not found or already resolved' };
  if (job.status !== 'pending') return { ok: false, error: `Job already ${job.status}` };

  clearTimeout(job.timer);
  job.status = 'disputed';

  // Refund the client since the job was disputed
  const finalTx = await transferUSDC(
    process.env.ESCROW_WALLET_ID,
    process.env.WALLET_ADDRESS,
    job.amount
  );
  job.status = 'refunded';
  job.finalTx = finalTx;
  recordJob(false);

  console.log(`⚠️ Job ${jobId} disputed — refunded to client: ${finalTx.id}`);
  return { ok: true, status: 'refunded', finalTx };
}

// Poll the status of a pending/resolved job (used by the frontend to show final state)
function getJobStatus(jobId) {
  const job = pendingJobs.get(jobId);
  if (!job) return { status: 'unknown' };
  return {
    status: job.status,
    finalTx: job.finalTx || null,
  };
}

module.exports = { runEscrowJob, disputeJob, getJobStatus, calculatePrice };

if (require.main === module) {
  const sampleText = "Arc is a Layer-1 blockchain built by Circle specifically for stablecoin finance. It uses USDC as the native gas token, offers sub-second transaction finality, and provides a full developer platform for building payment applications, DeFi products, and autonomous AI agents that can transact value in real time without human intervention.";
  runEscrowJob(sampleText).then(r => console.log('\nFinal result:', r));
}
