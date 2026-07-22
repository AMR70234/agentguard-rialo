require('dotenv').config();

const LATCH_URL = process.env.LATCH_URL;
const LATCH_TOKEN = process.env.LATCH_TOKEN;
const LATCH_ID = process.env.LATCH_ID;

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

// Sends a chat completion request THROUGH Latch's policy proxy
async function latchChatCompletion(messages, options = {}, retries = 3) {
  const url = `${LATCH_URL}/proxy/v1/chat/completions`;

  const body = {
    model: options.model || 'gpt-4o-mini',
    temperature: options.temperature ?? 0,
    max_tokens: options.max_tokens || 300,
    messages,
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LATCH_TOKEN}`,
        },
        body: JSON.stringify(body),
      }, 30000);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Latch proxy error (${response.status}): ${errText}`);
      }

      const data = await response.json();
      
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Invalid response from Latch proxy: missing choices');
      }
      
      const content = data.choices[0].message.content;
      if (!content || content.trim().length === 0) {
        throw new Error('Empty response from Latch proxy');
      }
      
      return content.trim();
    } catch (error) {
      console.warn(`⚠️ Latch attempt ${attempt}/${retries} failed:`, error.message);
      if (attempt === retries) throw error;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

module.exports = { latchChatCompletion };
