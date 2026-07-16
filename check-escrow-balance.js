require('dotenv').config();
const client = require('./circleClient');

async function checkBalance() {
  try {
    const response = await client.getWalletTokenBalance({
      id: process.env.ESCROW_WALLET_ID,
    });
    console.log('✅ Escrow wallet balance:');
    console.log(response.data.tokenBalances);
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkBalance();
