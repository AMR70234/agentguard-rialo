require('dotenv').config();

const LATCH_URL = process.env.LATCH_URL;
const LATCH_TOKEN = process.env.LATCH_TOKEN;
const LATCH_ID = process.env.LATCH_ID;

// Sends a chat completion request THROUGH Latch's policy proxy,
// instead of calling OpenAI directly with the raw API key.
async function latchChatCompletion(messages, options = {}) {
  const url = `${LATCH_URL}/proxy/v1/chat/completions`;

  const body = {
    model: options.model || 'gpt-4o-mini',
    temperature: options.temperature ?? 0,
    max_tokens: options.max_tokens || 300,
    messages,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LATCH_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Latch proxy error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

module.exports = { latchChatCompletion };
