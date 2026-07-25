require('dotenv').config();
const crypto = require('crypto');
const { generateEntitySecretCiphertext } = require('@circle-fin/developer-controlled-wallets');

const CONTRACT_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS;

// Calls a function on the deployed AgentEscrow contract via Circle's
// contract execution API — routed through a Latch policy that only
// allows this exact contract address, POST only, rate-limited.
async function callContract({ walletId, contractAddress, abiFunctionSignature, abiParameters }) {
  const targetAddress = contractAddress || CONTRACT_ADDRESS;
  const entitySecretCiphertext = await generateEntitySecretCiphertext({
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  });

  const res = await fetch(`${process.env.LATCH_CONTRACT_URL}/proxy/v1/w3s/developer/transactions/contractExecution`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.LATCH_CONTRACT_TOKEN}`,
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
  if (!res.ok) throw new Error(`Contract call failed (via Latch): ${JSON.stringify(data)}`);
  return data;
}

module.exports = { callContract, CONTRACT_ADDRESS };
