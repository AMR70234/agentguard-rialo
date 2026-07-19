require('dotenv').config();

const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

// Local in-memory cache, refreshed from JSONBin on read/write
let cache = { workers: {} };
let cacheLoaded = false;

async function loadFromRemote() {
  try {
    const res = await fetch(`${JSONBIN_URL}/latest`, {
      headers: { 'X-Master-Key': JSONBIN_API_KEY },
    });
    if (!res.ok) throw new Error(`JSONBin read failed: ${res.status}`);
    const data = await res.json();
    cache = data.record && data.record.workers ? data.record : { workers: {} };
    cacheLoaded = true;
  } catch (err) {
    console.error('⚠️ Could not load reputation from JSONBin, using local cache:', err.message);
  }
}

async function saveToRemote() {
  try {
    const res = await fetch(JSONBIN_URL, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_API_KEY,
      },
      body: JSON.stringify(cache),
    });
    if (!res.ok) throw new Error(`JSONBin write failed: ${res.status}`);
  } catch (err) {
    console.error('⚠️ Could not save reputation to JSONBin:', err.message);
  }
}

function getWorkerStats(walletAddress) {
  const w = cache.workers[walletAddress];
  if (!w) return { totalJobs: 0, accepted: 0, rejected: 0, acceptanceRate: 100 };
  const acceptanceRate = w.totalJobs > 0 ? Math.round((w.accepted / w.totalJobs) * 100) : 100;
  return { ...w, acceptanceRate };
}

// Records a job outcome against a specific worker wallet address (persistent identity),
// instead of a single global counter.
async function recordJob(accepted, walletAddress) {
  if (!cacheLoaded) await loadFromRemote();

  const address = walletAddress || process.env.WORKER_WALLET_ADDRESS;
  if (!cache.workers[address]) {
    cache.workers[address] = { totalJobs: 0, accepted: 0, rejected: 0 };
  }

  cache.workers[address].totalJobs += 1;
  if (accepted) cache.workers[address].accepted += 1;
  else cache.workers[address].rejected += 1;

  await saveToRemote();
  return getWorkerStats(address);
}

// Returns stats for the default worker wallet (used by the frontend /reputation endpoint)
async function getStats(walletAddress) {
  if (!cacheLoaded) await loadFromRemote();
  const address = walletAddress || process.env.WORKER_WALLET_ADDRESS;
  return getWorkerStats(address);
}

module.exports = { recordJob, getStats };
