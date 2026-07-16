require('dotenv').config();
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function classifyTask(inputText) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: 'Classify the following text into exactly one category: "summarize" (long descriptive text to condense), "sentiment" (opinion/review text to analyze), or "qa" (a direct question to answer). Respond with only the single word category, nothing else.',
      },
      { role: 'user', content: inputText },
    ],
  });
  const category = response.choices[0].message.content.trim().toLowerCase();
  if (['summarize', 'sentiment', 'qa'].includes(category)) return category;
  return 'summarize';
}

async function doSummarize(inputText) {
  const originalWordCount = inputText.trim().split(/\s+/).length;
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: 'Summarize in English, in one short sentence, using significantly fewer words than the original. Never translate.' },
      { role: 'user', content: `Summarize this text in English, in one short sentence:\n\n${inputText}` },
    ],
  });
  const summary = response.choices[0].message.content.trim();
  const summaryWordCount = summary.trim().split(/\s+/).length;
  const accepted = summaryWordCount < originalWordCount && summary.length > 0;
  return { accepted, result: summary, taskType: 'summarize' };
}

async function doSentiment(inputText) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: 'Analyze the sentiment of the text. Respond in this exact format: "Sentiment: <Positive/Negative/Neutral> — <one short reason, under 12 words>".' },
      { role: 'user', content: inputText },
    ],
  });
  const result = response.choices[0].message.content.trim();
  const accepted = /^Sentiment: (Positive|Negative|Neutral)/.test(result);
  return { accepted, result, taskType: 'sentiment' };
}

// Phrases that indicate the model could NOT actually answer the question
const NON_ANSWER_PATTERNS = [
  /i don'?t have (real-time|specific|access to)/i,
  /i cannot provide/i,
  /i do not have/i,
  /i'?m unable to/i,
  /no (real-time )?information/i,
  /check (official|a reliable)/i,
  /please check/i,
  /as of my last (update|training)/i,
  /i don'?t know/i,
];

async function doQA(inputText) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: 'Answer the question directly and concisely, in one or two sentences. If you genuinely cannot answer, say so clearly and briefly.' },
      { role: 'user', content: inputText },
    ],
  });
  const result = response.choices[0].message.content.trim();
  const isNonAnswer = NON_ANSWER_PATTERNS.some(p => p.test(result));
  const accepted = result.length > 0 && result.length < 500 && !isNonAnswer;
  return { accepted, result, taskType: 'qa' };
}

async function executeTask(inputText, manualType) {
  const taskType = manualType || await classifyTask(inputText);
  console.log(`🧭 Task classified as: ${taskType}`);

  let result;
  if (taskType === 'sentiment') result = await doSentiment(inputText);
  else if (taskType === 'qa') result = await doQA(inputText);
  else result = await doSummarize(inputText);

  console.log(`📄 Result: "${result.result}"`);
  return result;
}

module.exports = { executeTask, classifyTask };
