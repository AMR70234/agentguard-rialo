require('dotenv').config();
const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');

const client = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
});

async function createWalletSetAndWallet() {
  try {
    const walletSetResponse = await client.createWalletSet({
      name: 'agentic-hackathon-agent',
    });
    const walletSetId = walletSetResponse.data.walletSet.id;
    console.log('✅ اتعمل Wallet Set جديد:', walletSetId);

    const walletResponse = await client.createWallets({
      walletSetId: walletSetId,
      blockchains: ['ARC-TESTNET'],
      accountType: 'SCA',
      count: 1,
    });

    console.log('✅ اتعملت المحفظة بنجاح:');
    console.log(walletResponse.data.wallets);
  } catch (error) {
    console.error('❌ في مشكلة:', error.message);
  }
}

createWalletSetAndWallet();
