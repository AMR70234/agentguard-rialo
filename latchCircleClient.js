require('dotenv').config();
const { generateEntitySecretCiphertext } = require('@circle-fin/developer-controlled-wallets');
const crypto = require('crypto');

const LATCH_CIRCLE_URL = process.env.LATCH_CIRCLE_URL;
const LATCH_CIRCLE_TOKEN = process.env.LATCH_CIRCLE_TOKEN;

// دالة fetch مع Timeout
const fetchWithTimeout = async (url, options, timeout = 30000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
};

// Sends a USDC transfer request THROUGH Latch's policy proxy for Circle
async function latchCreateTransaction({ walletId, tokenId, destinationAddress, amount }, retries = 3) {
  // تحقق من الـ Amount
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    throw new Error('Invalid amount: must be a positive number');
  }
  if (amountNum > 10) {
    throw new Error('Amount exceeds maximum allowed (10 USDC)');
  }

  let entitySecretCiphertext;
  try {
    entitySecretCiphertext = await generateEntitySecretCiphertext({
      apiKey: process.env.CIRCLE_API_KEY,
      entitySecret: process.env.CIRCLE_ENTITY_SECRET,
    });
  } catch (error) {
    throw new Error(`Failed to generate entity secret ciphertext: ${error.message}`);
  }

  const idempotencyKey = crypto.randomBytes(16).toString('hex');

  const body = {
    idempotencyKey,
    entitySecretCiphertext,
    walletId,
    tokenId,
    destinationAddress,
    amounts: [String(amount)],
    feeLevel: 'MEDIUM',
  };

  const url = `${LATCH_CIRCLE_URL}/proxy/v1/w3s/developer/transactions/transfer`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LATCH_CIRCLE_TOKEN}`,
        },
        body: JSON.stringify(body),
      }, 30000);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Latch Circle proxy error (${response.status}): ${errText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.warn(`⚠️ Latch Circle attempt ${attempt}/${retries} failed:`, error.message);
      if (attempt === retries) throw error;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

module.exports = { latchCreateTransaction };
