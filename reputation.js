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
