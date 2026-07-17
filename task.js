require('dotenv').config();
const { latchChatCompletion } = require('./latchClient');

// All calls now go through Latch's policy proxy instead of hitting OpenAI directly.
// This means every request is checked against: endpoint allowlist, POST-only,
// max_tokens < 500, model must be gpt-4o-mini/gpt-4o, rate limit, and daily spend cap.

async function classifyTask(inputText) {
  const result = await latchChatCompletion([
    {
      role: 'system',
      content: 'Classify the following text into exactly one category: "summarize" (long descriptive text to condense), "sentiment" (opinion/review text to analyze), or "qa" (a direct question to answer). Respond with only the single word category, nothing else.',
    },
    { role: 'user', content: inputText },
  ], { model: 'gpt-4o-mini', max_tokens: 10 });

  const category = result.trim().toLowerCase();
  if (['summarize', 'sentiment', 'qa'].includes(category)) return category;
  return 'summarize';
}

async function doSummarize(inputText) {
  const originalWordCount = inputText.trim().split(/\s+/).length;
  const summary = await latchChatCompletion([
    { role: 'system', content: 'Summarize in the SAME language as the input, in one short sentence, using significantly fewer words than the original.' },
    { role: 'user', content: `Summarize this text, in one short sentence:\n\n${inputText}` },
  ], { model: 'gpt-4o-mini', max_tokens: 150 });

  const summaryWordCount = summary.trim().split(/\s+/).length;
  const accepted = summaryWordCount < originalWordCount && summary.length > 0;
  return { accepted, result: summary, taskType: 'summarize' };
}

async function doSentiment(inputText) {
  const result = await latchChatCompletion([
    { role: 'system', content: 'Analyze the sentiment of the text. Respond in this exact format: "Sentiment: <Positive/Negative/Neutral> — <one short reason, under 12 words>".' },
    { role: 'user', content: inputText },
  ], { model: 'gpt-4o-mini', max_tokens: 60 });

  const accepted = /^Sentiment: (Positive|Negative|Neutral)/.test(result);
  return { accepted, result, taskType: 'sentiment' };
}

async function verifyAnswer(question, answer) {
  const result = await latchChatCompletion([
    {
      role: 'system',
      content: `You are an independent, skeptical verifier, separate from whatever system produced this answer. Judge the answer against TWO rules, in any language:

RULE 1 (non-answer): Reject if the answer is a refusal, apology, statement of not knowing, or vague redirection instead of answering.

RULE 2 (stale/time-sensitive facts): Reject if the answer states a specific fact about something that changes over time — current officeholders, prices, rankings, "current" anything, recent events — WITHOUT any caveat that the information may be outdated or should be verified.

Respond with only YES (passes both rules) or NO (fails either rule).`,
    },
    { role: 'user', content: `Question: ${question}\n\nAnswer: ${answer}\n\nDoes this answer pass both rules? Respond YES or NO only.` },
  ], { model: 'gpt-4o-mini', max_tokens: 5 });

  return result.trim().toUpperCase().startsWith('YES');
}

async function doQA(inputText) {
  const result = await latchChatCompletion([
    {
      role: 'system',
      content: 'Answer the question directly and concisely, in the SAME language as the question, in one or two sentences. If you genuinely cannot answer, say so clearly and briefly. If the question is about something that changes over time (current officeholders, prices, rankings, recent events), you MUST include a brief caveat that your information may be outdated.',
    },
    { role: 'user', content: inputText },
  ], { model: 'gpt-4o-mini', max_tokens: 150 });

  const genuine = await verifyAnswer(inputText, result);
  const accepted = result.length > 0 && result.length < 500 && genuine;
  return { accepted, result, taskType: 'qa' };
}

async function executeTask(inputText, manualType) {
  const taskType = manualType || await classifyTask(inputText);
  console.log(`🧭 Task classified as: ${taskType}`);
  console.log(`🔒 Routed through Latch policy proxy (AgentGuard)`);

  let result;
  if (taskType === 'sentiment') result = await doSentiment(inputText);
  else if (taskType === 'qa') result = await doQA(inputText);
  else result = await doSummarize(inputText);

  console.log(`📄 Result: "${result.result}"`);
  return result;
}

module.exports = { executeTask, classifyTask };
