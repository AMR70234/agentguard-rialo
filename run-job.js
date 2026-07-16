require('dotenv').config();
const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');

const client = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
});

// دالة بسيطة تمثل "تنفيذ المهمة" بمنطق اختباري
function executeTask(inputText) {
  const wordCount = inputText.trim().split(/\s+/).length;
  console.log(`📝 النص المُرسل: "${inputText}"`);
  console.log(`🔢 عدد الكلمات: ${wordCount}`);

  // شرط بسيط: لو النص فيه أكتر من 5 كلمات، اعتبر الشغل مقبول
  const isAccepted = wordCount > 5;
  return isAccepted;
}

async function runJob() {
  const taskInput = "This is a simple test sentence for our agent job";
  
  console.log('🚀 بدأ تنفيذ المهمة...\n');
  
  const isAccepted = executeTask(taskInput);

  if (isAccepted) {
    console.log('\n✅ الشغل مقبول! هيتم تحويل الدفعة...\n');

    try {
      const transferResponse = await client.createTransaction({
        walletId: process.env.WALLET_ID, // محفظة العميل (Client)
        tokenId: 'ef87c8c3-85de-598a-af50-c5135eecfa74', // USDC ERC-20 على Arc Testnet
        destinationAddress: process.env.WORKER_WALLET_ADDRESS,
        amount: ['1'], // مبلغ الدفع: 1 USDC
        fee: {
          type: 'level',
          config: { feeLevel: 'MEDIUM' },
        },
      });

      console.log('✅ تم إرسال المعاملة بنجاح:');
      console.log(transferResponse.data);
    } catch (error) {
      console.error('❌ في مشكلة في التحويل:', error.message);
    }
  } else {
    console.log('\n❌ الشغل مرفوض. الفلوس مش هتتحول.');
  }
}

runJob();
