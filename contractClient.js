require('dotenv').config();
const crypto = require('crypto');
const { generateEntitySecretCiphertext } = require('@circle-fin/developer-controlled-wallets');

const CONTRACT_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS;

// Calls a function on the deployed AgentEscrow contract via Circle's
// contract execution API, using the given wallet to sign.
async function callContract({ walletId, contractAddress, abiFunctionSignature, abiParameters }) {
  const targetAddress = contractAddress || CONTRACT_ADDRESS;
  const entitySecretCiphertext = await generateEntitySecretCiphertext({
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  });

  const res = await fetch('https://api.circle.com/v1/w3s/developer/transactions/contractExecution', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}`,
    },
    body: JSON.stringify({
      idempotencyKey: crypto.randomUUID(),
      entitySecretCiphertext,
      walletId,
      contractAddress: targetAddress,
      abiFunctionSignature,
      abiParameters,
      feeLevel: 'MEDIUM',
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Contract call failed: ${JSON.stringify(data)}`);
  return data;
}

module.exports = { callContract, CONTRACT_ADDRESS };
