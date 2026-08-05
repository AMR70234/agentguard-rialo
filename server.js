require('dotenv').config();
const express = require('express');
const cors = require('cors');
const client = require('./circleClient');
const { runEscrowJob, disputeJob, getJobStatus, listPendingArbitration, resolveArbitration } = require('./escrowJob');
const { getRecentTransactions } = require('./db');
const { getStats } = require('./reputation');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Google OAuth: each logged-in user gets their own Circle wallet,
// created automatically on first login and reused on future logins —
// so identity persists across devices/browsers, unlike a cookie-only session.
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { getOrCreateUserWallet } = require('./userWallets');

app.use(session({
  secret: process.env.ADMIN_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL,
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const wallet = await getOrCreateUserWallet(profile.id, profile.emails[0].value);
    done(null, { googleId: profile.id, email: profile.emails[0].value, wallet });
  } catch (err) {
    done(err);
  }
}));

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => {
  res.redirect('/');
});
app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});
app.get('/auth/me', (req, res) => {
  res.json(req.user || null);
});

app.get('/auth/welcome-status', async (req, res) => {
  if (!req.user) return res.json({ shouldShowWelcome: false });
  const { hasSeenWelcome } = require('./userWallets');
  const seen = await hasSeenWelcome(req.user.googleId);
  res.json({ shouldShowWelcome: !seen });
});

app.post('/auth/welcome-seen', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  const { markWelcomeSeen } = require('./userWallets');
  await markWelcomeSeen(req.user.googleId);
  res.json({ ok: true });
});

// Simple auth middleware: protects every /admin/* endpoint with a shared secret.
// The request must include: Authorization: Bearer <ADMIN_SECRET>
function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token || token !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized: missing or invalid admin credentials' });
  }
  next();
}

