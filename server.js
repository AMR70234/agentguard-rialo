require('dotenv').config();
const express = require('express');
const cors = require('cors');
const client = require('./circleClient');
const { runEscrowJob } = require('./escrowJob');
const { getStats } = require('./reputation');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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
      summary: result.summary,
      taskType: result.taskType,
      amount: result.amount,
      transaction: result.finalTx,
      stats: result.stats,
    });
  } catch (error) {
    console.error('❌ Error in /run-job:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

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

app.get('/reputation', (req, res) => {
  res.json(getStats());
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
