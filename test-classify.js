require('dotenv').config();
const { executeTask } = require('./task');

async function test() {
  console.log('--- Test 1: Summarize ---');
  await executeTask("Arc is a Layer-1 blockchain built by Circle specifically for stablecoin finance. It uses USDC as the native gas token, offers sub-second transaction finality, and provides a full developer platform for building payment applications.");

  console.log('\n--- Test 2: Sentiment ---');
  await executeTask("This product completely exceeded my expectations, the quality is amazing and I would definitely buy it again.");

  console.log('\n--- Test 3: QA ---');
  await executeTask("What is the capital of France?");
}

test();
