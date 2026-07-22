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
  db.run(`CREATE TABLE IF NOT EXISTS jobs (
    jobId TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    amount TEXT NOT NULL,
    taskResult TEXT,
    taskInput TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

module.exports = db;
