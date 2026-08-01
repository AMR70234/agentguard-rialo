const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'agentguard.db');
const db = new sqlite3.Database(dbPath);

// إنشاء الجداول لو مش موجودة
db.serialize(() => {
  // جدول سجل التحكيم (Audit Log)
  db.run(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jobId TEXT NOT NULL,
    decision TEXT NOT NULL,
    resolver TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // جدول السمعة (Reputation)
  db.run(`CREATE TABLE IF NOT EXISTS reputation (
    wallet TEXT PRIMARY KEY,
    jobs_completed INTEGER DEFAULT 0,
    accepted INTEGER DEFAULT 0,
    rejected INTEGER DEFAULT 0,
    acceptance_rate REAL DEFAULT 0
  )`);

  // جدول الوظائف المعلقة (Pending Jobs)
  db.run(`ALTER TABLE jobs ADD COLUMN txHash TEXT`, () => {}); // ignore error if column exists
  db.run(`ALTER TABLE jobs ADD COLUMN walletAddress TEXT`, () => {}); // ignore error if column exists
  db.run(`CREATE TABLE IF NOT EXISTS daily_funding (
    googleId TEXT NOT NULL,
    fundedDate TEXT NOT NULL,
    amount REAL NOT NULL,
    PRIMARY KEY (googleId, fundedDate)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS p2p_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fromGoogleId TEXT NOT NULL,
    fromEmail TEXT NOT NULL,
    toGoogleId TEXT NOT NULL,
    toEmail TEXT NOT NULL,
    amount REAL NOT NULL,
    txHash TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS jobs (
    jobId TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    amount TEXT NOT NULL,
    taskResult TEXT,
    taskInput TEXT,
    walletAddress TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

function recordTransaction(jobId, status, amount, taskInput, taskResult, txHash, walletAddress) {
  db.run(
    `INSERT OR REPLACE INTO jobs (jobId, status, amount, taskResult, taskInput, txHash, walletAddress)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [jobId, status, amount, JSON.stringify(taskResult || null), taskInput || null, txHash || null, walletAddress || null],
    (err) => { if (err) console.error('Failed to record transaction:', err.message); }
  );
}

function getRecentTransactions(limit, callback, walletAddress) {
  if (walletAddress) {
    db.all('SELECT * FROM jobs WHERE walletAddress = ? ORDER BY createdAt DESC LIMIT ?', [walletAddress, limit || 50], callback);
  } else {
    db.all('SELECT * FROM jobs ORDER BY createdAt DESC LIMIT ?', [limit || 50], callback);
  }
}

const DAILY_FUNDING_LIMIT = 6; // USD, per Google account per day

function getTodayFunded(googleId, callback) {
  const today = new Date().toISOString().slice(0, 10);
  db.get(
    'SELECT amount FROM daily_funding WHERE googleId = ? AND fundedDate = ?',
    [googleId, today],
    (err, row) => callback(err, row ? row.amount : 0)
  );
}

function canFund(googleId, requestedAmount, callback) {
  getTodayFunded(googleId, (err, alreadyFunded) => {
    if (err) return callback(err);
    const remaining = DAILY_FUNDING_LIMIT - alreadyFunded;
    callback(null, { allowed: requestedAmount <= remaining, remaining, alreadyFunded });
  });
}

function recordFunding(googleId, amount, callback) {
  const today = new Date().toISOString().slice(0, 10);
  db.run(
    `INSERT INTO daily_funding (googleId, fundedDate, amount) VALUES (?, ?, ?)
     ON CONFLICT(googleId, fundedDate) DO UPDATE SET amount = amount + excluded.amount`,
    [googleId, today, amount],
    callback
  );
}

function findUserByEmail(email, callback) {
  db.get(
    'SELECT googleId, email, walletAddress FROM user_wallets WHERE email = ?',
    [email],
    callback
  );
}

const DAILY_P2P_LIMIT = 6; // USD, per Google account per day (shares the same table as funding)

function canSendP2P(googleId, requestedAmount, callback) {
  canFund(googleId, requestedAmount, callback);
}

function recordP2PSend(googleId, amount, callback) {
  recordFunding(googleId, amount, callback);
}

function recordP2PTransfer(fromGoogleId, fromEmail, toGoogleId, toEmail, amount, txHash, callback) {
  db.run(
    `INSERT INTO p2p_transfers (fromGoogleId, fromEmail, toGoogleId, toEmail, amount, txHash) VALUES (?, ?, ?, ?, ?, ?)`,
    [fromGoogleId, fromEmail, toGoogleId, toEmail, amount, txHash || null],
    callback
  );
}

function getP2PHistory(googleId, callback) {
  db.all(
    `SELECT p2p.*, 
            fromUser.walletAddress AS fromWalletAddress,
            toUser.walletAddress AS toWalletAddress
     FROM p2p_transfers p2p
     LEFT JOIN user_wallets fromUser ON p2p.fromGoogleId = fromUser.googleId
     LEFT JOIN user_wallets toUser ON p2p.toGoogleId = toUser.googleId
     WHERE p2p.fromGoogleId = ? OR p2p.toGoogleId = ?
     ORDER BY p2p.createdAt DESC LIMIT 50`,
    [googleId, googleId],
    callback
  );
}

module.exports = db;
module.exports.canFund = canFund;
module.exports.recordFunding = recordFunding;
module.exports.DAILY_FUNDING_LIMIT = DAILY_FUNDING_LIMIT;
module.exports.recordTransaction = recordTransaction;
module.exports.getRecentTransactions = getRecentTransactions;
module.exports.findUserByEmail = findUserByEmail;
module.exports.canSendP2P = canSendP2P;
module.exports.recordP2PSend = recordP2PSend;
module.exports.recordP2PTransfer = recordP2PTransfer;
module.exports.getP2PHistory = getP2PHistory;
