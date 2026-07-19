require('dotenv').config();
const express = require('express');
const cors = require('cors');
const client = require('./circleClient');
const { runEscrowJob, disputeJob, getJobStatus } = require('./escrowJob');
const { getStats } = require('./reputation');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// POST /run-job — classify → escrow → execute → dispute window → release/refund
app.post('/run-job', async (req, res) => {
  const { taskInput, amount } = req.body;

  if (!taskInput) {
    return res.status(400).json({ error: 'Missing taskInput in request body' });
  }

  try {
    console.log('🚀 Job started...');
    const result = await runEscrowJob(taskInput, amount);

    return res.json({
      accepted: result.accepted,
      disputable: result.disputable || false,
      jobId: result.jobId || null,
      disputeWindowMs: result.disputeWindowMs || 0,
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
app.get('/balances', async (req, res) => {
  try {
    const [clientBal, escrowBal, workerBal] = await Promise.all([
      client.getWalletTokenBalance({ id: process.env.WALLET_ID }),
      client.getWalletTokenBalance({ id: process.env.ESCROW_WALLET_ID }),
      client.getWalletTokenBalance({ id: process.env.WORKER_WALLET_ID }),
    ]);

    const getUsdc = (balanceResponse) => {
      const token = balanceResponse.data.tokenBalances.find(t => !t.token.isNative);
      return token ? token.amount : '0';
    };

    res.json({
      client: getUsdc(clientBal),
      escrow: getUsdc(escrowBal),
      worker: getUsdc(workerBal),
    });
  } catch (error) {
    console.error('❌ Error in /balances:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /reputation
app.get('/reputation', async (req, res) => {
  res.json(await getStats());
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
