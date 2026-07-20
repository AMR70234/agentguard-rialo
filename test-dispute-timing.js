async function testTiming() {
  console.log('1️⃣ Running job...');
  const runRes = await fetch('http://localhost:3002/run-job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskInput: 'Rialo is a developer-first Layer-1 blockchain built by Subzero Labs for the agent economy.' }),
  });
  const runData = await runRes.json();
  console.log('Job ID:', runData.jobId);
  console.log('Accepted:', runData.accepted);

  if (!runData.jobId) { console.log('❌ Auto-rejected, try again.'); return; }

  console.log('\n2️⃣ Disputing IMMEDIATELY (0 seconds delay)...');
  const disputeRes = await fetch('http://localhost:3002/dispute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: runData.jobId }),
  });
  console.log('Dispute response:', await disputeRes.json());

  console.log('\n3️⃣ Checking pending arbitration list...');
  const listRes = await fetch('http://localhost:3002/admin/disputes', {
    headers: { 'Authorization': 'Bearer key-amrmousa-agentguard-1997-tanta' },
  });
  console.log('Pending arbitration:', await listRes.json());
}
testTiming();
