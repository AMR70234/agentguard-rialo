require('dotenv').config();
const client = require('./circleClient');
const { executeTask } = require('./task');
const { recordJob } = require('./reputation');

const USDC_TOKEN_ID = 'ef87c8c3-85de-598a-af50-c5135eecfa74';

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

  let finalTx;
  if (taskResult.accepted) {
    log.push(`✅ Task accepted — releasing funds to worker...`);
    finalTx = await transferUSDC(
      process.env.ESCROW_WALLET_ID,
      process.env.WORKER_WALLET_ADDRESS,
      amount
    );
    log.push(`✅ Release transaction: ${finalTx.id} (${finalTx.state})`);
  } else {
    log.push(`❌ Task rejected — refunding client...`);
    finalTx = await transferUSDC(
      process.env.ESCROW_WALLET_ID,
      process.env.WALLET_ADDRESS,
      amount
    );
    log.push(`✅ Refund transaction: ${finalTx.id} (${finalTx.state})`);
  }

  const stats = recordJob(taskResult.accepted);
  log.push(`📊 Worker stats: ${stats.accepted}/${stats.totalJobs} accepted (${stats.acceptanceRate}%)`);

  log.forEach(line => console.log(line));

  return {
    accepted: taskResult.accepted,
    summary: taskResult.result,
    taskType: taskResult.taskType,
    amount,
    escrowTx,
    finalTx,
    stats,
  };
}

module.exports = { runEscrowJob, calculatePrice };

if (require.main === module) {
  const sampleText = "Arc is a Layer-1 blockchain built by Circle specifically for stablecoin finance. It uses USDC as the native gas token, offers sub-second transaction finality, and provides a full developer platform for building payment applications, DeFi products, and autonomous AI agents that can transact value in real time without human intervention.";
  runEscrowJob(sampleText);
}
