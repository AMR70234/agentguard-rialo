async function testDispute() {
  console.log('1️⃣ Running job...');
  const runRes = await fetch('http://localhost:3002/run-job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskInput: 'What is Arc blockchain?' }),
  });
  const runData = await runRes.json();
  console.log('Job ID:', runData.jobId);
  console.log('Disputable:', runData.disputable);

  console.log('\n⏳ Waiting 2 seconds (well within the 8s window)...');
  await new Promise(r => setTimeout(r, 2000));

  console.log('\n2️⃣ Disputing job...');
  const disputeRes = await fetch('http://localhost:3002/dispute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: runData.jobId }),
  });
  const disputeData = await disputeRes.json();
  console.log('Dispute result:', disputeData);
}

testDispute();
