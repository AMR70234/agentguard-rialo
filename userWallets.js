require('dotenv').config();
const client = require('./circleClient');
const db = require('./db');

// Persistent mapping: googleId -> Circle wallet (id + address).
// A shared, dedicated wallet set holds all per-user wallets.
const USER_WALLET_SET_ID = process.env.USER_WALLET_SET_ID;

function initUserWalletsTable() {
  db.run(`CREATE TABLE IF NOT EXISTS user_wallets (
    googleId TEXT PRIMARY KEY,
    email TEXT,
    walletId TEXT,
    walletAddress TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`ALTER TABLE user_wallets ADD COLUMN hasSeenWelcome INTEGER DEFAULT 0`, () => {});
}
initUserWalletsTable();

function markWelcomeSeen(googleId) {
  return new Promise((resolve, reject) => {
    db.run('UPDATE user_wallets SET hasSeenWelcome = 1 WHERE googleId = ?', [googleId], (err) => {
      if (err) reject(err); else resolve();
    });
  });
}

function hasSeenWelcome(googleId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT hasSeenWelcome FROM user_wallets WHERE googleId = ?', [googleId], (err, row) => {
      if (err) return reject(err);
      resolve(row ? !!row.hasSeenWelcome : false);
    });
  });
}

function getStoredWallet(googleId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM user_wallets WHERE googleId = ?', [googleId], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function storeWallet(googleId, email, walletId, walletAddress) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR REPLACE INTO user_wallets (googleId, email, walletId, walletAddress) VALUES (?, ?, ?, ?)',
      [googleId, email, walletId, walletAddress],
      (err) => { if (err) reject(err); else resolve(); }
    );
  });
}

async function getOrCreateUserWallet(googleId, email) {
  const existing = await getStoredWallet(googleId);
  if (existing) {
    return { walletId: existing.walletId, walletAddress: existing.walletAddress };
  }

  const walletsRes = await client.createWallets({
    walletSetId: USER_WALLET_SET_ID,
    blockchains: ['ARC-TESTNET'],
    count: 1,
    accountType: 'SCA',
  });
  const w = walletsRes.data.wallets[0];
  await storeWallet(googleId, email, w.id, w.address);
  return { walletId: w.id, walletAddress: w.address };
}

module.exports = { getOrCreateUserWallet, markWelcomeSeen, hasSeenWelcome };