// POST /run-job — classify → escrow → execute → dispute window → release/refund
app.post('/run-job', async (req, res) => {
  const { taskInput, amount } = req.body;

  if (!taskInput) {
    return res.status(400).json({ error: 'Missing taskInput in request body' });
  }

  try {
    console.log('🚀 Job started...');
    const clientWallet = req.user ? req.user.wallet : null;
    const result = await runEscrowJob(taskInput, amount, clientWallet);

    return res.json({
  accepted: result.accepted,
  disputable: result.disputable || false,
  jobId: result.jobId || null,
  disputeWindowMs: result.disputeWindowMs || 0,
  disputeWindowMsDebug: 60000, // ← أضف هذا السطر للاختبار
  summary: result.summary,
  taskType: result.taskType,
  amount: result.amount,
  transaction: result.finalTx || result.escrowTx,
  stats: result.stats,
});
  } catch (error) {
    console.error('❌ Error in /run-job:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// POST /dispute — client disputes a pending job before the auto-release timer fires
app.post('/dispute', async (req, res) => {
  const { jobId } = req.body;

  if (!jobId) {
    return res.status(400).json({ error: 'Missing jobId in request body' });
  }

  try {
    const result = await disputeJob(jobId);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    return res.json(result);
  } catch (error) {
    console.error('❌ Error in /dispute:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// GET /admin/disputes — list all jobs currently frozen and awaiting human arbitration
app.get('/admin/disputes', requireAdmin, (req, res) => {
  res.json(listPendingArbitration());
});

// POST /admin/resolve — human arbitrator's decision: { jobId, decision: "release" | "refund" }
app.post('/admin/resolve', requireAdmin, async (req, res) => {
  const { jobId, decision } = req.body;
  if (!jobId || !decision) {
    return res.status(400).json({ error: 'Missing jobId or decision in request body' });
  }
  try {
    const result = await resolveArbitration(jobId, decision);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json(result);
  } catch (error) {
    console.error('Error in /admin/resolve:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// GET /admin/audit-log — view every past arbitration decision
app.get('/admin/audit-log', requireAdmin, async (req, res) => {
  try {
    const db = require('./db');
    db.all('SELECT * FROM audit_log ORDER BY timestamp DESC', (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /job-status/:jobId — poll the current status of a job
app.get('/job-status/:jobId', (req, res) => {
  const status = getJobStatus(req.params.jobId);
  res.json(status);
});

// GET /tx/:id — fetch full transaction details (including txHash) for the Explorer link
app.get('/tx/:id', async (req, res) => {
  try {
    const response = await client.getTransaction({ id: req.params.id });
    const tx = response.data.transaction;
    res.json({
      id: tx.id,
      state: tx.state,
      txHash: tx.txHash || null,
    });
  } catch (error) {
    console.error('❌ Error in /tx/:id:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /balances
app.post('/admin/pause', requireAdmin, async (req, res) => {
  try {
    const { callContract } = require('./contractClient');
    const result = await callContract({
      walletId: process.env.WALLET_ID,
      abiFunctionSignature: 'pause()',
      abiParameters: [],
    });
    res.json({ ok: true, tx: result.data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/admin/unpause', requireAdmin, async (req, res) => {
  try {
    const { callContract } = require('./contractClient');
    const result = await callContract({
      walletId: process.env.WALLET_ID,
      abiFunctionSignature: 'unpause()',
      abiParameters: [],
    });
    res.json({ ok: true, tx: result.data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/transactions/daily', (req, res) => {
  const db = require('./db');
  db.all(
    `SELECT date(createdAt) as day, COUNT(*) as count
     FROM jobs
     GROUP BY day
     ORDER BY day ASC
     LIMIT 30`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

app.get('/transactions', (req, res) => {
  const filterWallet = req.user ? req.user.wallet.walletAddress : null;
  getRecentTransactions(50, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const parsed = rows.map(r => ({
      jobId: r.jobId,
      status: r.status,
      amount: r.amount,
      taskInput: r.taskInput,
      taskResult: r.taskResult ? JSON.parse(r.taskResult) : null,
      createdAt: r.createdAt,
      txHash: r.txHash,
    }));
    res.json(parsed);
  }, filterWallet);
});

app.post('/fund-my-wallet', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });

  const { canFund, recordFunding, DAILY_FUNDING_LIMIT } = require('./db');
  const { latchCreateTransaction } = require('./latchCircleClient');

  const FUND_AMOUNT = 2; // USDC per request

  canFund(req.user.googleId, FUND_AMOUNT, async (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!result.allowed) {
      return res.status(429).json({
        error: `Daily funding limit reached ($${DAILY_FUNDING_LIMIT}/day per account). Already used $${result.alreadyFunded} today.`,
      });
    }

    try {
      const tx = await latchCreateTransaction({
        walletId: process.env.WALLET_ID,
        tokenId: process.env.USDC_TOKEN_ID,
        destinationAddress: req.user.wallet.walletAddress,
        amount: FUND_AMOUNT,
      });
      recordFunding(req.user.googleId, FUND_AMOUNT, () => {});
      res.json({ ok: true, amount: FUND_AMOUNT, transaction: tx });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
});

// Peer-to-peer USDC transfer between two signed-in AgentGuard users.
// Same daily limit table as fund-my-wallet, same Latch-protected transfer.
app.post('/p2p-send', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  const { recipientEmail, amount } = req.body;
  const amountNum = parseFloat(amount);
  if (!recipientEmail || isNaN(amountNum) || amountNum <= 0) {
    return res.status(400).json({ error: 'recipientEmail and a positive amount are required' });
  }
  const { findUserByEmail, canSendP2P, recordP2PSend, DAILY_FUNDING_LIMIT } = require('./db');
  const { latchCreateTransaction } = require('./latchCircleClient');
  findUserByEmail(recipientEmail, async (err, recipient) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!recipient) return res.status(404).json({ error: 'No AgentGuard user found with that email' });
    if (recipient.googleId === req.user.googleId) {
      return res.status(400).json({ error: "You can't send to yourself" });
    }

    // Check the sender actually has enough balance before attempting the transfer.
    try {
      const balRes = await client.getWalletTokenBalance({ id: req.user.wallet.walletId });
      const token = balRes.data.tokenBalances.find(t => !t.token.isNative);
      const currentBalance = token ? parseFloat(token.amount) : 0;
      if (currentBalance < amountNum) {
        return res.status(400).json({ error: `Insufficient balance. You have ${currentBalance} USDC, tried to send ${amountNum} USDC.` });
      }
    } catch (error) {
      return res.status(500).json({ error: 'Could not verify your balance: ' + error.message });
    }

    canSendP2P(req.user.googleId, amountNum, async (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!result.allowed) {
        return res.status(429).json({
          error: `Daily send limit reached ($${DAILY_FUNDING_LIMIT}/day per account). Already used $${result.alreadyFunded} today.`,
        });
      }
      try {
        const tx = await latchCreateTransaction({
          walletId: req.user.wallet.walletId,
          tokenId: process.env.USDC_TOKEN_ID,
          destinationAddress: recipient.walletAddress,
          amount: amountNum,
        });
        recordP2PSend(req.user.googleId, amountNum, () => {});
        const { recordP2PTransfer } = require('./db');
        recordP2PTransfer(req.user.googleId, req.user.email, recipient.googleId, recipient.email, amountNum, tx.data ? tx.data.id : null, () => {});
        res.json({ ok: true, amount: amountNum, to: recipient.email, transaction: tx });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  });
});

app.get('/p2p-history', (req, res) => {
  if (!req.user) return res.json([]);
  const { getP2PHistory } = require('./db');
  getP2PHistory(req.user.googleId, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/user-balance', async (req, res) => {
  if (!req.user) return res.json({ loggedIn: false });
  try {
    const balRes = await client.getWalletTokenBalance({ id: req.user.wallet.walletId });
    const token = balRes.data.tokenBalances.find(t => !t.token.isNative);
    res.json({ loggedIn: true, walletAddress: req.user.wallet.walletAddress, balance: token ? token.amount : '0' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/balances', async (req, res) => {
  try {
    const [clientBal, escrowBal, workerBal, worker2Bal] = await Promise.all([
      client.getWalletTokenBalance({ id: process.env.WALLET_ID }),
      client.getWalletTokenBalance({ id: process.env.ESCROW_WALLET_ID }),
      client.getWalletTokenBalance({ id: process.env.WORKER_WALLET_ID }),
      client.getWalletTokenBalance({ id: process.env.WORKER2_WALLET_ID }),
    ]);

    const getUsdc = (balanceResponse) => {
      const token = balanceResponse.data.tokenBalances.find(t => !t.token.isNative);
      return token ? token.amount : '0';
    };

    res.json({
      client: getUsdc(clientBal),
      escrow: getUsdc(escrowBal),
      worker: getUsdc(workerBal),
      worker2: getUsdc(worker2Bal),
    });
  } catch (error) {
    console.error('❌ Error in /balances:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /reputation
app.get('/agent-messages', (req, res) => {
  const { getRecentA2AMessages } = require('./reputation');
  getRecentA2AMessages(10, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/reputation', async (req, res) => {
  res.json(await getStats());
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
// Keep-Alive: منع السيرفر من النوم على Render
setInterval(async () => {
  try {
    await fetch(`http://localhost:${PORT}/reputation`);
    console.log('🔄 Keep-alive ping sent');
  } catch (e) {
    // السيرفر شغال، مش مشكلة
  }
}, 5 * 60 * 1000); // كل 5 دقائق

// Keeper: sweeps for jobs stuck in arbitration too long and force-refunds
// them on-chain automatically, without any human clicking a button.
const { runKeeperSweep } = require('./escrowJob');
setInterval(() => {
  runKeeperSweep().catch(err => console.error('Keeper sweep failed:', err.message));
}, 15 * 1000); // every 15 seconds for demo purposes