require('dotenv').config();
const client = require('./circleClient');
const { executeTask } = require('./task');

async function runAgentJob(taskInput) {
  console.log('🚀 بدأ تنفيذ المهمة...\n');

  const taskResult = await executeTask(taskInput);

  if (taskResult.accepted) {
    console.log(`✅ الشغل مقبول!`);
    console.log('💸 هيتم تحويل الدفعة...\n');

    try {
      const transferResponse = await client.createTransaction({
        walletId: process.env.WALLET_ID,
        tokenId: 'ef87c8c3-85de-598a-af50-c5135eecfa74',
        destinationAddress: process.env.WORKER_WALLET_ADDRESS,
        amount: ['1'],
        fee: {
          type: 'level',
          config: { feeLevel: 'MEDIUM' },
        },
      });

      console.log('✅ تم إرسال المعاملة بنجاح:');
      console.log(transferResponse.data);
      return transferResponse.data;
    } catch (error) {
      console.error('❌ في مشكلة في التحويل:', error.message);
    }
  } else {
    console.log('❌ الشغل مرفوض. الفلوس مش هتتحول.');
  }
}

const sampleText = "Arc is a Layer-1 blockchain built by Circle specifically for stablecoin finance. It uses USDC as the native gas token, offers sub-second transaction finality, and provides a full developer platform for building payment applications, DeFi products, and autonomous AI agents that can transact value in real time without human intervention.";

runAgentJob(sampleText);

module.exports = { runAgentJob };
