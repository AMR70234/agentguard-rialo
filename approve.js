require('dotenv').config();
const { generateEntitySecretCiphertext } = require('@circle-fin/developer-controlled-wallets');
const crypto = require('crypto');

async function approveUSDC() {
  const entitySecretCiphertext = await generateEntitySecretCiphertext({
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  });

  const CONTRACT_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS;
  const USDC_ADDRESS = process.env.USDC_TOKEN_ADDRESS || '0x3600000000000000000000000000000000000000';
  const AMOUNT = '1000000';

  const body = {
    idempotencyKey: crypto.randomBytes(16).toString('hex'),
    entitySecretCiphertext,
    walletId: process.env.WALLET_ID,
    contractAddress: USDC_ADDRESS,
    abiFunctionSignature: 'approve(address,uint256)',
    abiParameters: [CONTRACT_ADDRESS, AMOUNT],
    feeLevel: 'MEDIUM',
  };

  console.log('📤 Approving USDC for contract:', CONTRACT_ADDRESS);
  console.log('📤 Amount:', AMOUNT, '(1 USDC)');

  const res = await fetch('https://api.circle.com/v1/w3s/developer/transactions/contractExecution', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log('Status:', res.status);
  console.log('Response:', JSON.stringify(data, null, 2));

  if (res.ok) {
    console.log('\n✅ Approve transaction submitted!');
    console.log('📝 Transaction ID:', data.data.id);
  }
}

approveUSDC().catch(err => console.error('❌ Error:', err));
