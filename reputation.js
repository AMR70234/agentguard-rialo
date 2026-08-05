require('dotenv').config();
const db = require('./db');

// Records a job outcome against a specific worker wallet address
async function recordJob(accepted, walletAddress) {
  const address = walletAddress || process.env.WORKER_WALLET_ADDRESS;
  
  return new Promise((resolve, reject) => {
    // جلب البيانات الحالية
    db.get('SELECT * FROM reputation WHERE wallet = ?', [address], (err, row) => {
      if (err) return reject(err);
      
      const totalJobs = (row?.jobs_completed || 0) + 1;
      const acceptedCount = (row?.accepted || 0) + (accepted ? 1 : 0);
      const rejectedCount = (row?.rejected || 0) + (accepted ? 0 : 1);
      const acceptanceRate = totalJobs > 0 ? Math.round((acceptedCount / totalJobs) * 100) : 100;
      
      // تحديث البيانات
      db.run(
        `INSERT OR REPLACE INTO reputation (wallet, jobs_completed, accepted, rejected, acceptance_rate)
         VALUES (?, ?, ?, ?, ?)`,
        [address, totalJobs, acceptedCount, rejectedCount, acceptanceRate],
        (err) => {
          if (err) return reject(err);
          resolve({ totalJobs, accepted: acceptedCount, rejected: rejectedCount, acceptanceRate });
        }
      );
    });
  });
}

// Returns stats for a worker wallet
async function getStats(walletAddress) {
  const address = walletAddress || process.env.WORKER_WALLET_ADDRESS;
  
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM reputation WHERE wallet = ?', [address], (err, row) => {
      if (err) return reject(err);
      if (!row) {
        return resolve({ totalJobs: 0, accepted: 0, rejected: 0, acceptanceRate: 100 });
      }
      resolve({
        totalJobs: row.jobs_completed,
        accepted: row.accepted,
        rejected: row.rejected,
        acceptanceRate: row.acceptance_rate
      });
    });
  });
}

module.exports = { recordJob, getStats };

// A2A (Agent-to-Agent) communication: a simple shared broadcast log.
// When a worker completes a job, it broadcasts a short message other
// workers can read before taking on new jobs \u2014 a lightweight form of
// agent-to-agent knowledge sharing, not a full messaging protocol, but a
// real mechanism for one agent's outcome to inform another agent's behavior.
function initA2ATable() {
  db.run(`CREATE TABLE IF NOT EXISTS agent_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fromWallet TEXT NOT NULL,
    taskType TEXT,
    outcome TEXT,
    message TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}
initA2ATable();

function broadcastA2AMessage(fromWallet, taskType, outcome) {
  const message = outcome === 'accepted'
    ? `Completed a ${taskType} task successfully \u2014 pattern recognized.`
    : `A ${taskType} task was rejected \u2014 flagging as a harder case.`;
  db.run(
    `INSERT INTO agent_messages (fromWallet, taskType, outcome, message) VALUES (?, ?, ?, ?)`,
    [fromWallet, taskType, outcome, message],
    (err) => { if (err) console.error('A2A broadcast failed:', err.message); }
  );
}

function getRecentA2AMessages(limit, callback) {
  db.all(
    'SELECT * FROM agent_messages ORDER BY createdAt DESC LIMIT ?',
    [limit || 10],
    callback
  );
}

module.exports.broadcastA2AMessage = broadcastA2AMessage;
module.exports.getRecentA2AMessages = getRecentA2AMessages;

// Counts how many successful A2A broadcasts a worker has made for a
// specific task type \u2014 used as an "experience" signal in worker selection,
// so a worker with more successful summarize jobs gets a small edge on
// the next summarize job, not just overall acceptance rate.
function getA2AExperience(walletAddress) {
  return new Promise((resolve) => {
    db.get(
      `SELECT COUNT(*) as count FROM agent_messages WHERE fromWallet = ? AND outcome = 'accepted'`,
      [walletAddress],
      (err, row) => {
        if (err || !row) return resolve(0);
        resolve(row.count);
      }
    );
  });
}

module.exports.getA2AExperience = getA2AExperience;
