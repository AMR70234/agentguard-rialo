require('dotenv').config();
const client = require('./circleClient');

async function createEscrowWallet() {
  try {
    const walletSetResponse = await client.createWalletSet({
      name: 'escrow-wallet-set',
    });
    const walletSetId = walletSetResponse.data.walletSet.id;
    console.log('✅ Wallet Set created:', walletSetId);

    const walletResponse = await client.createWallets({
      walletSetId: walletSetId,
      blockchains: ['ARC-TESTNET'],
      accountType: 'SCA',
      count: 1,
    });

    console.log('✅ Escrow wallet created:');
    console.log(walletResponse.data.wallets);
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

createEscrowWallet();
